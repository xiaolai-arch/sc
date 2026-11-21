import { createMutex, readFileOrNull, writeFileAtomic } from '../workspace/fs-utils';
import { newId } from '../workspace/ids';
import { weekAvailabilityFile } from '../workspace/paths';
import {
  isInsideWeek,
  isIsoDate,
  isMonday,
  MAX_WEEK_NOTE,
  parseWeekAvailabilityFile,
  serializeWeekAvailabilityFile,
  type WeekAvailability
} from './records';

export type { WeekAvailability } from './records';

export interface SetWeekAvailabilityInput {
  /** The Monday starting the week, YYYY-MM-DD. */
  weekStart: string;
  /** Dates inside that week the user named; sorted and deduplicated here. */
  busyDates: string[];
  /** Optional context in the user's words, at most `MAX_WEEK_NOTE` chars. */
  note?: string;
}

/**
 * Vault-backed answers to one Sunday-review question: which days next week
 * are especially full. One `week-availability.md` at the vault root holds one
 * record per week; the frontmatter `items` is the machine-readable source of
 * truth and replacing a week never touches the other weeks' entries.
 */
export interface AvailabilityService {
  list(): Promise<WeekAvailability[]>;
  /** Stored busy dates within `[from, to]`, ascending. */
  busyDatesBetween(from: string, to: string): Promise<string[]>;
  /** Inserts or replaces the record for `weekStart`'s week. */
  set(input: SetWeekAvailabilityInput): Promise<WeekAvailability>;
}

export interface AvailabilityServiceOptions {
  /** Vault root (the directory holding `week-availability.md`). */
  root: string;
  now?: () => Date;
}

function requireWeekStart(value: unknown): string {
  const weekStart = typeof value === 'string' ? value.trim() : '';
  if (!isMonday(weekStart)) {
    throw new Error('weekStart 必须是某一周的周一（YYYY-MM-DD）。');
  }
  return weekStart;
}

function requireBusyDates(value: unknown, weekStart: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('请说出这一周特别满的是哪几天（周一至周日）。');
  }
  const dates = new Set<string>();
  for (const entry of value) {
    const date = typeof entry === 'string' ? entry.trim() : '';
    if (!isInsideWeek(weekStart, date)) {
      throw new Error(
        `busyDates 必须是 ${weekStart} 到当周日之间的日期（YYYY-MM-DD）。`
      );
    }
    dates.add(date);
  }
  return [...dates].sort();
}

function normalizeNote(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('备注无效。');
  const note = value.trim();
  if (!note) return undefined;
  if (note.length > MAX_WEEK_NOTE) {
    throw new Error(`备注不能超过 ${MAX_WEEK_NOTE} 字。`);
  }
  return note;
}

export function createAvailabilityService(
  options: AvailabilityServiceOptions
): AvailabilityService {
  const root = options.root;
  const now = options.now ?? (() => new Date());
  const runExclusively = createMutex();
  const file = weekAvailabilityFile(root);

  async function readAll(): Promise<WeekAvailability[]> {
    const raw = await readFileOrNull(file);
    return raw === null ? [] : parseWeekAvailabilityFile(raw);
  }

  async function writeAll(records: readonly WeekAvailability[]): Promise<void> {
    await writeFileAtomic(file, serializeWeekAvailabilityFile(records));
  }

  return {
    async list(): Promise<WeekAvailability[]> {
      return readAll();
    },

    async busyDatesBetween(from: string, to: string): Promise<string[]> {
      if (!isIsoDate(from) || !isIsoDate(to)) {
        throw new Error('busyDatesBetween 需要两个 YYYY-MM-DD 日期。');
      }
      if (from > to) return [];
      const dates = new Set<string>();
      for (const record of await readAll()) {
        for (const date of record.busyDates) {
          if (date >= from && date <= to) dates.add(date);
        }
      }
      return [...dates].sort();
    },

    async set(input: SetWeekAvailabilityInput): Promise<WeekAvailability> {
      const weekStart = requireWeekStart(input?.weekStart);
      const busyDates = requireBusyDates(input?.busyDates, weekStart);
      const note = normalizeNote(input?.note);
      return runExclusively(async () => {
        const records = await readAll();
        const record: WeekAvailability = {
          id: newId('wa'),
          weekStart,
          busyDates,
          createdAt: now().toISOString(),
          ...(note ? { note } : {})
        };
        // Keep the file ordered by week; the replaced week is the only entry
        // whose content changes, so untouched weeks keep their exact bytes.
        const next = [
          ...records.filter((entry) => entry.weekStart !== weekStart),
          record
        ].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
        await writeAll(next);
        return record;
      });
    }
  };
}
