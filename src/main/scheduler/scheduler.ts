import { formatLocalDate, splitLocalDateTime } from '../../shared/date';
import type { AppSettings } from '../../shared/types';
import {
  effectiveReminderState,
  type Reminder,
  type ReminderState,
  type ReminderStatePatch,
  type WorkspaceTask
} from '../../shared/workspace';
import type { DeliveryLog } from './delivery-log';
import {
  BEHIND_SCHEDULE_TITLE,
  buildBehindScheduleNotification,
  isTaskForDate
} from './behind-schedule';
import {
  isTimeReached,
  notificationState,
  type NotificationState
} from './time';

/** Three ticks (90s by default) is enough for a transient OS/IO failure. */
const MAX_TRIGGER_ATTEMPTS = 3;

export type SchedulerTriggerKind =
  | 'morning-plan'
  | 'evening-review'
  | 'weekly-review'
  | 'behind-schedule'
  | 'reminder'
  | 'task';

export interface SchedulerNotification {
  /** Stable per calendar day so a trigger can only be delivered once. */
  key: string;
  kind: SchedulerTriggerKind;
  date: string;
  scheduledTime: string;
  title: string;
  body: string;
  reminderId?: string;
  taskId?: string;
  conversationId?: string;
}

export interface SuppressedTrigger {
  key: string;
  kind: SchedulerTriggerKind;
  reason: Exclude<NotificationState, 'enabled'>;
}

export interface SchedulerTickResult {
  delivered: SchedulerNotification[];
  suppressed: SuppressedTrigger[];
  /** Keys whose callback or notification sink failed; they may retry later. */
  failed: string[];
}

export interface SchedulerOptions {
  now?: () => Date;
  getSettings: () => Promise<AppSettings>;
  /** Vault-global reminders (`Reminder` has no workspace id in the contract). */
  getReminders?: () => Promise<Reminder[]>;
  /** Tasks pinned to a start time on today's schedule. */
  getScheduledTasks?: () => Promise<WorkspaceTask[]>;
  /**
   * Every task belonging to a calendar day, done ones included. Used only by
   * the 落后提醒 fallback when no check-in service provides the message.
   */
  getTodayTasks?: (date: string) => Promise<WorkspaceTask[]>;
  notify: (notification: SchedulerNotification) => void | Promise<void>;
  /**
   * Persists reminder lifecycle transitions (fired/failed/pending). Optional so
   * read-only scheduler usages keep working; a failed write is reported and
   * never blocks delivery.
   */
  onReminderState?: (id: string, patch: ReminderStatePatch) => void | Promise<void>;
  /** Persists delivered keys so a restart does not repeat today's reminders. */
  deliveryLog?: DeliveryLog;
  /** Called once before the morning notification is shown. */
  onMorningPlan?: (date: string) => void | Promise<void>;
  /** Called once before the evening notification is shown. */
  onEveningReview?: (date: string) => void | Promise<void>;
  /**
   * Generates the proactive check-in. Returning null means intentionally
   * skipped (budget/duplicate); the trigger is consumed without a notification.
   */
  onCheckIn?: (
    kind: 'morning' | 'evening' | 'weekly' | 'behind',
    date: string
  ) => Promise<SchedulerNotification | null> | SchedulerNotification | null;
  onError?: (error: unknown) => void;
}

interface Trigger {
  kind: SchedulerTriggerKind;
  id: string;
  time: string;
  /** 0 = Sunday; omitted means every day. */
  dayOfWeek?: number;
  /** Local weekdays this trigger repeats on; omitted means every day. */
  daysOfWeek?: number[];
  title: string;
  body: string;
  reminderId?: string;
  taskId?: string;
  conversationId?: string;
  /** True while the reminder is due because the user postponed it. */
  postponed?: boolean;
  /** Due immediately regardless of the clock (a stale postponement caught up). */
  catchUp?: boolean;
  /**
   * The state that governs *today*, as computed by `effectiveReminderState`.
   * Carrying the effective state (not the raw `reminder.state`) keeps the
   * next-day rule in one place: the DND branch below writes `pending` only
   * when this says the reminder is neither pending nor postponed, so a
   * reminder finished yesterday is never rewritten back to pending at night.
   */
  effectiveState?: ReminderState;
}

const SNOOZE_INTERVAL_MS = 30_000;

function keyFor(date: string, trigger: Trigger): string {
  // A postponed occurrence gets its own key so the reminder can fire again
  // after the user moves it; the original daily key is already consumed.
  const suffix = trigger.postponed ? `@${trigger.time}` : '';
  return `${date}:${trigger.kind}:${trigger.id}${suffix}`;
}

