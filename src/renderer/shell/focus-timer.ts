import type { WorkspaceTask, WorkspaceTaskStatus } from '../../shared/workspace';

export const FOCUS_DURATION_MS = 25 * 60 * 1000;
export const FOCUS_TICK_MS = 1000;
export const FOCUS_RECORDED_MINUTES = 25;

export type FocusSession = {
  /** Bumped for every start/reset so one round can only record once. */
  sessionId: number;
  taskId: string;
  taskTitle: string;
  remainingMs: number;
  running: boolean;
  recorded: boolean;
  /** Wall-clock timestamp of the last settlement; paused time is excluded. */
  lastTickAt: number;
};

export function startFocusSession(
  sessionId: number,
  task: Pick<WorkspaceTask, 'id' | 'title'>,
  now: number = Date.now()
): FocusSession {
  return {
    sessionId,
    taskId: task.id,
    taskTitle: task.title,
    remainingMs: FOCUS_DURATION_MS,
    running: true,
    recorded: false,
    lastTickAt: now
  };
}

/**
 * Settles against the wall clock. A delayed tick (background throttling or
 * system sleep) subtracts the real elapsed time instead of one second.
 */
export function tickFocus(
  session: FocusSession,
  now: number = Date.now()
): FocusSession {
  if (!session.running) return session;
  const elapsed = Math.max(0, now - session.lastTickAt);
  if (elapsed === 0) return session;
  const remainingMs = Math.max(0, session.remainingMs - elapsed);
  return {
    ...session,
    remainingMs,
    running: remainingMs > 0,
    lastTickAt: now
  };
}

/** Settles elapsed time first, then stops the clock. */
export function pauseFocusSession(
  session: FocusSession,
  now: number = Date.now()
): FocusSession {
  const settled = tickFocus(session, now);
  return settled.running ? { ...settled, running: false } : settled;
}

/** Paused time never counts; the clock restarts at `now`. */
export function resumeFocusSession(
  session: FocusSession,
  now: number = Date.now()
): FocusSession {
  if (session.running || session.remainingMs <= 0) return session;
  return { ...session, running: true, lastTickAt: now };
}

export function formatFocusTime(remainingMs: number): string {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function focusProgress(
  remainingMs: number,
  totalMs: number = FOCUS_DURATION_MS
): number {
  if (totalMs <= 0) return 0;
  const elapsed = totalMs - Math.max(0, remainingMs);
  return Math.min(1, Math.max(0, elapsed / totalMs));
}

export function nextActualMin(actualMin: number | undefined, minutes = FOCUS_RECORDED_MINUTES): number {
  return (typeof actualMin === 'number' && Number.isFinite(actualMin) ? actualMin : 0) + minutes;
}

export function focusCompletionStatus(status: WorkspaceTaskStatus): WorkspaceTaskStatus {
  return status === 'done' ? 'done' : 'in-progress';
}

export function firstFocusableTask(tasks: WorkspaceTask[]): WorkspaceTask | undefined {
  return tasks.find((task) => task.status === 'pending' || task.status === 'in-progress');
}
