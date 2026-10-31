import type { AppContext } from '../context';
import { Scheduler, type SchedulerNotification, type SchedulerOptions } from './scheduler';

export interface ContextSchedulerOptions {
  context: Pick<AppContext, 'api' | 'settings' | 'workspace'>;
  notify: (notification: SchedulerNotification) => void | Promise<void>;
  /** Optional evening hook (e.g. open the review dialog or prime memory). */
  onEveningReview?: (date: string) => void | Promise<void>;
  onError?: (error: unknown) => void;
  now?: () => Date;
}

/**
 * Production-shaped scheduler wiring: settings and reminders always come from
 * the live context, so a vault switch is picked up on the next tick. The
 * morning trigger only plans when today's plan is still missing, avoiding a
 * duplicate model call/overwrite after a restart.
 */
export function createContextScheduler(options: ContextSchedulerOptions): Scheduler {
  const schedulerOptions: SchedulerOptions = {
    getSettings: () => options.context.settings.get(),
    getReminders: () => options.context.workspace.getReminders(),
    notify: options.notify,
    onMorningPlan: async () => {
      const existing = await options.context.api.getTodayPlan();
      if (!existing) await options.context.api.generateTodayPlan();
    },
    ...(options.onEveningReview ? { onEveningReview: options.onEveningReview } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
    ...(options.now ? { now: options.now } : {})
  };
  return new Scheduler(schedulerOptions);
}
