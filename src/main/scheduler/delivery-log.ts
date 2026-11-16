import { readFileOrNull, writeFileAtomic } from '../workspace/fs-utils';

export interface DeliveryLog {
  /** Keys already delivered on that local date. */
  load(date: string): Promise<string[]>;
  /** Replaces the stored keys for that date. */
  save(date: string, keys: readonly string[]): Promise<void>;
}

type Stored = { date: string; keys: string[] };

function parse(raw: string | null): Stored | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<Stored>;
    if (typeof value.date !== 'string' || !Array.isArray(value.keys)) return null;
    return {
      date: value.date,
      keys: value.keys.filter((key): key is string => typeof key === 'string')
    };
  } catch {
    return null;
  }
}

/**
 * Persists which reminders/check-ins already fired today. The scheduler is
 * in-memory, so without this a restart would deliver the morning reminder a
 * second time; keeping only today's keys also means yesterday's file is
 * naturally forgotten.
 */
export function createDeliveryLog(filePath: string): DeliveryLog {
  return {
    async load(date) {
      const stored = parse(await readFileOrNull(filePath));
      return stored !== null && stored.date === date ? stored.keys : [];
    },
    async save(date, keys) {
      const stored: Stored = { date, keys: [...new Set(keys)] };
      await writeFileAtomic(filePath, `${JSON.stringify(stored, null, 2)}\n`);
    }
  };
}
