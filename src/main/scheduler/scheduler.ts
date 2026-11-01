import { formatLocalDate } from '../../shared/date';
import type { AppSettings } from '../../shared/types';
import type { Reminder, WorkspaceTask } from '../../shared/workspace';
import {
  isTimeReached,
  notificationState,
  type NotificationState
} from './time';

export type SchedulerTriggerKind =
  | 'morning-plan'
  | 'evening-review'
  | 'weekly-review'
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
  notify: (notification: SchedulerNotification) => void | Promise<void>;
  /** Called once before the morning notification is shown. */
  onMorningPlan?: (date: string) => void | Promise<void>;
  /** Called once before the evening notification is shown. */
  onEveningReview?: (date: string) => void | Promise<void>;
  /**
   * Generates the proactive check-in. Returning null means intentionally
   * skipped (budget/duplicate); the trigger is consumed without a notification.
   */
  onCheckIn?: (
    kind: 'morning' | 'evening' | 'weekly',
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
  title: string;
  body: string;
  reminderId?: string;
  taskId?: string;
  conversationId?: string;
}

const SNOOZE_INTERVAL_MS = 30_000;

function keyFor(date: string, trigger: Trigger): string {
  return `${date}:${trigger.kind}:${trigger.id}`;
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

  // Only the two seed vault mirrors are deduped against built-in check-ins.
  // A user-created reminder at 08:00 must still fire even if the check-in is
  // snoozed or skipped, as the UI promises. The weekly recap is Sunday-only,
  // so it is skipped precisely in runTick instead.
  const checkInTimes = new Set([settings.notifications.morning, settings.notifications.evening]);
  for (const reminder of reminders) {
    const seedMirror =
      (reminder.id === 'r1' && reminder.label === '早间计划') ||
      (reminder.id === 'r2' && reminder.label === '晚间复盘');
    if (!reminder.enabled || (seedMirror && checkInTimes.has(reminder.time))) continue;
    triggers.push({
      kind: 'reminder',
      id: reminder.id,
      time: reminder.time,
      title: `提醒：${reminder.label}`,
      body: reminder.label,
      reminderId: reminder.id
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
export class Scheduler {
  private readonly now: () => Date;
  private readonly getSettings: () => Promise<AppSettings>;
  private readonly getReminders: () => Promise<Reminder[]>;
  private readonly getScheduledTasks: () => Promise<WorkspaceTask[]>;
  private readonly notify: (notification: SchedulerNotification) => void | Promise<void>;
  private readonly onMorningPlan: ((date: string) => void | Promise<void>) | undefined;
  private readonly onEveningReview: ((date: string) => void | Promise<void>) | undefined;
  private readonly onCheckIn:
    | ((
        kind: 'morning' | 'evening' | 'weekly',
        date: string
      ) => Promise<SchedulerNotification | null> | SchedulerNotification | null)
    | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly delivered = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<SchedulerTickResult> | null = null;

  constructor(options: SchedulerOptions) {
    this.now = options.now ?? (() => new Date());
    this.getSettings = options.getSettings;
    this.getReminders = options.getReminders ?? (async () => []);
    this.getScheduledTasks = options.getScheduledTasks ?? (async () => []);
    this.notify = options.notify;
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

  private async runTick(): Promise<SchedulerTickResult> {
    const at = this.now();
    const date = formatLocalDate(at);
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
        trigger.kind === 'reminder' &&
        settings.notifications.weeklyEnabled &&
        at.getDay() === 0 &&
        trigger.time === settings.notifications.weekly
      ) {
        continue;
      }
      if (!isTimeReached(at, trigger.time)) continue;
      const key = keyFor(date, trigger);
      if (this.delivered.has(key)) continue;

      if (state !== 'enabled') {
        result.suppressed.push({ key, kind: trigger.kind, reason: state });
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
        if (
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
        await this.notify(notification);
        this.delivered.add(key);
        result.delivered.push(notification);
      } catch {
        // Leave the key unconsumed so a later tick can retry exactly once.
        result.failed.push(key);
      }
    }

    return result;
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
