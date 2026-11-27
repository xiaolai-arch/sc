import {
  FOCUS_DURATION_MS,
  FOCUS_RECORDED_MINUTES,
  FOCUS_TICK_MS,
  WHOLE_PAPER_MAX_MINUTES,
  WHOLE_PAPER_MIN_MINUTES,
  clampWholePaperMinutes,
  decideFocusRestore,
  defaultWholePaperMinutes,
  firstFocusableTask,
  focusCompletionStatus,
  focusProgress,
  focusRestoreLabel,
  formatFocusTime,
  formatWholePaperSpan,
  nextActualMin,
  pauseFocusSession,
  resumeFocusSession,
  startFocusSession,
  tickFocus,
  wholePaperElapsedMs,
  wholePaperRemainingMs
} from '../../src/renderer/shell/focus-timer';
import type { FocusSnapshotRecord } from '../../src/shared/ipc';
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

// ---------------------------------------------------------------------------
// 中断现场包（iter33 P2b①）：the restart bridge. 验收 18/19 — every rule is
// deterministic and restore is always paused.
// ---------------------------------------------------------------------------

const TODAY = '2026-11-27';

function snapshot(overrides: Partial<FocusSnapshotRecord> = {}): FocusSnapshotRecord {
  return {
    workspaceId: 'ws-1',
    session: {
      sessionId: 3,
      taskId: 't1',
      taskTitle: '极限',
      remainingMs: 10 * 60_000,
      running: true,
      recorded: false,
      lastTickAt: 1_000
    },
    savedAtLocalDate: TODAY,
    ...overrides
  };
}

describe('decideFocusRestore', () => {
  test('same workspace, same day, time left → restore, word for word (验收 18)', () => {
    const decision = decideFocusRestore(snapshot(), 'ws-1', TODAY);
    expect(decision.action).toBe('restore');
    if (decision.action !== 'restore') return;
    expect(decision.minutesLeft).toBe(10);
    expect(decision.label).toBe('上次专注还剩 10 分钟，继续？');
    expect(focusRestoreLabel(10)).toBe('上次专注还剩 10 分钟，继续？');
    // The session comes back bound to its task with its snapshot values.
    expect(decision.session.taskId).toBe('t1');
    expect(decision.session.remainingMs).toBe(10 * 60_000);
  });

  test('restore is always paused, even for a running snapshot (验收 19)', () => {
    const decision = decideFocusRestore(snapshot({ session: { ...snapshot().session, running: true } }), 'ws-1', TODAY);
    if (decision.action !== 'restore') throw new Error('expected restore');
    expect(decision.session.running).toBe(false);
    // And the existing resume path is what starts the clock again.
    const resumed = resumeFocusSession(decision.session, 5_000);
    expect(resumed.running).toBe(true);
    expect(resumed.lastTickAt).toBe(5_000);
  });

  test('rounds the minutes up so the prompt never understates', () => {
    const decision = decideFocusRestore(
      snapshot({ session: { ...snapshot().session, remainingMs: 4 * 60_000 + 59_000 } }),
      'ws-1',
      TODAY
    );
    if (decision.action !== 'restore') throw new Error('expected restore');
    expect(decision.minutesLeft).toBe(5);
  });

  test('a cross-day snapshot is discarded (验收 19 negative)', () => {
    expect(decideFocusRestore(snapshot(), 'ws-1', '2026-11-28').action).toBe('discard');
  });

  test('a different workspace is discarded (验收 19 negative)', () => {
    expect(decideFocusRestore(snapshot(), 'ws-2', TODAY).action).toBe('discard');
  });

  test('a finished session (no time left) is discarded', () => {
    const decision = decideFocusRestore(
      snapshot({ session: { ...snapshot().session, remainingMs: 0 } }),
      'ws-1',
      TODAY
    );
    expect(decision.action).toBe('discard');
  });

  test('absent or unreadable snapshots are discarded (坏 JSON 负例)', () => {
    expect(decideFocusRestore(null, 'ws-1', TODAY).action).toBe('discard');
    expect(decideFocusRestore(undefined, 'ws-1', TODAY).action).toBe('discard');
    expect(
      decideFocusRestore(
        snapshot({ session: { ...snapshot().session, remainingMs: Number.NaN } }),
        'ws-1',
        TODAY
      ).action
    ).toBe('discard');
    expect(
      decideFocusRestore(
        snapshot({ session: { ...snapshot().session, taskId: '' } }),
        'ws-1',
        TODAY
      ).action
    ).toBe('discard');
    expect(
      decideFocusRestore(snapshot({ savedAtLocalDate: '上周' }), 'ws-1', TODAY).action
    ).toBe('discard');
  });
});

