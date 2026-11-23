export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real local calendar date written exactly as `YYYY-MM-DD`. */
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = LOCAL_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  );
}

/**
 * Repairs a stored `YYYY-MM-DD` that only the old lenient parser accepted,
 * because the Date constructor rolls an impossible day over into the next
 * month (`2026-02-30` was read as March 2). The day is clamped to the last real
 * day of the month it was written for, so `2026-02-30` becomes `2026-02-28`.
 *
 * Returns undefined for a real date, for an unreadable shape, and for a bad
 * month, so callers can treat that as "nothing to repair". A four-digit year
 * below 100 is refused because `new Date(year, ...)` would shift it to 1900s.
 */
export function repairRolloverDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = LOCAL_DATE.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return undefined;
  // Day 0 of the next month is the last day of this one, leap years included.
  const lastDay = new Date(year, month, 0).getDate();
  if (day < 1 || day <= lastDay) return undefined;
  const repaired = new Date(year, month - 1, lastDay);
  if (repaired.getFullYear() !== year || repaired.getMonth() !== month - 1) {
    return undefined;
  }
  return formatLocalDate(repaired);
}

/**
 * The day the old lenient `Date` parser read `value` as, e.g. `2026-02-30` →
 * `2026-03-02`, or undefined when the value is already a real date or cannot
 * be read at all. Used to repair availability records, where the weekday and
 * the Monday..Sunday week the old code scheduled against must be preserved;
 * the same-month clamp would move the day out of that week.
 */
export function rolloverIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !LOCAL_DATE.test(value)) return undefined;
  if (isLocalDate(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * True when `date` is on or before the stored mute-until day. An empty,
 * malformed or already past `until` leaves check-ins unmuted, so a stored date
 * equal to today behaves exactly like the old single-day snooze.
 */
export function isMutedOn(until: string | null | undefined, date: string): boolean {
  if (!isLocalDate(until) || !isLocalDate(date)) return false;
  return date <= until;
}

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

/** True for a wall-clock local time such as `2026-11-01T14:30`. */
export function isLocalDateTime(value: unknown): value is string {
  return typeof value === 'string' && LOCAL_DATE_TIME.test(value);
}

/** Formats a Date as the local wall clock `YYYY-MM-DDTHH:mm`. */
export function formatLocalDateTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${formatLocalDate(date)}T${hours}:${minutes}`;
}

/** Splits a local datetime into its calendar day and `HH:MM` clock time. */
export function splitLocalDateTime(
  value: unknown
): { date: string; time: string } | null {
  if (!isLocalDateTime(value)) return null;
  return { date: value.slice(0, 10), time: value.slice(11, 16) };
}

/** A local calendar date N days after `value`, still as `YYYY-MM-DD`. */
export function addLocalDays(value: string, days: number): string {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

/** Compact label for a stored local date, e.g. `11月25日`. */
export function formatMonthDay(value: string): string {
  if (!isLocalDate(value)) return value;
  const [, month, day] = value.split('-').map(Number);
  return `${month}月${day}日`;
}

export function formatChineseDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date
    .toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
    .replace('星期', ' 星期');
}
