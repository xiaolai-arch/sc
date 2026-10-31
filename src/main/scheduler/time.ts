import type { AppSettings } from '../../shared/types';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Converts a validated `HH:MM` value into minutes since local midnight. */
export function minutesSinceMidnight(time: string): number | null {
  const match = TIME_PATTERN.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Local wall-clock minutes for a date (seconds are intentionally ignored). */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * True when the local time falls inside the do-not-disturb window. Windows may
 * wrap midnight (`23:00` → `07:30`). Equal boundaries mean "no DND window".
 */
export function isWithinDnd(date: Date, dndStart: string, dndEnd: string): boolean {
  const start = minutesSinceMidnight(dndStart);
  const end = minutesSinceMidnight(dndEnd);
  if (start === null || end === null || start === end) return false;
  const current = minutesOfDay(date);
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

export type NotificationState = 'enabled' | 'disabled' | 'dnd';

export function notificationState(settings: AppSettings, date: Date): NotificationState {
  if (!settings.notifications.enabled) return 'disabled';
  const { dndStart, dndEnd } = settings.notifications;
  return isWithinDnd(date, dndStart, dndEnd) ? 'dnd' : 'enabled';
}

/** Single gate shared by the scheduler and tray so both agree on DND rules. */
export function notificationsAllowed(settings: AppSettings, date: Date): boolean {
  return notificationState(settings, date) === 'enabled';
}

/** Returns true once the local clock has reached `time` on that calendar day. */
export function isTimeReached(date: Date, time: string): boolean {
  const target = minutesSinceMidnight(time);
  if (target === null) return false;
  return minutesOfDay(date) >= target;
}
