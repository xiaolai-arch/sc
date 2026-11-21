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
