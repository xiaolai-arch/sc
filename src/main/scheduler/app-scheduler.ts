import type { AppContext } from '../context';
import { createDeliveryLog, type DeliveryLog } from './delivery-log';
import { isTaskForDate } from './behind-schedule';
import { Scheduler, type SchedulerNotification, type SchedulerOptions } from './scheduler';

export interface ContextSchedulerOptions {
  context: Pick<AppContext, 'api' | 'settings' | 'workspace' | 'checkIns'>;
  notify: (notification: SchedulerNotification) => void | Promise<void>;
  /** Optional evening hook (e.g. open the review dialog or prime memory). */
  onEveningReview?: (date: string) => void | Promise<void>;
  onError?: (error: unknown) => void;
  now?: () => Date;
  /** JSON file that remembers today's delivered reminders across restarts. */
  deliveryLogPath?: string;
  /** Test seam; overrides `deliveryLogPath`. */
  deliveryLog?: DeliveryLog;
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
    // Persist fired/failed/pending so the reminders page shows what happened
    // and a postponed reminder survives a restart.
    onReminderState: (id, patch) => {
      const workspace = options.context.workspace;
      if (!workspace.setReminderState) return Promise.resolve();
      return workspace.setReminderState(id, patch).then(() => undefined);
    },
    // Read only task files; snapshots would also load notes and memory on
    // every 30-second tick. The snapshot path is a fallback for implementations
    // that do not expose the lightweight query.
    getScheduledTasks: async () => {
      if (options.context.workspace.getScheduledTasks) {
        return options.context.workspace.getScheduledTasks();
      }
      const workspaces = await options.context.api.listWorkspaces();
      const snapshots = await Promise.all(
        workspaces.map((workspace) => options.context.api.getWorkspaceSnapshot(workspace.id))
      );
      return snapshots
        .flatMap((snapshot) => snapshot.tasks)
        .filter(
          (task) =>
            task.startAt !== undefined &&
            (task.status === 'pending' || task.status === 'in-progress')
        );
    },
    // Only the 落后提醒 fallback needs every task of the day (done included).
    getTodayTasks: async (date) => {
      const workspaces = await options.context.api.listWorkspaces();
      const snapshots = await Promise.all(
        workspaces.map((workspace) => options.context.api.getWorkspaceSnapshot(workspace.id))
      );
      return snapshots.flatMap((snapshot) =>
        snapshot.tasks.filter((task) => isTaskForDate(task, date))
      );
    },
    notify: options.notify,
    ...(options.deliveryLog !== undefined || options.deliveryLogPath !== undefined
      ? {
          deliveryLog:
            options.deliveryLog ?? createDeliveryLog(options.deliveryLogPath as string)
        }
      : {}),
    onCheckIn: (kind, date) => options.context.checkIns.check(kind, date),
    ...(options.onEveningReview ? { onEveningReview: options.onEveningReview } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
    ...(options.now ? { now: options.now } : {})
  };
  return new Scheduler(schedulerOptions);
}