function buildTriggers(
  settings: AppSettings,
  reminders: Reminder[],
  tasks: WorkspaceTask[] = [],
  date = ''
): Trigger[] {
  const triggers: Trigger[] = [
    {
      kind: 'morning-plan',
      id: 'morning',
      time: settings.notifications.morning,
      title: '早上好，开始今天的计划',
      body: '打开ASAKI，看看今天最重要的三件事。'
    },
    {
      kind: 'evening-review',
      id: 'evening',
      time: settings.notifications.evening,
      title: '今天的复盘时间到了',
      body: '花三分钟记录完成、卡点与明天的第一步。'
    }
  ];

  if (settings.notifications.weeklyEnabled) {
    triggers.push({
      kind: 'weekly-review',
      id: 'weekly',
      time: settings.notifications.weekly,
      dayOfWeek: 0,
      title: '周日复盘时间到了',
      body: '回顾本周的完成与卡点，一起安排下周重点。'
    });
  }

  // 落后提醒: the body depends on today's tasks, so it is composed in runTick;
  // the trigger only claims the configured time and is dropped there when the
  // plan is on track or empty.
  if (settings.notifications.behindScheduleEnabled) {
    triggers.push({
      kind: 'behind-schedule',
      id: 'behind-schedule',
      time: settings.notifications.behindSchedule,
      title: BEHIND_SCHEDULE_TITLE,
      body: ''
    });
  }

  // Only the two seed vault mirrors are deduped against built-in check-ins.
  // A user-created reminder at 08:00 must still fire even if the check-in is
  // snoozed or skipped, as the UI promises. The weekly recap is Sunday-only,
  // so it is skipped precisely in runTick instead.
  const checkInTimes = new Set([settings.notifications.morning, settings.notifications.evening]);
  for (const reminder of reminders) {
    if (!reminder.enabled) continue;
    // `done` is a lifecycle state, not the schedule switch: a completed
    // reminder stays quiet for the day it was finished. From the next day
    // `effectiveReminderState` reads it as pending, so a daily reminder
    // resumes without a manual 重新启用. Legacy `done` without `doneAt` stays
    // permanently quiet, exactly as before.
    //
    // The same value travels with the trigger so the DND branch below never
    // re-derives it: reading the raw `reminder.state` there would treat a
    // promise finished yesterday as still `done` and rewrite it back to
    // `pending` at night, leaving a `pending` + `doneAt` record the user never
    // asked for. One rule, one computation.
    const effectiveState = effectiveReminderState(reminder, date);
    if (effectiveState === 'done') continue;

    const postponed = reminder.postponedTo
      ? splitLocalDateTime(reminder.postponedTo)
      : null;
    if (postponed) {
      // A postponed occurrence replaces today's normal one. A target later
      // than today waits for that day's tick instead of being consumed now.
      if (date !== '' && postponed.date > date) continue;
      triggers.push({
        kind: 'reminder',
        id: reminder.id,
        time: postponed.time,
        postponed: true,
        // Missed while the app was closed: deliver once, then clear it.
        ...(date !== '' && postponed.date < date ? { catchUp: true } : {}),
        title: `提醒：${reminder.label}`,
        body: reminder.label,
        reminderId: reminder.id,
        effectiveState
      });
      continue;
    }

    const seedMirror =
      (reminder.id === 'r1' && reminder.label === '早间计划') ||
      (reminder.id === 'r2' && reminder.label === '晚间复盘');
    if (seedMirror && checkInTimes.has(reminder.time)) continue;
    triggers.push({
      kind: 'reminder',
      id: reminder.id,
      time: reminder.time,
      ...(reminder.days && reminder.days.length > 0 ? { daysOfWeek: reminder.days } : {}),
      title: `提醒：${reminder.label}`,
      body: reminder.label,
      reminderId: reminder.id,
      effectiveState
    });
  }

  for (const task of tasks) {
    if (task.status !== 'pending' && task.status !== 'in-progress') continue;
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(task.startAt ?? '');
    if (match === null || match[1] !== date) continue;
    const time = `${match[2]}:${match[3]}`;
    triggers.push({
      kind: 'task',
      id: task.id,
      time,
      title: `现在该做：${task.title}`,
      body: `${task.subject} · 预计 ${Math.max(task.durationMin, 0)} 分钟`,
      taskId: task.id
    });
  }

  return triggers;
}

