import {
  formatLocalDate,
  formatLocalDateTime,
  formatMonthDay,
  isLocalDate,
  isLocalDateTime,
  isMutedOn
} from './date';
import type { Reminder } from './workspace';
import { effectiveReminderState, reminderState } from './workspace';

/**
 * The read-only shape of a promise, as the notification center sees it. The
 * main process owns the full record; the renderer only displays open promises
 * and never edits them (acting on a promise goes through chat).
 */
export interface CommitmentSummary {
  id: string;
  text: string;
  /** Local date YYYY-MM-DD the user promised to do it. */
  due: string;
  status: 'open' | 'done' | 'dropped';
  createdAt?: string;
  resolvedAt?: string;
  workspaceId?: string;
}

/**
 * One row the user can act on now. `dueAt` is the local wall-clock moment the
 * row became (or will become) actionable; `overdue` only means the moment is
 * before today, never a guess.
 */
export interface NotificationEntry {
  kind: 'reminder' | 'commitment';
  id: string;
  title: string;
  detail: string;
  dueAt: string;
  overdue: boolean;
}

export interface NotificationDigest {
  items: NotificationEntry[];
  /** The stored mute-until day while proactive check-ins are muted, else null. */
  mutedUntil: string | null;
}

type DigestInput = {
  reminders: readonly Reminder[];
  commitments: readonly CommitmentSummary[];
  /** `settings.notifications.snoozedUntil`; empty or past means not muted. */
  snoozedUntil?: string | null;
  now: Date;
};

/** Local weekday (0 = Sunday … 6 = Saturday) a reminder repeats on. */
function repeatApplies(days: number[] | undefined, weekday: number): boolean {
  return !days || days.length === 0 || days.includes(weekday);
}

/** The local calendar day of an ISO timestamp, or null when unreadable. */
function localDayOf(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return formatLocalDate(date);
}

/**
 * Everything the notification center may show, derived from the stores the
 * shell already holds. Rules, in order:
 *
 * - a reminder must be enabled and not `done`;
 * - its postponed moment replaces today's normal one;
 * - a reminder repeats only on its weekdays;
 * - a row appears once its moment has passed, plus an occurrence that fired
 *   on an earlier day and was never finished (overdue, even before today's
 *   time comes around);
 * - a commitment appears while it is open and due today or earlier.
 *
 * Nothing is synthesized: an empty input gives an empty digest.
 */
export function collectNotifications({
  reminders,
  commitments,
  snoozedUntil,
  now
}: DigestInput): NotificationDigest {
  const today = formatLocalDate(now);
  const nowLabel = formatLocalDateTime(now);
  const weekday = now.getDay();
  const items: NotificationEntry[] = [];

  for (const reminder of reminders) {
    const state = reminderState(reminder);
    // `done` only suppresses the day it was finished; from the next day the
    // shared rule reads it as pending. Legacy `done` without `doneAt` stays done.
    if (!reminder.enabled || effectiveReminderState(reminder, today) === 'done') continue;

    const postponed = state === 'postponed' && isLocalDateTime(reminder.postponedTo);
    const firedDay = reminder.firedAt ? localDayOf(reminder.firedAt) : null;
    // A delivery recorded on an earlier day that was never finished is still
    // actionable, whether or not the reminder repeats on today's weekday.
    const missedEarlier = firedDay !== null && firedDay < today;

    let dueAt: string | null = null;
    let overdue = false;

    if (postponed) {
      dueAt = reminder.postponedTo as string;
      overdue = dueAt.slice(0, 10) < today;
      // A postponement into the future is not actionable yet.
      if (!overdue && dueAt > nowLabel) continue;
    } else if (missedEarlier && firedDay !== null) {
      dueAt = `${firedDay}T${reminder.time}`;
      overdue = true;
    } else if (repeatApplies(reminder.days, weekday)) {
      const todayAt = `${today}T${reminder.time}`;
      // Today's occurrence is actionable once its clock time has passed.
      if (todayAt > nowLabel) continue;
      dueAt = todayAt;
    } else {
      continue;
    }

    items.push({
      kind: 'reminder',
      id: reminder.id,
      title: reminder.label,
      detail: overdue
        ? `原定 ${formatMonthDay(dueAt.slice(0, 10))} ${dueAt.slice(11, 16)}，还没处理`
        : `${dueAt.slice(11, 16)} 的提醒还没处理`,
      dueAt,
      overdue
    });
  }

  for (const commitment of commitments) {
    if (commitment.status !== 'open') continue;
    if (!isLocalDate(commitment.due) || commitment.due > today) continue;
    const overdue = commitment.due < today;
    items.push({
      kind: 'commitment',
      id: commitment.id,
      title: commitment.text,
      detail: overdue
        ? `答应 ${formatMonthDay(commitment.due)} 做到 · 已过期，回对话里回应`
        : '答应今天做到 · 回对话里回应',
      dueAt: `${commitment.due}T00:00`,
      overdue
    });
  }

  items.sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      a.dueAt.localeCompare(b.dueAt) ||
      a.title.localeCompare(b.title)
  );

  return {
    items,
    mutedUntil: isMutedOn(snoozedUntil, today) ? (snoozedUntil as string) : null
  };
}

/** `已静音至 11月25日`, or the one-day form when the mute ends today. */
export function snoozeLabel(mutedUntil: string, today: string): string | null {
  if (!isLocalDate(mutedUntil) || !isLocalDate(today) || mutedUntil < today) {
    return null;
  }
  return mutedUntil === today
    ? '今天已静音，明天恢复'
    : `已静音至 ${formatMonthDay(mutedUntil)}`;
}
