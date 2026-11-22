import type { NoteMeta } from '../../shared/types';
import { formatLocalDate, isLocalDate, repairRolloverDate } from '../../shared/date';
import { parseNote, serializeNote } from '../vault/note';import { asRecord, asString } from '../workspace/records/coerce';

/**
 * A promise the user made in their own words ("我明天做 X", "这周内写完 Y").
 * One vault-level `commitments.md` holds them all; `workspaceId` is optional
 * because a promise does not have to belong to a project.
 */
export type CommitmentStatus = 'open' | 'done' | 'dropped';

export interface Commitment {
  id: string;
  /** The promise as the user said it, at most `MAX_COMMITMENT_TEXT` chars. */
  text: string;
  /** Local date YYYY-MM-DD the user said they would do it. */
  due: string;
  status: CommitmentStatus;
  /** ISO timestamp of the record. */
  createdAt: string;
  /** ISO timestamp of when the promise was done or dropped. */
  resolvedAt?: string;
  /** Absent for a promise that is not tied to a project. */
  workspaceId?: string;
}

export const MAX_COMMITMENT_TEXT = 200;

const COMMITMENT_STATUSES: readonly CommitmentStatus[] = ['open', 'done', 'dropped'];

export function isCommitmentStatus(value: unknown): value is CommitmentStatus {
  return typeof value === 'string' && (COMMITMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * True for a real calendar date written as YYYY-MM-DD. Delegates to the shared
 * exact-shape + rollover check, so impossible days the Date constructor would
 * roll over (`2026-02-30`) are refused instead of being silently accepted.
 */
export function isCommitmentDate(value: string | undefined): value is string {
  return typeof value === 'string' && isLocalDate(value);
}

/**
 * The stored `due`, repaired if it was written by the old lenient validator.
 * A real date is returned untouched; an impossible day is clamped to the last
 * real day of its month, so a strict read never deletes the promise.
 */
function coerceDue(value: unknown): string | undefined {
  const text = asString(value);
  if (isCommitmentDate(text)) return text;
  return repairRolloverDate(value);
}

/** Local calendar arithmetic; crossing month and year boundaries stays exact. */
export function addLocalDays(date: Date, days: number): string {
  const due = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  return formatLocalDate(due);
}

const WEEK_END_PATTERN = /^(这周内|本周内|这周末|本周末)$/;
const NEXT_WEEK_PATTERN = /^(下周|下周内|下周末)$/;

/**
 * Turns what the user said into a local date. The model normally passes an ISO
 * date already; the relative phrasings are the fallback so a literal "明天" or
 * "这周内" still lands on a real day. Returns undefined for anything unreadable.
 */
export function resolveCommitmentDue(
  value: string | undefined,
  now: Date
): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (isCommitmentDate(text)) return text;
  if (text === '今天' || text === '今日') return addLocalDays(now, 0);
  if (text === '明天' || text === '明日') return addLocalDays(now, 1);
  if (text === '后天') return addLocalDays(now, 2);
  // A Chinese week ends on Sunday; Monday + 6 is that Sunday.
  if (WEEK_END_PATTERN.test(text)) {
    const offset = (7 - ((now.getDay() + 6) % 7) - 1) % 7;
    return addLocalDays(now, offset);
  }
  if (NEXT_WEEK_PATTERN.test(text)) {
    const mondayOffset = 7 - ((now.getDay() + 6) % 7);
    return addLocalDays(now, mondayOffset + 6);
  }
  return undefined;
}

/**
 * Tolerant read: an entry missing its id, text, date or a known status is
 * skipped instead of failing the whole file, so one hand edit in Obsidian
 * cannot hide every other promise.
 */
function coerceCommitment(value: unknown): Commitment | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = asString(record.id)?.trim();
  const text = asString(record.text)?.trim();
  const due = coerceDue(record.due);
  if (!id || !text || due === undefined) return null;
  if (!isCommitmentStatus(record.status)) return null;
  const createdAt = asString(record.createdAt) ?? '';
  const resolvedAt = asString(record.resolvedAt);
  const workspaceId = asString(record.workspaceId)?.trim();
  return {
    id,
    text,
    due,
    status: record.status,
    createdAt,
    ...(resolvedAt ? { resolvedAt } : {}),
    ...(workspaceId ? { workspaceId } : {})
  };
}

export function parseCommitmentsFile(raw: string): Commitment[] {
  const { meta } = parseNote(raw);
  if (!Array.isArray(meta.items)) return [];
  return meta.items
    .map(coerceCommitment)
    .filter((entry): entry is Commitment => entry !== null);
}

const STATUS_MARKS: Record<CommitmentStatus, string> = {
  open: ' ',
  done: 'x',
  dropped: '-'
};

/**
 * Writes only the known fields, in a fixed order, so a file this app wrote
 * parses and serializes back byte-identically while nothing is changed.
 */
export function serializeCommitmentsFile(commitments: readonly Commitment[]): string {
  const meta: NoteMeta = {
    type: 'log',
    source: 'user',
    kind: 'commitments',
    items: commitments.map((commitment) => ({
      id: commitment.id,
      text: commitment.text,
      due: commitment.due,
      status: commitment.status,
      createdAt: commitment.createdAt,
      ...(commitment.resolvedAt ? { resolvedAt: commitment.resolvedAt } : {}),
      ...(commitment.workspaceId ? { workspaceId: commitment.workspaceId } : {})
    }))
  };
  const lines = commitments.map(
    (commitment) =>
      `- [${STATUS_MARKS[commitment.status]}] ${commitment.text}（原定 ${commitment.due}）`
  );
  const body = ['# 承诺', '', ...lines, ''].join('\n');
  return serializeNote(meta, body);
}
