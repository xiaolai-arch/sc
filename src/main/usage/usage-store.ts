import { chmod, readFile } from 'node:fs/promises';
import { formatLocalDate, parseLocalDate } from '../../shared/date';
import type { UsageEntry } from '../../shared/usage';
import { createMutex, writeFileAtomic } from '../workspace/fs-utils';

export interface UsageStoreOptions {
  now?: () => Date;
  /** Entries older than this many local days are pruned on write. */
  maxDays?: number;
}

export type UsageRecordInput = Pick<
  UsageEntry,
  'provider' | 'model' | 'inputTokens' | 'outputTokens'
>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0;
}

function normalizeEntry(value: unknown): UsageEntry | null {
  if (!isRecord(value)) return null;
  const date = typeof value['date'] === 'string' ? value['date'] : '';
  const provider = typeof value['provider'] === 'string' ? value['provider'] : '';
  const model = typeof value['model'] === 'string' ? value['model'] : '';
  if (!DATE_PATTERN.test(date) || provider.length === 0) return null;
  return {
    date,
    provider,
    model,
    inputTokens: nonNegativeInteger(value['inputTokens']),
    outputTokens: nonNegativeInteger(value['outputTokens']),
    calls: nonNegativeInteger(value['calls'])
  };
}

async function readEntries(filePath: string): Promise<UsageEntry[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeEntry)
      .filter((entry): entry is UsageEntry => entry !== null);
  } catch {
    // Missing or corrupt files read as an empty history.
    return [];
  }
}

async function writeEntries(filePath: string, entries: readonly UsageEntry[]): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(entries, null, 2)}\n`);
  await chmod(filePath, 0o600);
}

/**
 * Local-only token accounting. `usage.json` never stores prompts or replies,
 * only per-day provider/model token and call counts.
 */
export class UsageStore {
  private readonly filePath: string;
  private readonly now: () => Date;
  private readonly maxDays: number;
  private readonly runExclusively = createMutex();

  constructor(filePath: string, options: UsageStoreOptions = {}) {
    this.filePath = filePath;
    this.now = options.now ?? (() => new Date());
    this.maxDays = Math.max(1, Math.trunc(options.maxDays ?? 90));
  }

  async list(): Promise<UsageEntry[]> {
    return this.runExclusively(async () => readEntries(this.filePath));
  }

  async record(input: UsageRecordInput): Promise<void> {
    await this.runExclusively(async () => {
      const date = formatLocalDate(this.now());
      const entries = await readEntries(this.filePath);
      const existing = entries.find(
        (entry) =>
          entry.date === date &&
          entry.provider === input.provider &&
          entry.model === input.model
      );
      const inputTokens = nonNegativeInteger(input.inputTokens);
      const outputTokens = nonNegativeInteger(input.outputTokens);

      if (existing) {
        existing.inputTokens += inputTokens;
        existing.outputTokens += outputTokens;
        existing.calls += 1;
      } else {
        entries.push({
          date,
          provider: input.provider,
          model: input.model,
          inputTokens,
          outputTokens,
          calls: 1
        });
      }

      const cutoffDate = parseLocalDate(date);
      cutoffDate.setDate(cutoffDate.getDate() - (this.maxDays - 1));
      const cutoff = formatLocalDate(cutoffDate);
      await writeEntries(
        this.filePath,
        entries.filter((entry) => entry.date >= cutoff)
      );
    });
  }

  async clear(): Promise<void> {
    await this.runExclusively(async () => {
      await writeEntries(this.filePath, []);
    });
  }
}
