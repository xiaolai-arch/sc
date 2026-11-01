import {
  FOCUS_DURATION_MS,
  firstFocusableTask,
  focusCompletionStatus,
  focusProgress,
  formatFocusTime,
  nextActualMin,
  pauseFocusSession,
  resumeFocusSession,
  startFocusSession,
  tickFocus
} from '../../src/renderer/shell/focus-timer';
import type { WorkspaceTask } from '../../src/shared/workspace';

function task(
  id: string,
  status: WorkspaceTask['status'],
  title = id
): WorkspaceTask {
  return {
    id,
    workspaceId: 'ws-1',
    title,
    subject: '数学',
    durationMin: 30,
    acceptance: '完成',
    status
  };
}

test('starts a 25 minute session for a task', () => {
  const session = startFocusSession(7, { id: 't1', title: '极限' }, 1_000);

  expect(session).toEqual({
    sessionId: 7,
    taskId: 't1',
    taskTitle: '极限',
    remainingMs: FOCUS_DURATION_MS,
    running: true,
    recorded: false,
    lastTickAt: 1_000
  });
});

test('formats remaining time and clamps progress', () => {
  expect(formatFocusTime(FOCUS_DURATION_MS)).toBe('25:00');
  expect(formatFocusTime(65_000)).toBe('01:05');
  expect(formatFocusTime(0)).toBe('00:00');
  expect(formatFocusTime(-5_000)).toBe('00:00');

  expect(focusProgress(FOCUS_DURATION_MS)).toBe(0);
  expect(focusProgress(FOCUS_DURATION_MS / 2)).toBe(0.5);
  expect(focusProgress(0)).toBe(1);
  expect(focusProgress(FOCUS_DURATION_MS + 1)).toBe(0);
  expect(focusProgress(-1_000)).toBe(1);
});

test('ticking stops at zero exactly once', () => {
  const session = startFocusSession(1, { id: 't1', title: '极限' }, 0);
  const almost = { ...session, remainingMs: 1_000, lastTickAt: 0 };

  const finished = tickFocus(almost, 1_000);
  expect(finished.remainingMs).toBe(0);
  expect(finished.running).toBe(false);
  expect(finished.lastTickAt).toBe(1_000);

  const again = tickFocus(finished, 2_000);
  expect(again.remainingMs).toBe(0);
  expect(again.running).toBe(false);
});

test('uses real elapsed time across a 90 second jump', () => {
  const session = startFocusSession(1, { id: 't1', title: '极限' }, 1_000);

  const next = tickFocus(session, 91_000);

  expect(next.remainingMs).toBe(FOCUS_DURATION_MS - 90_000);
  expect(next.running).toBe(true);
  expect(next.lastTickAt).toBe(91_000);
});

test('clamps to zero when a jump exceeds the remaining time', () => {
  const session = {
    ...startFocusSession(1, { id: 't1', title: '极限' }, 0),
    remainingMs: 30_000,
    lastTickAt: 0
  };

  const next = tickFocus(session, 120_000);

  expect(next.remainingMs).toBe(0);
  expect(next.running).toBe(false);
  expect(next.lastTickAt).toBe(120_000);
});

test('does not decrement while paused', () => {
  const paused = {
    ...startFocusSession(1, { id: 't1', title: '极限' }, 0),
    remainingMs: 10_000,
    running: false,
    lastTickAt: 0
  };

  expect(tickFocus(paused, 60_000)).toBe(paused);
});

test('pausing settles elapsed time and resuming restarts the clock', () => {
  const session = startFocusSession(1, { id: 't1', title: '极限' }, 0);

  const paused = pauseFocusSession(session, 30_000);
  expect(paused.remainingMs).toBe(FOCUS_DURATION_MS - 30_000);
  expect(paused.running).toBe(false);
  expect(paused.lastTickAt).toBe(30_000);

  const resumed = resumeFocusSession(paused, 90_000);
  expect(resumed.running).toBe(true);
  expect(resumed.remainingMs).toBe(FOCUS_DURATION_MS - 30_000);
  expect(resumed.lastTickAt).toBe(90_000);

  expect(tickFocus(resumed, 95_000).remainingMs).toBe(FOCUS_DURATION_MS - 35_000);
});

test('adds 25 minutes to the recorded focus time', () => {
  expect(nextActualMin(undefined)).toBe(25);
  expect(nextActualMin(0)).toBe(25);
  expect(nextActualMin(30)).toBe(55);
});

test('keeps done tasks done when focus completes', () => {
  expect(focusCompletionStatus('done')).toBe('done');
  expect(focusCompletionStatus('in-progress')).toBe('in-progress');
  expect(focusCompletionStatus('pending')).toBe('in-progress');
  expect(focusCompletionStatus('skipped')).toBe('in-progress');
});

test('picks the first unfinished task for a default focus', () => {
  const tasks = [
    task('done', 'done'),
    task('skipped', 'skipped'),
    task('first', 'pending'),
    task('second', 'in-progress')
  ];

  expect(firstFocusableTask(tasks)?.id).toBe('first');
  expect(firstFocusableTask([task('done', 'done')])).toBeUndefined();
});