// ---------------------------------------------------------------------------
// 整卷模拟 clock（P2a）。验收 20 的锚：专注计时器的常量与结算函数一个不动，
// 上面的既有断言逐条保持通过；整卷计时是旁边新增的墙钟纯函数。
// ---------------------------------------------------------------------------

describe('whole-paper exam clock', () => {
  test('keeps the 25-minute focus timer constants untouched', () => {
    expect(FOCUS_DURATION_MS).toBe(25 * 60 * 1000);
    expect(FOCUS_TICK_MS).toBe(1000);
    expect(FOCUS_RECORDED_MINUTES).toBe(25);
    expect(typeof tickFocus).toBe('function');
  });

  test('defaults to clamp(题数×2, 5, 600) at the 1 / 3 / 400 boundaries', () => {
    expect(defaultWholePaperMinutes(1)).toBe(5);
    expect(defaultWholePaperMinutes(3)).toBe(6);
    expect(defaultWholePaperMinutes(400)).toBe(600);
    expect(defaultWholePaperMinutes(0)).toBe(WHOLE_PAPER_MIN_MINUTES);
  });

  test('clamps out-of-range or non-integer minutes back into 5–600', () => {
    expect(WHOLE_PAPER_MIN_MINUTES).toBe(5);
    expect(WHOLE_PAPER_MAX_MINUTES).toBe(600);
    expect(clampWholePaperMinutes(5)).toBe(5);
    expect(clampWholePaperMinutes(0)).toBe(5);
    expect(clampWholePaperMinutes(-3)).toBe(5);
    expect(clampWholePaperMinutes(600)).toBe(600);
    expect(clampWholePaperMinutes(1000)).toBe(600);
    expect(clampWholePaperMinutes(7.4)).toBe(7);
    expect(clampWholePaperMinutes(NaN)).toBe(5);
    expect(clampWholePaperMinutes(Number.POSITIVE_INFINITY)).toBe(5);
  });

  test('settles remaining time against the wall clock, not per tick', () => {
    const clock = { durationMs: 10 * 60_000, startedAt: 1_000 };
    expect(wholePaperRemainingMs(clock, 1_000)).toBe(10 * 60_000);
    // A 90-second jump (background throttling or sleep) subtracts real time.
    expect(wholePaperRemainingMs(clock, 91_000)).toBe(10 * 60_000 - 90_000);
    expect(wholePaperRemainingMs(clock, 1_000 + 60_000)).toBe(9 * 60_000);
    // Past the deadline the remaining time floors at zero.
    expect(wholePaperRemainingMs(clock, 999_999_999)).toBe(0);
    // A clock that seems to run backwards cannot add time back.
    expect(wholePaperRemainingMs(clock, 0)).toBe(10 * 60_000);
  });

  test('clamps elapsed time to the allotment', () => {
    const clock = { durationMs: 5 * 60_000, startedAt: 0 };
    expect(wholePaperElapsedMs(clock, 0)).toBe(0);
    expect(wholePaperElapsedMs(clock, 30_000)).toBe(30_000);
    expect(wholePaperElapsedMs(clock, 10 * 60_000)).toBe(5 * 60_000);
    expect(wholePaperElapsedMs(clock, -1)).toBe(0);
  });

  test('formats 用时 spans for the 结卷摘要', () => {
    expect(formatWholePaperSpan(0)).toBe('0 秒');
    expect(formatWholePaperSpan(45_000)).toBe('45 秒');
    expect(formatWholePaperSpan(90_000)).toBe('1 分 30 秒');
    expect(formatWholePaperSpan(5 * 60_000)).toBe('5 分');
    expect(formatWholePaperSpan(-1_000)).toBe('0 秒');
  });
});
