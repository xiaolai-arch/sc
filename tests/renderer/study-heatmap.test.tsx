// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { formatLocalDate } from '../../src/shared/date';
import { weeklyOverview } from '../../src/shared/weekly-stats';
import type { WorkspaceTask } from '../../src/shared/workspace';
import { heatmapLevel, studyHeatmap, type StudyHeatmapData } from '../../src/renderer/shell/heatmap';
import { StudyHeatmap } from '../../src/renderer/shell/StudyHeatmap';

// Saturday 21 November 2026; the 84-day window starts Sunday 2026-08-30, so
// the first grid column pads 6 days up to Monday 2026-08-31.
const today = new Date(2026, 10, 21);

function dayKey(offset: number): string {
  const date = new Date(today);
  date.setDate(date.getDate() + offset);
  return formatLocalDate(date);
}

function task(overrides: Partial<WorkspaceTask> = {}): WorkspaceTask {
  return {
    id: 't1',
    workspaceId: 'kaoyan',
    title: '极限',
    subject: '数学',
    durationMin: 45,
    acceptance: '',
    status: 'done',
    ...overrides
  };
}

function cellOf(data: StudyHeatmapData, date: string) {
  const cell = data.columns.flat().find((entry) => entry?.date === date);
  expect(cell, `no cell for ${date}`).toBeDefined();
  return cell!;
}

test('sums completed minutes onto their due dates', () => {
  const data = studyHeatmap(
    [
      task({ id: 'today', due: dayKey(0), actualMin: 45 }),
      task({ id: 'yesterday-a', due: dayKey(-1), actualMin: 40 }),
      task({ id: 'yesterday-b', due: dayKey(-1), actualMin: 30 }),
      task({ id: 'pending', status: 'pending', due: dayKey(-2), actualMin: 60 }),
      task({ id: 'zero', due: dayKey(-3), actualMin: 0 })
    ],
    today
  );

  expect(cellOf(data, dayKey(0)).minutes).toBe(45);
  expect(cellOf(data, dayKey(-1)).minutes).toBe(70);
  expect(cellOf(data, dayKey(-1)).level).toBe(3);
  expect(cellOf(data, dayKey(-1)).label).toBe('11月20日 · 70 分钟');
  expect(cellOf(data, dayKey(-2)).minutes).toBe(0);
  expect(data.totalMinutes).toBe(115);
  expect(data.activeDays).toBe(2);
  expect(data.hasData).toBe(true);
});

test('keeps exactly the last 84 days, Monday-aligned', () => {
  const data = studyHeatmap(
    [
      task({ id: 'first-day', due: dayKey(-83), actualMin: 20 }),
      task({ id: 'too-old', due: dayKey(-84), actualMin: 50 }),
      task({ id: 'way-old', due: dayKey(-200), actualMin: 90 })
    ],
    today
  );

  expect(cellOf(data, dayKey(-83)).minutes).toBe(20);
  const cells = data.columns.flat().filter((entry) => entry !== null);
  expect(cells).toHaveLength(84);
  expect(data.totalMinutes).toBe(20);

  // The window starts on Sunday 2026-08-30, so column 0 pads 6 days and its
  // first real cell sits in the Sunday row.
  expect(data.columns[0]).toEqual([...Array<null>(6).fill(null), expect.anything()]);
  expect(data.columns[0]?.[6]?.date).toBe('2026-08-30');
  expect(data.columns[1]?.[0]?.date).toBe('2026-08-31');
});

