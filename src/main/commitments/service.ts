import { createMutex, readFileOrNull, writeFileAtomic } from '../workspace/fs-utils';
import { newId } from '../workspace/ids';
import { assertSafeSegment, commitmentsFile } from '../workspace/paths';
import {
  addLocalDays,
  isCommitmentDate,
  MAX_COMMITMENT_TEXT,
  parseCommitmentsFile,
  resolveCommitmentDue,
  serializeCommitmentsFile,
  type Commitment
} from './records';

export type { Commitment } from './records';

/**
 * The read-only projection the notification center consumes. Resolving a
 * promise still goes through chat, so nothing here writes.
 */
export interface CommitmentSummaryRecord {
  id: string;
  text: string;
  due: string;
  status: 'open' | 'done' | 'dropped';
  createdAt: string;
  resolvedAt?: string;
  workspaceId?: string;
}

/** Trims a record to the display fields; no reordering or inventing fields. */
export function summarizeCommitment(commitment: Commitment): CommitmentSummaryRecord {
  return {
    id: commitment.id,
    text: commitment.text,
    due: commitment.due,
    status: commitment.status,
    createdAt: commitment.createdAt,
    ...(commitment.resolvedAt ? { resolvedAt: commitment.resolvedAt } : {}),
    ...(commitment.workspaceId ? { workspaceId: commitment.workspaceId } : {})
  };
}

export interface CreateCommitmentInput {
  /** The promise in the user's own words, at most `MAX_COMMITMENT_TEXT` chars. */
  text: string;
  /** Local date YYYY-MM-DD; the model passes tomorrow for "明天". */
  due?: string;
  /** Optional project the promise belongs to. */
  workspaceId?: string;
}

export interface ResolveCommitmentInput {
  /** Record id, preferred over `text`. */
  id?: string;
  /** Fallback match against the promise text. */
  text?: string;
  /** Omit only when rescheduling with `newDue`. */
  outcome?: 'done' | 'dropped';
  /** Local date YYYY-MM-DD; moves the promise without closing it. */
  newDue?: string;
}

/**
 * Vault-backed promises. One `commitments.md` at the vault root holds every
 * entry so the user can read and edit the same document in Obsidian; the
 * frontmatter `items` is the machine-readable source of truth.
 */
export interface CommitmentService {
  list(): Promise<Commitment[]>;
  create(input: CreateCommitmentInput): Promise<Commitment>;
  resolve(input: ResolveCommitmentInput): Promise<Commitment>;
  /** Open promises due on or before `byDate`, most overdue first. */
  pending(byDate: string): Promise<Commitment[]>;
}

export interface CommitmentServiceOptions {
  /** Vault root (the directory holding `commitments.md`). */
  root: string;
  now?: () => Date;
}

function requireText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('承诺内容不能为空。');
  }
  const text = value.trim();
  if (text.length > MAX_COMMITMENT_TEXT) {
    throw new Error(`承诺内容不能超过 ${MAX_COMMITMENT_TEXT} 字。`);
  }
  return text;
}

function normalizeWorkspace(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('所属项目无效。');
  const workspaceId = value.trim();
  if (!workspaceId) return undefined;
  return assertSafeSegment(workspaceId, 'workspace id');
}

/** Exact match wins, then a unique substring; the oldest open promise wins ties. */function matchCommitment(
  commitments: readonly Commitment[],
  id: string | undefined,
  text: string | undefined
): Commitment | undefined {
  if (id !== undefined) {
    return commitments.find((entry) => entry.id === id);
  }
  if (text === undefined) return undefined;
  const needle = text.trim().toLowerCase();
  if (!needle) return undefined;
  const open = commitments
    .filter((entry) => entry.status === 'open')
    .sort(
      (a, b) => a.due.localeCompare(b.due) || a.createdAt.localeCompare(b.createdAt)
    );
  const exact = open.find((entry) => entry.text.toLowerCase() === needle);
  if (exact) return exact;
  const partial = open.filter((entry) => entry.text.toLowerCase().includes(needle));
  return partial.length === 1 ? partial[0] : undefined;
}

export function createCommitmentService(
  options: CommitmentServiceOptions
): CommitmentService {
  const root = options.root;
  const now = options.now ?? (() => new Date());
  const runExclusively = createMutex();
  const file = commitmentsFile(root);

  async function readAll(): Promise<Commitment[]> {
    const raw = await readFileOrNull(file);
    return raw === null ? [] : parseCommitmentsFile(raw);
  }

  async function writeAll(commitments: readonly Commitment[]): Promise<void> {
    await writeFileAtomic(file, serializeCommitmentsFile(commitments));
  }

  return {
    async list(): Promise<Commitment[]> {
      return readAll();
    },

    async create(input: CreateCommitmentInput): Promise<Commitment> {
      const text = requireText(input?.text);
      const workspaceId = normalizeWorkspace(input?.workspaceId);
      const due = resolveCommitmentDue(input?.due, now()) ?? addLocalDays(now(), 1);
      return runExclusively(async () => {
        const commitments = await readAll();
        const created: Commitment = {
          id: newId('cm'),
          text,
          due,
          status: 'open',
          createdAt: now().toISOString(),
          ...(workspaceId ? { workspaceId } : {})
        };
        await writeAll([...commitments, created]);
        return created;
      });
    },

    async resolve(input: ResolveCommitmentInput): Promise<Commitment> {
      const id = typeof input?.id === 'string' ? input.id.trim() : undefined;
      const text = typeof input?.text === 'string' ? input.text.trim() : undefined;
      const outcome = input?.outcome;
      const newDue = input?.newDue?.trim();
      if (outcome !== undefined && outcome !== 'done' && outcome !== 'dropped') {
        throw new Error('outcome 只能是 done 或 dropped。');
      }
      if (newDue !== undefined && newDue !== '' && !isCommitmentDate(newDue)) {
        throw new Error('新日期必须是 YYYY-MM-DD。');
      }
      if (outcome === undefined && !newDue) {
        throw new Error('请提供 outcome（done / dropped）或 newDue。');
      }
      const wanted = newDue ? newDue : undefined;
      return runExclusively(async () => {
        const commitments = await readAll();
        const match = matchCommitment(commitments, id && id !== '' ? id : undefined, text);
        if (match === undefined) {
          const label = id || text || '';
          throw new Error(`没有找到承诺：「${label}」。`);
        }
        const index = commitments.findIndex((entry) => entry.id === match.id);
        const next: Commitment = { ...match };
        if (wanted !== undefined) {
          next.due = wanted;
          next.status = 'open';
          delete next.resolvedAt;
        } else if (outcome !== undefined) {
          next.status = outcome;
          next.resolvedAt = now().toISOString();
        }
        const updated = [...commitments];
        updated[index] = next;
        await writeAll(updated);
        return next;
      });
    },

    async pending(byDate: string): Promise<Commitment[]> {
      const commitments = await readAll();
      return commitments
        .filter((entry) => entry.status === 'open' && entry.due <= byDate)
        .sort(
          (a, b) => a.due.localeCompare(b.due) || a.createdAt.localeCompare(b.createdAt)
        );
    }
  };
}
