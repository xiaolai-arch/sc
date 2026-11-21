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

export function formatChineseDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date
    .toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
    .replace('星期', ' 星期');
}
