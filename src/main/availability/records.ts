import type { NoteMeta } from '../../shared/types';
import { parseNote, serializeNote } from '../vault/note';
import { asRecord, asString, asStringArray } from '../workspace/records/coerce';

/**
 * Which days of one week the user said are especially full. One vault-level
 * `week-availability.md` holds one record per week so every planner (daily and
 * long-term) can give those days one small task instead of a normal-sized plan.
 */
export interface WeekAvailability {
  id: string;
  /** The Monday starting the week, written YYYY-MM-DD. */
  weekStart: string;
  /** The dates inside that Monday..Sunday week the user named, unique and ascending. */
  busyDates: string[];
  /** Optional context in the user's own words, at most `MAX_WEEK_NOTE` chars. */
  note?: string;
  /** ISO timestamp of the record. */
  createdAt: string;
}

export const MAX_WEEK_NOTE = 100;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    ISO_DATE.test(value) &&
    !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
  );
}

/** True when `value` is a real date that is exactly a Monday. */
export function isMonday(value: string | undefined): value is string {
  if (!isIsoDate(value)) return false;
  // Pure-date arithmetic in UTC, so the weekday cannot shift with the clock.
  return new Date(`${value}T00:00:00Z`).getUTCDay() === 1;
}

/** True when `date` lies inside the Monday..Sunday week starting `weekStart`. */
export function isInsideWeek(weekStart: string, date: string): boolean {
  if (!isIsoDate(weekStart) || !isIsoDate(date)) return false;
  const start = Date.parse(`${weekStart}T00:00:00Z`);
  const day = Date.parse(`${date}T00:00:00Z`);
  return day >= start && day <= start + 6 * 86_400_000;
}

const WEEKDAY_WORDS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

/** `周一`..`周日` for a real ISO date; undefined for anything else. */
export function weekdayWord(date: string): string | undefined {
  if (!isIsoDate(date)) return undefined;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return WEEKDAY_WORDS[(day + 6) % 7];
}

/** Keeps only real dates inside the week, deduplicated and ascending. */
function normalizeBusyDates(value: unknown, weekStart: string): string[] {
  const dates = new Set<string>();
  for (const entry of asStringArray(value)) {
    if (isInsideWeek(weekStart, entry)) dates.add(entry);
  }
  return [...dates].sort();
}

/**
 * Tolerant read: an entry missing its id, a real Monday `weekStart`, or with
 * no usable busy date is skipped instead of failing the whole file, so one
 * hand edit in Obsidian cannot hide the other weeks.
 */
function coerceWeekAvailability(value: unknown): WeekAvailability | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = asString(record.id)?.trim();
  const weekStart = asString(record.weekStart);
  if (!id || !isMonday(weekStart)) return null;
  const busyDates = normalizeBusyDates(record.busyDates, weekStart);
  if (busyDates.length === 0) return null;
  const createdAt = asString(record.createdAt) ?? '';
  const note = asString(record.note)?.trim();
  return {
    id,
    weekStart,
    busyDates,
    createdAt,
    ...(note ? { note } : {})
  };
}

export function parseWeekAvailabilityFile(raw: string): WeekAvailability[] {
  const { meta } = parseNote(raw);
  if (!Array.isArray(meta.items)) return [];
  return meta.items
    .map(coerceWeekAvailability)
    .filter((entry): entry is WeekAvailability => entry !== null);
}

/**
 * Writes only the known fields, in a fixed order, so a file this app wrote
 * parses and serializes back byte-identically while nothing is changed.
 */
export function serializeWeekAvailabilityFile(
  records: readonly WeekAvailability[]
): string {
  const meta: NoteMeta = {
    type: 'log',
    source: 'user',
    kind: 'week-availability',
    items: records.map((record) => ({
      id: record.id,
      weekStart: record.weekStart,
      busyDates: [...record.busyDates],
      createdAt: record.createdAt,
      ...(record.note ? { note: record.note } : {})
    }))
  };
  const lines = records.map((record) => {
    const days =
      record.busyDates
        .map((date) => weekdayWord(date) ?? date)
        .join('、') || '（未指明哪几天）';
    const note = record.note ? `（${record.note}）` : '';
    return `- ${record.weekStart} 那一周：${days}特别满${note}`;
  });
  const body = ['# 下周安排', '', ...lines, ''].join('\n');
  return serializeNote(meta, body);
}
