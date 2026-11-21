import type { WorkspaceTask } from '../../shared/workspace';

/**
 * True when the task is part of that calendar day's plan: its due date, or the
 * day it is pinned to on the schedule. Undated backlog is deliberately not
 * today's plan, so a standing backlog cannot make the nudge fire every day.
 */
export function isTaskForDate(task: WorkspaceTask, date: string): boolean {
  return task.due === date || task.startAt?.slice(0, 10) === date;
}

export interface BehindScheduleSummary {
  /** Tasks still open today. */
  remaining: number;
  /** The first open task, named in the nudge. */
  first: WorkspaceTask;
}

/**
 * 落后提醒 fires only when the day exists and fewer than half of its tasks are
 * done: a plan with every task finished (or no plan at all) stays silent.
 */
export function behindScheduleSummary(
  tasks: readonly WorkspaceTask[]
): BehindScheduleSummary | null {
  if (tasks.length === 0) return null;
  const done = tasks.filter((task) => task.status === 'done').length;
  if (done * 2 >= tasks.length) return null;
  const first = tasks.find(
    (task) => task.status === 'pending' || task.status === 'in-progress'
  );
  if (first === undefined) return null;
  const remaining = tasks.filter(
    (task) => task.status === 'pending' || task.status === 'in-progress'
  ).length;
  return { remaining, first };
}

export const BEHIND_SCHEDULE_TITLE = '今天有点落后，要调整一下吗？';

/**
 * One deterministic nudge: how many tasks are left, the first one, and an
 * offer to re-plan. Versioned here so the scheduler fallback and the check-in
 * service produce byte-identical text.
 */
export function buildBehindScheduleNotification(
  tasks: readonly WorkspaceTask[]
): { title: string; body: string } | null {
  const summary = behindScheduleSummary(tasks);
  if (summary === null) return null;
  const { remaining, first } = summary;
  return {
    title: BEHIND_SCHEDULE_TITLE,
    body: `今天还有 ${remaining} 个任务没完成，下一项是「${first.title}」。要不要一起调整一下今天的安排？`
  };
}