/**
 * In-process reminder/check-in scheduler.
 *
 * A trigger fires on the first tick at or after its configured local time and
 * is then recorded for that calendar day. This naturally provides
 * catch-up-once semantics after the machine sleeps, while later ticks and a
 * repeated `start()` never duplicate a notification. DND and the global
 * notification toggle suppress delivery without consuming the trigger, so it
 * can be delivered once the window ends.
 */
/** Date-scoped keys in stable order, so saved snapshots compare reliably. */
function dateKeysOf(keys: Iterable<string>, date: string): string[] {
  return [...keys].filter((key) => key.startsWith(`${date}:`)).sort();
}

export class Scheduler {
  private readonly now: () => Date;
  private readonly getSettings: () => Promise<AppSettings>;
  private readonly getReminders: () => Promise<Reminder[]>;
  private readonly getScheduledTasks: () => Promise<WorkspaceTask[]>;
  private readonly getTodayTasks: (date: string) => Promise<WorkspaceTask[]>;
  private readonly notify: (notification: SchedulerNotification) => void | Promise<void>;
  private readonly onReminderState:
    | ((id: string, patch: ReminderStatePatch) => void | Promise<void>)
    | undefined;
  private readonly deliveryLog: DeliveryLog | undefined;
  /** Date whose delivered keys were loaded from disk; avoids reloading each tick. */
  private hydratedDate: string | null = null;
  /** Last date-scoped key set written to disk; skips unchanged rewrites. */
  private persistedSnapshot: string | null = null;
  private readonly onMorningPlan: ((date: string) => void | Promise<void>) | undefined;
  private readonly onEveningReview: ((date: string) => void | Promise<void>) | undefined;
  private readonly onCheckIn:
    | ((
        kind: 'morning' | 'evening' | 'weekly' | 'behind',
        date: string
      ) => Promise<SchedulerNotification | null> | SchedulerNotification | null)
    | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly delivered = new Set<string>();
  /** Generated notifications whose sink failed; retry the sink, not the work. */
  private readonly pending = new Map<
    string,
    { notification: SchedulerNotification; attempts: number }
  >();
  /** Consecutive callback failures per trigger, so one broken day cannot loop forever. */
  private readonly attempts = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<SchedulerTickResult> | null = null;

  constructor(options: SchedulerOptions) {
    this.now = options.now ?? (() => new Date());
    this.getSettings = options.getSettings;
    this.getReminders = options.getReminders ?? (async () => []);
    this.getScheduledTasks = options.getScheduledTasks ?? (async () => []);
    this.getTodayTasks = options.getTodayTasks ?? (async () => []);
    this.notify = options.notify;
    this.onReminderState = options.onReminderState;
    this.deliveryLog = options.deliveryLog;
    this.onMorningPlan = options.onMorningPlan;
    this.onEveningReview = options.onEveningReview;
    this.onCheckIn = options.onCheckIn;
    this.onError = options.onError;
  }

