import type {
  DeleteMemoryInput,
  MemoryKind,
  MemoryRecord,
  MemoryService,
  MemorySynthesisResult,
  SynthesizeMemoryInput,
  UpdateMemoryInput
} from '../../shared/memory';
import type { ModelClient } from '../agent/model-client';
import { createMutex, listDirectories, readFileOrNull, writeFileAtomic } from '../workspace/fs-utils';
import { newId } from '../workspace/ids';
import {
  assertIsoDate,
  assertSafeSegment,
  memoryFile,
  workspaceFile,
  workspacesDir
} from '../workspace/paths';
import { parseWorkspaceFile } from '../workspace/records/workspace';
import { buildProfile } from './profile';
import { isMemoryKind, parseMemoryRecords, serializeMemoryRecords } from './records';
import { synthesizeByModel, synthesizeByRules, type ReviewSynthesisSource } from './synthesize';

export interface MemoryServiceOptions {
  /** Vault root (the directory holding `workspaces/`). */
  root: string;
  /** Injected model client; null/undefined means deterministic rule summaries. */
  modelClient?: ModelClient | null;
  now?: () => Date;
  temperature?: number;
  maxTokens?: number;
}

function byNewestFirst(a: MemoryRecord, b: MemoryRecord): number {
  return (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id.localeCompare(a.id);
}

function requireWorkspaceId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Workspace id is required');
  }
  return assertSafeSegment(value, 'workspace id');
}

function requireMemoryId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Memory id is required');
  }
  return value.trim();
}

function requireMemoryText(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Memory text is required');
  }
  return value.trim();
}

function requireMemoryKind(value: unknown): MemoryKind {
  if (!isMemoryKind(value)) throw new Error('Invalid memory kind');
  return value;
}

/**
 * Vault-backed MemoryService. `workspaces/<id>/memory.md` is the only source of
 * truth (YAML frontmatter `items`); synthesis appends to it without ever
 * dropping existing entries, so history stays traceable to its review day.
 */
export function createMemoryService(options: MemoryServiceOptions): MemoryService {
  const vaultRoot = options.root;
  const modelClient = options.modelClient ?? null;
  const now = options.now ?? (() => new Date());
  const runExclusively = createMutex();

  function readCandidates(): Promise<string[]> {
    return listDirectories(workspacesDir(vaultRoot));
  }

  async function readRecords(workspaceId: string): Promise<MemoryRecord[]> {
    const raw = await readFileOrNull(memoryFile(vaultRoot, workspaceId));
    return raw === null ? [] : parseMemoryRecords(raw, workspaceId);
  }

  async function readWorkspaceOrThrow(workspaceId: string) {
    const raw = await readFileOrNull(workspaceFile(vaultRoot, workspaceId));
    const workspace = raw === null ? null : parseWorkspaceFile(raw, workspaceId);
    if (workspace === null) throw new Error(`Workspace not found: ${workspaceId}`);
    return workspace;
  }

  async function collectRecords(workspaceId?: string): Promise<MemoryRecord[]> {
    if (workspaceId !== undefined) {
      assertSafeSegment(workspaceId, 'workspace id');
      return readRecords(workspaceId);
    }
    const items: MemoryRecord[] = [];
    for (const dirName of await readCandidates()) {
      items.push(...(await readRecords(dirName)));
    }
    return items;
  }

  async function appendRecords(
    workspaceId: string,
    additions: readonly MemoryRecord[]
  ): Promise<MemoryRecord[]> {
    return runExclusively(async () => {
      const existing = await readRecords(workspaceId);
      // Re-synthesizing the same review must not duplicate entries.
      const seen = new Set(existing.map((entry) => `${entry.source}\n${entry.text}`));
      const fresh = additions.filter((entry) => !seen.has(`${entry.source}\n${entry.text}`));
      if (fresh.length > 0) {
        await writeFileAtomic(
          memoryFile(vaultRoot, workspaceId),
          serializeMemoryRecords([...existing, ...fresh])
        );
      }
      return fresh;
    });
  }

  return {
    async list(workspaceId?: string): Promise<MemoryRecord[]> {
      return (await collectRecords(workspaceId)).sort(byNewestFirst);
    },

    async synthesizeFromReview(input: SynthesizeMemoryInput): Promise<MemorySynthesisResult> {
      if (typeof input?.workspaceId !== 'string' || input.workspaceId.trim() === '') {
        throw new Error('Workspace id is required');
      }
      const workspaceId = assertSafeSegment(input.workspaceId, 'workspace id');
      const date = assertIsoDate(input.date, 'review date');
      if (typeof input.answers !== 'object' || input.answers === null) {
        throw new Error('Review answers are required');
      }
      const workspace = await readWorkspaceOrThrow(workspaceId);
      const answers = input.answers;

      // A skipped review has nothing worth remembering.
      if (answers.skipped === true) return { items: [], generatedBy: 'rules' };

      const source: ReviewSynthesisSource = {
        workspaceName: workspace.name,
        workspaceGoal: workspace.goal,
        date,
        answers
      };
      const candidates =
        modelClient !== null ? await synthesizeByModel(modelClient, source, options) : null;
      const generatedBy = candidates !== null ? 'model' : 'rules';
      const chosen = candidates ?? synthesizeByRules(answers);

      const createdAt = now().toISOString();
      const records: MemoryRecord[] = chosen.map((candidate) => ({
        id: newId('m'),
        workspaceId,
        text: candidate.text,
        kind: candidate.kind,
        source: `review:${date}`,
        createdAt
      }));
      const items = await appendRecords(workspaceId, records);
      return { items, generatedBy };
    },

    async getProfile(workspaceId?: string) {
      return buildProfile(await collectRecords(workspaceId), now(), workspaceId);
    },

    async updateRecord(input: UpdateMemoryInput): Promise<MemoryRecord> {
      const workspaceId = requireWorkspaceId(input?.workspaceId);
      const id = requireMemoryId(input?.id);
      const text = input.text !== undefined ? requireMemoryText(input.text) : undefined;
      const kind = input.kind !== undefined ? requireMemoryKind(input.kind) : undefined;

      return runExclusively(async () => {
        const records = await readRecords(workspaceId);
        const index = records.findIndex((record) => record.id === id);
        if (index < 0) throw new Error('记忆不存在');
        const current = records[index]!;
        const next: MemoryRecord = {
          ...current,
          ...(text !== undefined ? { text } : {}),
          ...(kind !== undefined ? { kind } : {})
        };
        const updated = [...records];
        updated[index] = next;
        await writeFileAtomic(
          memoryFile(vaultRoot, workspaceId),
          serializeMemoryRecords(updated)
        );
        return next;
      });
    },

    async deleteRecord(input: DeleteMemoryInput): Promise<void> {
      const workspaceId = requireWorkspaceId(input?.workspaceId);
      const id = requireMemoryId(input?.id);

      await runExclusively(async () => {
        const records = await readRecords(workspaceId);
        const remaining = records.filter((record) => record.id !== id);
        if (remaining.length === records.length) throw new Error('记忆不存在');
        await writeFileAtomic(
          memoryFile(vaultRoot, workspaceId),
          serializeMemoryRecords(remaining)
        );
      });
    }
  };
}
