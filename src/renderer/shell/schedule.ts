import type { Workspace, WorkspaceTask } from '../../shared/workspace';

export type ScheduleEntry = {
  id: string;
  time: string;
  title: string;
  detail: string;
  tag: string;
  workspaceId: string;
  status: WorkspaceTask['status'];
};

export type DailySchedule = {
  entries: ScheduleEntry[];
  unscheduled: number;
};

const START_MINUTES = 8 * 60;
const LAST_START_MINUTES = 22 * 60;
const BREAK_MINUTES = 10;
const MIN_BLOCK_MINUTES = 15;

function formatTime(minutes: number): string {
  const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
  const minute = String(minutes % 60).padStart(2, '0');
  return `${hour}:${minute}`;
}

function rank(task: WorkspaceTask): number {
  if (task.status === 'in-progress') return 0;
  if (task.due) return 1;
  return 2;
}

/**
 * Turns today's open tasks into a deterministic time-blocked plan. Tasks keep
 * their workspace order; in-progress work comes first, then scheduled work,
 * then the remaining backlog. Durations are estimates, so blocks are spaced
 * with a short break and capped before 22:00.
 */
export function buildDailySchedule(
  tasks: WorkspaceTask[],
  workspaces: Workspace[],
  limit = 8
): DailySchedule {
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const candidates = tasks
    .map((task, index) => ({ task, index }))
    .filter(
      ({ task }) => task.status === 'pending' || task.status === 'in-progress'
    )
    .sort((a, b) => rank(a.task) - rank(b.task) || a.index - b.index)
    .map(({ task }) => task);

  const entries: ScheduleEntry[] = [];
  let cursor = START_MINUTES;
  let unscheduled = 0;

  for (const task of candidates) {
    if (entries.length >= limit || cursor > LAST_START_MINUTES) {
      unscheduled += 1;
      continue;
    }
    const workspace = workspaceById.get(task.workspaceId);
    const duration = Math.max(task.durationMin, MIN_BLOCK_MINUTES);
    entries.push({
      id: task.id,
      time: formatTime(cursor),
      title: task.title,
      detail: `${duration} 分钟 · ${task.subject}`,
      tag: workspace?.name ?? '工作区',
      workspaceId: task.workspaceId,
      status: task.status
    });
    cursor += duration + BREAK_MINUTES;
  }

  return { entries, unscheduled };
}
