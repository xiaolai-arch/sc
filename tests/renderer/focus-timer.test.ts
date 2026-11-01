import {
  FOCUS_DURATION_MS,
  firstFocusableTask,
  focusCompletionStatus,
  focusProgress,
  formatFocusTime,
  nextActualMin,
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
  const session = startFocusSession(7, { id: 't1', title: '极限' });

  expect(session).toEqual({
    sessionId: 7,
    taskId: 't1',
    taskTitle: '极限',
    remainingMs: FOCUS_DURATION_MS,
    running: true,
    recorded: false
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
  const session = startFocusSession(1, { id: 't1', title: '极限' });
  const almost = { ...session, remainingMs: 1_000 };

  const finished = tickFocus(almost);
  expect(finished.remainingMs).toBe(0);
  expect(finished.running).toBe(false);

  const again = tickFocus(finished);
  expect(again.remainingMs).toBe(0);
  expect(again.running).toBe(false);
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