  /** Runs one scheduler pass. Concurrent calls share the same pass. */
  tick(): Promise<SchedulerTickResult> {
    if (this.running) return this.running;
    const run = this.runTick().finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  private reportError(error: unknown): void {
    try {
      this.onError?.(error);
    } catch {
      // A broken error reporter must not take the scheduler down with it.
    }
  }

  /**
   * Persists a lifecycle transition for a reminder trigger. A broken vault
   * write is reported but never blocks delivery: the notification already
   * reached the user.
   */
  private async writeReminderState(id: string, patch: ReminderStatePatch): Promise<void> {
    if (this.onReminderState === undefined) return;
    try {
      await this.onReminderState(id, patch);
    } catch (error) {
      this.reportError(error);
    }
  }

  /** Delivery succeeded: record `fired` and drop the postponement. */
  private async markFired(trigger: Trigger, at: Date): Promise<void> {
    if (trigger.kind !== 'reminder' || trigger.reminderId === undefined) return;
    if (trigger.postponed) {
      // The postponed occurrence replaces that day's normal one: pretend the
      // regular trigger already fired so it cannot deliver twice.
      this.delivered.add(`${formatLocalDate(at)}:reminder:${trigger.reminderId}`);
    }
    await this.writeReminderState(trigger.reminderId, {
      state: 'fired',
      firedAt: at.toISOString(),
      postponedTo: null,
      // A fresh delivery supersedes yesterday's completion day, so the file
      // matches "fired" and the next-day reset cannot act on it again.
      doneAt: null,
      lastError: null
    });
  }

  /** The notification sink failed: record `failed` with a readable cause. */
  private async markFailed(trigger: Trigger, cause: unknown): Promise<void> {
    if (trigger.kind !== 'reminder' || trigger.reminderId === undefined) return;
    const message = cause instanceof Error ? cause.message : String(cause);
    await this.writeReminderState(trigger.reminderId, {
      state: 'failed',
      lastError: message.trim() || '通知发送失败'
    });
  }

  /** Drops bookkeeping from earlier days so long-running sessions do not grow forever. */
  private pruneOldDays(date: string): void {
    const prefix = `${date}:`;
    for (const key of this.delivered) {
      if (!key.startsWith(prefix)) this.delivered.delete(key);
    }
    for (const key of this.pending.keys()) {
      if (!key.startsWith(prefix)) this.pending.delete(key);
    }
    for (const key of this.attempts.keys()) {
      if (!key.startsWith(prefix)) this.attempts.delete(key);
    }
  }

  private async runTick(): Promise<SchedulerTickResult> {
    const at = this.now();
    const date = formatLocalDate(at);
    await this.hydrateDelivered(date);
    this.pruneOldDays(date);
    const settings = await this.getSettings();
    let reminders: Reminder[] = [];
    try {
      reminders = await this.getReminders();
    } catch {
      // A broken reminder file must not stop the morning/evening triggers.
      reminders = [];
    }
    let scheduledTasks: WorkspaceTask[] = [];
    try {
      scheduledTasks = await this.getScheduledTasks();
    } catch {
      // A broken task file must not stop the morning/evening triggers either.
      scheduledTasks = [];
    }

    const result: SchedulerTickResult = { delivered: [], suppressed: [], failed: [] };
    const state = notificationState(settings, at);

    for (const trigger of buildTriggers(settings, reminders, scheduledTasks, date)) {
      if (trigger.dayOfWeek !== undefined && at.getDay() !== trigger.dayOfWeek) continue;
      if (
        trigger.daysOfWeek !== undefined &&
        !trigger.daysOfWeek.includes(at.getDay())
      ) {
        continue;
      }
      if (
        trigger.kind === 'reminder' &&
        settings.notifications.weeklyEnabled &&
        at.getDay() === 0 &&
        trigger.time === settings.notifications.weekly
      ) {
        continue;
      }
      if (!trigger.catchUp && !isTimeReached(at, trigger.time)) continue;
      const key = keyFor(date, trigger);
      if (this.delivered.has(key)) continue;

      if (state !== 'enabled') {
        // Do not consume the trigger: once DND or the global toggle is off,
        // a later tick still sees it as due and delivers it.
        this.pending.delete(key);
        result.suppressed.push({ key, kind: trigger.kind, reason: state });
        // Keep the lifecycle honest: the reminder is still waiting, not fired.
        // A postponement keeps its own `postponed` state so the page still
        // shows the new time. Only write on a real change, so a long DND
        // window does not rewrite reminders.md every 30 seconds.
        if (
          trigger.kind === 'reminder' &&
          trigger.reminderId !== undefined &&
          trigger.effectiveState !== 'pending' &&
          trigger.effectiveState !== 'postponed'
        ) {
          await this.writeReminderState(trigger.reminderId, { state: 'pending' });
        }
        continue;
      }

      // A previous tick already generated this notification but its sink
      // failed. Retry only the sink so a broken notifier cannot spend another
      // model call or budget unit every 30 seconds.
      const pending = this.pending.get(key);
      if (pending) {
        try {
          await this.notify(pending.notification);
          this.delivered.add(key);
          this.pending.delete(key);
          this.attempts.delete(key);
          result.delivered.push(pending.notification);
          await this.markFired(trigger, at);
        } catch (error) {
          pending.attempts += 1;
          await this.markFailed(trigger, error);
          if (pending.attempts >= MAX_TRIGGER_ATTEMPTS) {
            // Give up on the day rather than retry forever; surface the cause.
            this.delivered.add(key);
            this.pending.delete(key);
            this.reportError(error);
          }
          result.failed.push(key);
        }
        continue;
      }

      let notification: SchedulerNotification = {
        key,
        kind: trigger.kind,
        date,
        scheduledTime: trigger.time,
        title: trigger.title,
        body: trigger.body,
        ...(trigger.reminderId ? { reminderId: trigger.reminderId } : {}),
        ...(trigger.taskId ? { taskId: trigger.taskId } : {})
      };

      try {
        if (trigger.kind === 'behind-schedule') {
          if (this.onCheckIn) {
            const generated = await this.onCheckIn('behind', date);
            if (generated === null) {
              // Nothing is behind today (or the check-in service skipped for a
              // budget/cap/duplicate reason): consume the trigger silently.
              this.delivered.add(key);
              continue;
            }
            notification = {
              ...generated,
              key,
              kind: trigger.kind,
              date,
              scheduledTime: trigger.time
            };
          } else {
            // No check-in service (e.g. a headless context): compose the same
            // deterministic text straight from today's tasks.
            const tasks = await this.getTodayTasks(date);
            const composed = buildBehindScheduleNotification(
              tasks.filter((task) => isTaskForDate(task, date))
            );
            if (composed === null) {
              this.delivered.add(key);
              continue;
            }
            notification = {
              ...notification,
              title: composed.title,
              body: composed.body
            };
          }
        } else if (
          trigger.kind === 'morning-plan' ||
          trigger.kind === 'evening-review' ||
          trigger.kind === 'weekly-review'
        ) {
          if (this.onCheckIn) {
            const kind =
              trigger.kind === 'morning-plan'
                ? 'morning'
                : trigger.kind === 'evening-review'
                  ? 'evening'
                  : 'weekly';
            const generated = await this.onCheckIn(kind, date);
            if (generated === null) {
              // The check-in service decided to skip (duplicate or budget).
              this.delivered.add(key);
              continue;
            }
            notification = {
              ...generated,
              key,
              kind: trigger.kind,
              date,
              scheduledTime: trigger.time
            };
          } else {
            if (trigger.kind === 'morning-plan') await this.onMorningPlan?.(date);
            if (trigger.kind === 'evening-review') await this.onEveningReview?.(date);
          }
        }
      } catch (error) {
        const count = (this.attempts.get(key) ?? 0) + 1;
        if (count >= MAX_TRIGGER_ATTEMPTS) {
          // Consume the trigger after repeated failures; otherwise a broken
          // model or vault read would retry on every tick for the rest of the day.
          this.delivered.add(key);
          this.attempts.delete(key);
          this.reportError(error);
        } else {
          this.attempts.set(key, count);
        }
        result.failed.push(key);
        continue;
      }

      try {
        await this.notify(notification);
        this.delivered.add(key);
        this.attempts.delete(key);
        result.delivered.push(notification);
        await this.markFired(trigger, at);
      } catch (error) {
        // Keep the generated notification so later ticks retry delivery only.
        this.pending.set(key, { notification, attempts: 1 });
        await this.markFailed(trigger, error);
        result.failed.push(key);
      }
    }

    await this.persistDelivered(date);
    return result;
  }

  /** Loads today's delivered keys once; a failed read retries on the next tick. */
  private async hydrateDelivered(date: string): Promise<void> {
    if (this.deliveryLog === undefined || this.hydratedDate === date) return;
    try {
      const keys = await this.deliveryLog.load(date);
      for (const key of keys) this.delivered.add(key);
      this.hydratedDate = date;
      this.persistedSnapshot = dateKeysOf(keys, date).join('\n');
    } catch (error) {
      this.reportError(error);
    }
  }

  /** Best-effort write; notification delivery must not wait on disk. */
  private async persistDelivered(date: string): Promise<void> {
    // Never overwrite the stored set with a partial one when the initial read
    // failed: the next tick reloads and tries again.
    if (this.deliveryLog === undefined || this.hydratedDate !== date) return;
    const keys = dateKeysOf(this.delivered, date);
    const snapshot = keys.join('\n');
    if (snapshot === this.persistedSnapshot) return;
    try {
      await this.deliveryLog.save(date, keys);
      this.persistedSnapshot = snapshot;
    } catch (error) {
      this.reportError(error);
    }
  }

  /**
   * Starts the polling loop. Returns a stop function; calling `start` twice
   * returns the existing loop's stop function rather than creating duplicates.
   */
  start(intervalMs = SNOOZE_INTERVAL_MS): () => void {
    const stop = () => this.stop();
    if (this.timer !== null) return stop;

    void this.tick().catch((error: unknown) => this.onError?.(error));
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => this.onError?.(error));
    }, Math.max(250, intervalMs));
    const timer = this.timer as ReturnType<typeof setInterval> & { unref?: () => void };
    timer.unref?.();
    return stop;
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Test/diagnostic helper: number of triggers consumed for today. */
  get deliveredCount(): number {
    return this.delivered.size;
  }
}

export { buildTriggers };
