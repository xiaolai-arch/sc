import type { NoteMeta } from '../../shared/types';
import { isLocalDate, rolloverIsoDate } from '../../shared/date';
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

/**
 * True for a real calendar date written as YYYY-MM-DD. Delegates to the shared
 * exact-shape + rollover check, so impossible days the Date constructor would
 * roll over (`2026-02-30`) are refused instead of being silently accepted.
 */
export function isIsoDate(value: string | undefined): value is string {
  return typeof value === 'string' && isLocalDate(value);
}

/**
 * The real day the old lenient parser read `value` as, or undefined when it is
 * already real or unreadable. Availability records keep the week the old code
 * scheduled against: `2026-02-30` was read as Monday `2026-03-02`, so it stays
 * the week of 03-02 instead of clamping to a Saturday inside another week.
 */
function repairWeekDate(value: unknown): string | undefined {
  return rolloverIsoDate(value);
}

/**
 * True when `value` is a real date that is exactly a Monday.
 *
 * The UTC weekday read is deliberate: for an already-valid `YYYY-MM-DD` string
 * it cannot shift with the machine's timezone, unlike a local `getDay()`.
 */
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

/**
 * The Monday the old lenient parser read `weekStart` as, or undefined.
 *
 * Only a value the old rule already accepted is repaired: the old `isMonday`
 * ran on the rolled-over `Date`, so it kept exactly the impossible days that
 * land on a Monday (`2026-02-30` → Monday `2026-03-02`). Anything the old code
 * skipped stays skipped, so this change never resurrects a week it had dropped.
 */
function repairWeekStart(value: unknown): string | undefined {
  const rolled = repairWeekDate(value);
  if (rolled === undefined) return undefined;
  return isMonday(rolled) ? rolled : undefined;
}

/**
 * A busy date repaired the same way as `weekStart`, then kept only when it
 * still falls inside the repaired week and is a real day.
 */
function repairBusyDate(value: string, weekStart: string): string | undefined {
  if (isIsoDate(value)) return isInsideWeek(weekStart, value) ? value : undefined;
  const repaired = repairWeekDate(value);
  if (repaired === undefined) return undefined;
  return isInsideWeek(weekStart, repaired) ? repaired : undefined;
}

/** Keeps only real dates inside the week, deduplicated and ascending. */
function normalizeBusyDates(value: unknown, weekStart: string): string[] {
  const dates = new Set<string>();
  for (const entry of asStringArray(value)) {
    const repaired = repairBusyDate(entry, weekStart);
    if (repaired !== undefined) dates.add(repaired);
  }
  return [...dates].sort();
}

/**
 * Tolerant read: an entry missing its id, a real Monday `weekStart`, or with
 * no usable busy date is skipped instead of failing the whole file, so one
 * hand edit in Obsidian cannot hide the other weeks.
 *
 * A `weekStart` or busy day the old lenient parser accepted is repaired, not
 * skipped: a strict validator must never make an existing week disappear from
 * the user's vault on the next write.
 */
function coerceWeekAvailability(value: unknown): WeekAvailability | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = asString(record.id)?.trim();
  const rawWeekStart = asString(record.weekStart);
  const weekStart = isMonday(rawWeekStart)
    ? rawWeekStart
    : repairWeekStart(rawWeekStart);
  if (!id || weekStart === undefined) return null;
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
  return mergeDuplicateWeeks(
    meta.items
      .map(coerceWeekAvailability)
      .filter((entry): entry is WeekAvailability => entry !== null)
  );
}

/**
 * Collapses records that name the same week into one, deterministically.
 *
 * A repaired fake `weekStart` (the old parser read `2026-02-30` as Monday
 * `2026-03-02`) can collide with a real record for that same week, and this
 * module must never hand out the same week twice. The survivor is the record
 * with the earliest `createdAt`, ties falling to the smaller `id` — both
 * compared in code-unit order, so neither the host locale nor the file's
 * entry order can decide. Its id and createdAt live on; busy days are the
 * deduplicated, ascending union; the note is the survivor's own, or — when it
 * has none — the earliest non-empty note among the others in that same
 * deterministic order. Weeks that appear once pass through untouched, so a
 * clean file keeps its exact records and order and serializes byte-identically.
 */
function mergeDuplicateWeeks(records: WeekAvailability[]): WeekAvailability[] {
  const byWeek = new Map<string, WeekAvailability[]>();
  for (const record of records) {
    const bucket = byWeek.get(record.weekStart);
    if (bucket === undefined) byWeek.set(record.weekStart, [record]);
    else bucket.push(record);
  }
  return [...byWeek.values()].map((group) => {
    if (group.length === 1) return group[0]!;
    const ordered = [...group].sort(compareStoredRecords);
    const survivor = ordered[0]!;
    const note =
      survivor.note ?? ordered.find((entry) => entry.note !== undefined)?.note;
    return {
      id: survivor.id,
      weekStart: survivor.weekStart,
      busyDates: [...new Set(ordered.flatMap((entry) => entry.busyDates))].sort(),
      createdAt: survivor.createdAt,
      ...(note !== undefined ? { note } : {})
    };
  });
}

/** Code-unit order on (createdAt, id): total, locale-free, file-order-free. */
function compareStoredRecords(a: WeekAvailability, b: WeekAvailability): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
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
