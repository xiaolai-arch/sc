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
 * Plans into the first workspace that has no tasks yet and persists the
 * generated tasks through the workspace service. Shared by the morning
 * scheduler and the tray action so both converge on the single workspace
 * planner instead of a separate global daily plan. Returns false when every
 * workspace already has tasks.
 */
export async function planFirstEmptyWorkspace(
  context: Pick<AppContext, 'api'>
): Promise<boolean> {
  for (const workspace of await context.api.listWorkspaces()) {
    const snapshot = await context.api.getWorkspaceSnapshot(workspace.id);
    if (snapshot.tasks.length > 0) continue;
    const plan = await context.api.planWorkspace({ workspaceId: workspace.id });
    for (const task of plan.tasks) {
      await context.api.createTask({
        workspaceId: workspace.id,
        title: task.title,
        subject: task.subject,
        durationMin: task.durationMin,
        acceptance: task.acceptance
      });
    }
    return true;
  }
  return false;
}

/**
 * Production-shaped scheduler wiring: settings and reminders always come from
 * the live context, so a vault switch is picked up on the next tick. The
 * morning trigger only plans an empty workspace, avoiding a duplicate model
 * call/overwrite after a restart.
 */
export function createContextScheduler(options: ContextSchedulerOptions): Scheduler {
  const schedulerOptions: SchedulerOptions = {
    getSettings: () => options.context.settings.get(),
    getReminders: () => options.context.workspace.getReminders(),
    notify: options.notify,
    onMorningPlan: async () => {
      await planFirstEmptyWorkspace(options.context);
    },
    ...(options.onEveningReview ? { onEveningReview: options.onEveningReview } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
    ...(options.now ? { now: options.now } : {})
  };
  return new Scheduler(schedulerOptions);
}
