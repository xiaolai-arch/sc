// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import type { PracticeAttempt } from '../../src/shared/practice';
import {
  accuracyTrend,
  type AccuracyTrendData
} from '../../src/renderer/shell/accuracy-trend';
import { AccuracyTrend } from '../../src/renderer/shell/AccuracyTrend';

// Saturday 21 November 2026; the current Monday-based week runs 11-16..11-22,
// so the 8-week window spans 2026-09-28 .. 2026-11-22.
const today = new Date(2026, 10, 21);

function attempt(overrides: Partial<PracticeAttempt> = {}): PracticeAttempt {
  return {
    id: 'a1',
    workspaceId: 'kaoyan',
    setId: 'set-1',
    questionId: 'q1',
    choice: 0,
    correct: true,
    answeredAt: '2026-11-21T10:00',
    ...overrides
  };
}

function weekOf(data: AccuracyTrendData, weekStart: string) {
  const week = data.weeks.find((entry) => entry.weekStart === weekStart);
  expect(week, `no week starting ${weekStart}`).toBeDefined();
  return week!;
}

test('buckets attempts onto Monday-based weeks, Sundays included', () => {
  const data = accuracyTrend(
    [
      attempt({ id: 'sat', answeredAt: '2026-11-21T10:00' }),
      attempt({ id: 'mon', answeredAt: '2026-11-16T08:00' }),
      attempt({ id: 'sun', answeredAt: '2026-11-22T23:30' }),
      attempt({ id: 'prev-sun', answeredAt: '2026-11-15T22:00' }),
      attempt({ id: 'prev-mon', answeredAt: '2026-11-09T09:00' }),
      attempt({ id: 'w2-sun', answeredAt: '2026-11-08T20:00' })
    ],
    today
  );

  expect(data.weeks).toHaveLength(8);
  expect(data.weeks[0].weekStart).toBe('2026-09-28');
  expect(data.weeks[7].weekStart).toBe('2026-11-16');
  expect(data.weeks[7].weekEnd).toBe('2026-11-22');
  // Sunday 11-15 closes the week that starts Monday 11-09.
  expect(weekOf(data, '2026-11-16').answered).toBe(3);
  expect(weekOf(data, '2026-11-09').answered).toBe(2);
  expect(weekOf(data, '2026-11-02').answered).toBe(1);
});

test('ignores attempts outside the 8-week window and invalid timestamps', () => {
  const data = accuracyTrend(
    [
      attempt({ id: 'in', answeredAt: '2026-11-20T10:00' }),
      attempt({ id: 'day-before-window', answeredAt: '2026-09-27T10:00' }),
      attempt({ id: 'way-old', answeredAt: '2026-08-01T10:00' }),
      attempt({ id: 'future', answeredAt: '2026-12-05T10:00' }),
      attempt({ id: 'invalid', answeredAt: 'not-a-date' })
    ],
    today
  );

  expect(data.totals.answered).toBe(1);
  expect(weekOf(data, '2026-09-28').answered).toBe(0);
});

test('a week with zero attempts has no accuracy instead of a fake 0%', () => {
  const data = accuracyTrend(
    [attempt({ id: 'in', answeredAt: '2026-11-20T10:00', correct: false })],
    today
  );

  expect(weekOf(data, '2026-11-16').accuracy).toBe(0);
  expect(weekOf(data, '2026-11-09').accuracy).toBeNull();
  expect(weekOf(data, '2026-10-26').accuracy).toBeNull();
  expect(weekOf(data, '2026-10-26').label).toBe('10月26日–11月1日 · 做 0 题 · 无答题');
});

test('sums answered and correct counts per week and across the window', () => {
  const data = accuracyTrend(
    [
      attempt({ id: 'a', answeredAt: '2026-11-20T10:00', correct: true }),
      attempt({ id: 'b', answeredAt: '2026-11-20T11:00', correct: false }),
      attempt({ id: 'c', answeredAt: '2026-11-13T10:00', correct: true }),
      attempt({ id: 'd', answeredAt: '2026-11-14T10:00', correct: true })
    ],
    today
  );

  expect(weekOf(data, '2026-11-16')).toMatchObject({ answered: 2, correct: 1 });
  expect(weekOf(data, '2026-11-09')).toMatchObject({ answered: 2, correct: 2, accuracy: 1 });
  expect(data.totals).toMatchObject({ answered: 4, correct: 3 });
  expect(data.totals.accuracy).toBeCloseTo(0.75);
});

test('the delta skips empty weeks and compares the previous scored week', () => {
  const data = accuracyTrend(
    [
      attempt({ id: 'cur', answeredAt: '2026-11-19T10:00', correct: false }),
      attempt({ id: 'two-back', answeredAt: '2026-11-05T10:00', correct: true })
    ],
    today
  );

  expect(data.totals.comparedWeekStart).toBe('2026-11-02');
  expect(data.totals.direction).toBe('下降');
  expect(data.totals.deltaPoints).toBe(-100);
  expect(data.summary).toBe('最近 8 周做 2 题 · 正确率 50%（比 11/2 那周 -100 个百分点）');
});

