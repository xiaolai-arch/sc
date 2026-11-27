// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { formatLocalDate } from '../../src/shared/date';
import { ReviewPage } from '../../src/renderer/shell/ReviewPage';
import type { ReviewRecord } from '../../src/shared/ipc';

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatLocalDate(date);
}

function review(date: string): ReviewRecord {
  return {
    date,
    submittedAt: `${date}T21:00:00`,
    completed: '完成',
    stuck: '',
    tomorrow: ''
  };
}

function setup(reviews: ReviewRecord[]) {
  render(
    <ReviewPage
      workspaces={[]}
      reviews={reviews}
      onOpenSidebar={vi.fn()}
      onPrompt={vi.fn()}
    />
  );
}

test('shows the current review streak', () => {
  setup([review(daysAgo(0)), review(daysAgo(1)), review(daysAgo(2))]);

  expect(screen.getByText('连续复盘 3 天')).toBeInTheDocument();
  expect(screen.queryByText('今天还没复盘')).not.toBeInTheDocument();
});

test('flags an unstarted day while keeping yesterday’s streak', () => {
  setup([review(daysAgo(1)), review(daysAgo(2))]);

  expect(screen.getByText('连续复盘 2 天')).toBeInTheDocument();
  expect(screen.getByText('今天还没复盘')).toBeInTheDocument();
});

// --- the longest-streak line and the recovery sentence (P0 断签恢复) -----------

test('shows the longest streak beside the current one whenever history exists', () => {
  // Current run: yesterday only (1 day); all-time best: days -5..-3 (3 days).
  setup([review(daysAgo(1)), review(daysAgo(3)), review(daysAgo(4)), review(daysAgo(5))]);

  expect(screen.getByText('连续复盘 1 天')).toBeInTheDocument();
  expect(screen.getByText('最长连续复盘 3 天')).toBeInTheDocument();
  // Alive state: no recovery sentence.
  expect(
    screen.queryByText('中断了一次，但「最长连续复盘 3 天」还在——今天记一笔，就重新开始。')
  ).not.toBeInTheDocument();
});

test('keeps the longest-streak line out when there are no records', () => {
  setup([]);

  expect(screen.queryByText(/连续复盘/)).not.toBeInTheDocument();
  expect(screen.queryByText(/最长连续复盘/)).not.toBeInTheDocument();
});

test('a lapsed day shows one neutral recovery sentence naming the longest streak', () => {
  const { container } = setupWith([review(daysAgo(3)), review(daysAgo(2))]);

  expect(screen.getByText('连续复盘 0 天')).toBeInTheDocument();
  expect(screen.getByText('最长连续复盘 2 天')).toBeInTheDocument();
  expect(screen.getByText('今天还没复盘')).toBeInTheDocument();
  const sentence = screen.getByText(
    '中断了一次，但「最长连续复盘 2 天」还在——今天记一笔，就重新开始。'
  );
  expect(sentence).toBeInTheDocument();
  // No shame vocabulary: the banned phrasing (清零 / 失败 / a 断签-style
  // statement) never appears. 「中断了一次」 is the spec's own approved
  // sentence and is asserted byte-exact above.
  const text = container.textContent ?? '';
  expect(text).not.toContain('清零');
  expect(text).not.toContain('失败');
  expect(text).not.toContain('断签');
  // A fact line: no red or alarm color on the sentence.
  expect(sentence.className).toBe('w-full');
});

test('an alive day keeps the baseline row classes and no recovery sentence', () => {
  // Today unreviewed but yesterday reviewed: the surviving streak renders
  // exactly as before, with no recovery copy.
  const alive = setupWith([review(daysAgo(1)), review(daysAgo(2))]);

  expect(alive.container.textContent).not.toContain('中断了一次');
  expect(screen.getByText('连续复盘 2 天').className).toBe(
    'font-medium text-[#1d1d1f] dark:text-[#f5f5f7]'
  );
  expect(screen.getByText('今天还没复盘').className).toBe(
    'ml-auto font-medium text-[#0071e3] dark:text-[#4da3ff]'
  );
  alive.unmount();

  // Today reviewed: same, and the unstarted-day flag stays hidden.
  const reviewed = setupWith([review(daysAgo(0)), review(daysAgo(1))]);
  expect(reviewed.container.textContent).not.toContain('中断了一次');
  expect(screen.queryByText('今天还没复盘')).not.toBeInTheDocument();
  expect(screen.getByText('最长连续复盘 2 天')).toBeInTheDocument();
});

function setupWith(reviews: ReviewRecord[]) {
  return render(
    <ReviewPage
      workspaces={[]}
      reviews={reviews}
      onOpenSidebar={vi.fn()}
      onPrompt={vi.fn()}
    />
  );
}
