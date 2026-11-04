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