test('counts undated completed work on today, matching 本周概览', () => {
  const tasks = [
    task({ id: 'undated', actualMin: 25 }),
    task({ id: 'this-week', due: '2026-11-19', actualMin: 15 }),
    task({ id: 'last-week', due: '2026-11-08', actualMin: 90 })
  ];
  const data = studyHeatmap(tasks, today);

  expect(cellOf(data, '2026-11-21').minutes).toBe(25);

  // Summing this week's heatmap cells reproduces the overview's 专注时长:
  // the heatmap must not invent a second source of truth.
  const overview = weeklyOverview({
    tasks,
    attempts: [],
    reviews: [],
    dueMistakes: [],
    topics: [],
    today
  });
  const weekMinutes = data.columns
    .flat()
    .reduce(
      (sum, cell) =>
        cell && cell.date >= overview.weekStart && cell.date <= overview.weekEnd
          ? sum + cell.minutes
          : sum,
      0
    );
  expect(weekMinutes).toBe(overview.focusMinutes);
});

test('two consecutive active days produce streak 2', () => {
  const data = studyHeatmap(
    [
      task({ id: 'a', due: dayKey(-1), actualMin: 15 }),
      task({ id: 'b', due: dayKey(-2), actualMin: 15 }),
      task({ id: 'c', due: dayKey(-10), actualMin: 45 })
    ],
    today
  );

  expect(data.longestStreak).toBe(2);
});

test('a run that reaches today keeps counting', () => {
  const data = studyHeatmap(
    [
      task({ id: 'a', due: dayKey(0), actualMin: 10 }),
      task({ id: 'b', due: dayKey(-1), actualMin: 10 }),
      task({ id: 'c', due: dayKey(-2), actualMin: 10 })
    ],
    today
  );

  expect(data.longestStreak).toBe(3);
});

test('maps minutes onto levels at the 1 / 15 / 45 thresholds', () => {
  expect(heatmapLevel(0)).toBe(0);
  expect(heatmapLevel(1)).toBe(1);
  expect(heatmapLevel(14)).toBe(1);
  expect(heatmapLevel(15)).toBe(2);
  expect(heatmapLevel(44)).toBe(2);
  expect(heatmapLevel(45)).toBe(3);
});

test('builds the summary line from a small fixture', () => {
  const data = studyHeatmap(
    [
      task({ id: 'a', due: dayKey(0), actualMin: 45 }),
      task({ id: 'b', due: dayKey(-1), actualMin: 40 })
    ],
    today
  );

  expect(data.summary).toBe('最近 12 周共学习 85 分钟 · 最长连续 2 天');
});

test('an empty window has no streak and no data', () => {
  const data = studyHeatmap([], today);

  expect(data).toMatchObject({
    totalMinutes: 0,
    activeDays: 0,
    longestStreak: 0,
    hasData: false
  });
  expect(data.summary).toBe('最近 12 周共学习 0 分钟 · 最长连续 0 天');
});

test('renders the summary line and cell tooltips', () => {
  render(
    <StudyHeatmap
      today={today}
      tasks={[
        task({ id: 'a', due: dayKey(0), actualMin: 45 }),
        task({ id: 'b', due: dayKey(-1), actualMin: 40 })
      ]}
    />
  );

  expect(screen.getByRole('heading', { name: '学习热力图' })).toBeInTheDocument();
  expect(screen.getByText('最近 12 周共学习 85 分钟 · 最长连续 2 天')).toBeInTheDocument();

  const todayCell = screen.getByLabelText('11月21日 · 45 分钟');
  expect(todayCell).toHaveAttribute('title', '11月21日 · 45 分钟');
  expect(screen.getByLabelText('11月20日 · 40 分钟')).toBeInTheDocument();
  // One labelled cell per covered day; padding carries no label.
  expect(screen.getAllByRole('img')).toHaveLength(84);
});

test('shows an honest empty state without any cells', () => {
  render(<StudyHeatmap today={today} tasks={[]} />);

  expect(screen.getByRole('heading', { name: '学习热力图' })).toBeInTheDocument();
  expect(screen.getByText(/还没有学习时长记录/)).toBeInTheDocument();
  expect(screen.queryByText(/最长连续/)).not.toBeInTheDocument();
  expect(screen.queryAllByRole('img')).toHaveLength(0);
});
