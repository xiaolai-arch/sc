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

// ---------------------------------------------------------------------------
// 整卷模拟（whole-paper simulation）clock.
//
// The paper's countdown is pure wall clock: remaining time is always
// `durationMs − (now − startedAt)`, the same settlement idea as tickFocus but
// derived from one start timestamp instead of accumulated ticks — so a
// throttled background tab or a system sleep can never inflate what is left.
// The session itself lives only in component state: leaving the page or
// restarting voids it, while answers already submitted stay recorded.
// ---------------------------------------------------------------------------

export const WHOLE_PAPER_MIN_MINUTES = 5;
export const WHOLE_PAPER_MAX_MINUTES = 600;

export interface WholePaperClock {
  /** Total allotted time in milliseconds. */
  durationMs: number;
  /** Wall-clock timestamp the paper started at. */
  startedAt: number;
}

/** 5–600 whole minutes; non-finite input falls back to the minimum. */
export function clampWholePaperMinutes(minutes: number): number {
  const rounded = Number.isFinite(minutes)
    ? Math.round(minutes)
    : WHOLE_PAPER_MIN_MINUTES;
  return Math.min(WHOLE_PAPER_MAX_MINUTES, Math.max(WHOLE_PAPER_MIN_MINUTES, rounded));
}

/** Exam pacing heuristic: two minutes per question, clamped into range. */
export function defaultWholePaperMinutes(questionCount: number): number {
  const count =
    Number.isFinite(questionCount) && questionCount > 0 ? Math.floor(questionCount) : 0;
  return clampWholePaperMinutes(count * 2);
}

/** Time left before 自动交卷; never negative, correct across clock jumps. */
export function wholePaperRemainingMs(
  clock: WholePaperClock,
  now: number = Date.now()
): number {
  const elapsed = Math.max(0, now - clock.startedAt);
  return Math.max(0, clock.durationMs - elapsed);
}

/** Time spent on the paper, clamped to the allotment so a late settle never overruns. */
export function wholePaperElapsedMs(
  clock: WholePaperClock,
  now: number = Date.now()
): number {
  return Math.min(clock.durationMs, Math.max(0, now - clock.startedAt));
}

/** 用时 in the 结卷摘要: seconds under a minute, then 分 with any leftover 秒. */
export function formatWholePaperSpan(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} 秒`;
  return seconds === 0 ? `${minutes} 分` : `${minutes} 分 ${seconds} 秒`;
}

export function focusCompletionStatus(status: WorkspaceTaskStatus): WorkspaceTaskStatus {
  return status === 'done' ? 'done' : 'in-progress';
}

export function firstFocusableTask(tasks: WorkspaceTask[]): WorkspaceTask | undefined {
  return tasks.find((task) => task.status === 'pending' || task.status === 'in-progress');
}