test('equal accuracy against last week reads as 持平', () => {
  const data = accuracyTrend(
    [
      attempt({ id: 'cur-1', answeredAt: '2026-11-19T10:00', correct: true }),
      attempt({ id: 'cur-2', answeredAt: '2026-11-19T11:00', correct: false }),
      attempt({ id: 'prev-1', answeredAt: '2026-11-12T10:00', correct: true }),
      attempt({ id: 'prev-2', answeredAt: '2026-11-12T11:00', correct: false })
    ],
    today
  );

  expect(data.totals.direction).toBe('持平');
  expect(data.totals.deltaPoints).toBe(0);
  expect(data.summary).toBe('最近 8 周做 4 题 · 正确率 50%（与上周持平）');
});

test('an empty current week has no direction even when earlier weeks do', () => {
  const data = accuracyTrend(
    [attempt({ id: 'old', answeredAt: '2026-11-05T10:00', correct: true })],
    today
  );

  expect(data.totals.direction).toBeNull();
  expect(data.totals.deltaPoints).toBeNull();
  expect(data.summary).toBe('最近 8 周做 1 题 · 正确率 100%');
});

test('builds the exact summary line from a small fixture', () => {
  const data = accuracyTrend(
    [
      attempt({ id: 'a', answeredAt: '2026-11-19T10:00', correct: true }),
      attempt({ id: 'b', answeredAt: '2026-11-19T11:00', correct: true }),
      attempt({ id: 'c', answeredAt: '2026-11-19T12:00', correct: false }),
      attempt({ id: 'd', answeredAt: '2026-11-19T13:00', correct: true }),
      attempt({ id: 'e', answeredAt: '2026-11-12T10:00', correct: true }),
      attempt({ id: 'f', answeredAt: '2026-11-13T10:00', correct: false })
    ],
    today
  );

  // This week 3/4 = 75%, last week 1/2 = 50%, window total 4/6 = 67%.
  expect(data.totals.direction).toBe('上升');
  expect(data.totals.deltaPoints).toBe(25);
  expect(data.summary).toBe('最近 8 周做 6 题 · 正确率 67%（比上周 +25 个百分点）');
});

test('an empty window has no data and a plain summary', () => {
  const data = accuracyTrend([], today);

  expect(data.hasData).toBe(false);
  expect(data.totals.accuracy).toBeNull();
  expect(data.summary).toBe('最近 8 周做 0 题');
});

test('renders 8 bars, captions, tooltips and the summary line', () => {
  render(
    <AccuracyTrend
      today={today}
      attempts={[
        attempt({ id: 'a', answeredAt: '2026-11-19T10:00', correct: true }),
        attempt({ id: 'b', answeredAt: '2026-11-19T11:00', correct: false }),
        attempt({ id: 'c', answeredAt: '2026-11-19T12:00', correct: true }),
        attempt({ id: 'd', answeredAt: '2026-11-12T10:00', correct: true }),
        attempt({ id: 'e', answeredAt: '2026-11-12T11:00', correct: true }),
        attempt({ id: 'f', answeredAt: '2026-11-12T12:00', correct: false })
      ]}
    />
  );

  expect(screen.getByRole('heading', { name: '正确率趋势' })).toBeInTheDocument();
  // One labelled bar per week, including the empty ones.
  expect(screen.getAllByRole('img')).toHaveLength(8);
  expect(screen.getByText('最近 8 周做 6 题 · 正确率 67%（与上周持平）')).toBeInTheDocument();
  expect(screen.getByText('11/16')).toBeInTheDocument();
  expect(screen.getByText('10/26')).toBeInTheDocument();

  const currentBar = screen.getByLabelText('11月16日–11月22日 · 做 3 题 · 正确率 67%');
  expect(currentBar).toHaveAttribute('title', '11月16日–11月22日 · 做 3 题 · 正确率 67%');
  expect(screen.getByLabelText('11月9日–11月15日 · 做 3 题 · 正确率 67%')).toBeInTheDocument();
  expect(screen.getByLabelText('10月26日–11月1日 · 做 0 题 · 无答题')).toBeInTheDocument();
});

test('shows an honest empty state without any bars', () => {
  render(<AccuracyTrend attempts={[]} today={today} />);

  expect(screen.getByRole('heading', { name: '正确率趋势' })).toBeInTheDocument();
  expect(screen.getByText(/还没有练习记录/)).toBeInTheDocument();
  expect(screen.queryAllByRole('img')).toHaveLength(0);
  expect(screen.queryByText(/最近 8 周做/)).not.toBeInTheDocument();
});
