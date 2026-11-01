import { formatLocalDate } from '../../shared/date';
import type { Workspace, WorkspaceTask } from '../../shared/workspace';

export type ScheduleEntry = {
  id: string;
  time: string;
  title: string;
  detail: string;
  tag: string;
  workspaceId: string;
  status: WorkspaceTask['status'];
  durationMin: number;
  /** True when the user pinned this block to a start time. */
  pinned: boolean;
  startAt?: string;
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

function startMinutes(startAt: string | undefined): number | null {
  const match = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(startAt ?? '');
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function dateOf(startAt: string | undefined): string | null {
  return /^(\d{4}-\d{2}-\d{2})T/.exec(startAt ?? '')?.[1] ?? null;
}

function rank(task: WorkspaceTask): number {
  if (task.status === 'in-progress') return 0;
  if (task.due) return 1;
  return 2;
}

function entryFor(
  task: WorkspaceTask,
  workspace: Workspace | undefined,
  minutes: number,
  pinned: boolean
): ScheduleEntry {
  const duration = Math.max(task.durationMin, MIN_BLOCK_MINUTES);
  return {
    id: task.id,
    time: formatTime(minutes),
    title: task.title,
    detail: `${duration} 分钟 · ${task.subject}`,
    tag: workspace?.name ?? '工作区',
    workspaceId: task.workspaceId,
    status: task.status,
    durationMin: duration,
    pinned,
    ...(pinned && task.startAt ? { startAt: task.startAt } : {})
  };
}

/**
 * Turns today's tasks into a deterministic time-blocked plan.
 *
 * Tasks with a local `startAt` on `now`'s date stay pinned at that time, even
 * when done, so the day keeps a visible record. Open tasks without a start
 * time are placed around the pinned blocks in workspace order; in-progress
 * work comes first, then scheduled work, then the backlog. Tasks pinned to
 * another day are left for that day instead of being auto-scheduled here.
 */
export function buildDailySchedule(
  tasks: WorkspaceTask[],
  workspaces: Workspace[],
  limit = 8,
  now = new Date()
): DailySchedule {
  const today = formatLocalDate(now);
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));

  const pinnedTasks = tasks
    .filter((task) => {
      if (task.status === 'skipped') return false;
      return dateOf(task.startAt) === today && startMinutes(task.startAt) !== null;
    })
    .sort(
      (a, b) =>
        (startMinutes(a.startAt) ?? 0) - (startMinutes(b.startAt) ?? 0) ||
        a.title.localeCompare(b.title)
    );

  const pinnedEntries: ScheduleEntry[] = pinnedTasks.map((task) =>
    entryFor(task, workspaceById.get(task.workspaceId), startMinutes(task.startAt)!, true)
  );

  const occupied = pinnedEntries
    .map((entry) => ({
      start: (startMinutes(entry.startAt) ?? 0),
      end: (startMinutes(entry.startAt) ?? 0) + Math.max(entry.durationMin, MIN_BLOCK_MINUTES)
    }))
    .sort((a, b) => a.start - b.start);

  const autoTasks = tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => {
      if (task.status !== 'pending' && task.status !== 'in-progress') return false;
      if (!task.startAt) return true;
      const pinnedDate = dateOf(task.startAt);
      // Overdue pins roll into today's queue; future pins stay on their day.
      return pinnedDate === null || pinnedDate < today;
    })
    .sort((a, b) => rank(a.task) - rank(b.task) || a.index - b.index)
    .map(({ task }) => task);

  const autoEntries: ScheduleEntry[] = [];
  let cursor = START_MINUTES;
  let unscheduled = 0;

  for (const task of autoTasks) {
    const duration = Math.max(task.durationMin, MIN_BLOCK_MINUTES);
    let start = cursor;
    for (;;) {
      const conflict = occupied.find((block) => start < block.end && start + duration > block.start);
      if (conflict === undefined) break;
      start = conflict.end + BREAK_MINUTES;
    }
    if (autoEntries.length >= limit || start > LAST_START_MINUTES) {
      unscheduled += 1;
      continue;
    }
    autoEntries.push(entryFor(task, workspaceById.get(task.workspaceId), start, false));
    cursor = start + duration + BREAK_MINUTES;
  }

  const entries = [...pinnedEntries, ...autoEntries].sort((a, b) => {
    const aStart = startMinutes(a.startAt) ?? timeMinutes(a.time);
    const bStart = startMinutes(b.startAt) ?? timeMinutes(b.time);
    return aStart - bStart;
  });

  return { entries, unscheduled };
}

function timeMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}
