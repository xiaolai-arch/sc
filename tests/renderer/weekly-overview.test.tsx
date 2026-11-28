// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { ReviewPage } from '../../src/renderer/shell/ReviewPage';
import { WeeklyOverview } from '../../src/renderer/shell/WeeklyOverview';
import { formatLocalDate } from '../../src/shared/date';
import type { WeeklyOverview as WeeklyOverviewData } from '../../src/shared/weekly-stats';
import { pickOption } from './select-option';

// The week card counts only tasks due in the current week, so fixture tasks
// must carry a due date on the real today rather than a fixed day.
const TODAY = formatLocalDate(new Date());

const overview: WeeklyOverviewData = {
  weekStart: '2026-11-02',
  weekEnd: '2026-11-08',
  tasksDone: 2,
  tasksTotal: 3,
  backlogCount: 0,
  focusMinutes: 75,
  answered: 3,
  correct: 2,
  accuracy: 2 / 3,
  accuracyReliable: false,
  reviewedDays: 2,
  dueMistakes: 2,
  learningTopics: 2,
  masteredTopics: 1,
  weakestTopic: '线代'
};

test('renders the weekly numbers and the weakest topic', () => {
  render(<WeeklyOverview overview={overview} />);

  expect(screen.getByRole('heading', { name: '本周概览' })).toBeInTheDocument();
  expect(screen.getByText('11月2日 - 11月8日')).toBeInTheDocument();
  expect(screen.getByText('任务完成')).toBeInTheDocument();
  expect(screen.getByText('2 / 3')).toBeInTheDocument();
  expect(screen.getByText('75 分钟')).toBeInTheDocument();
  // Three answers is below the five-answer threshold: no percentage.
  expect(screen.getByText('3 题（样本不足）')).toBeInTheDocument();
  expect(screen.getByText('2 天')).toBeInTheDocument();
  expect(screen.getByText('2 道')).toBeInTheDocument();
  expect(screen.getByText('2 在学 · 1 已掌握')).toBeInTheDocument();
  expect(screen.getByText('薄弱主题：线代')).toBeInTheDocument();
});

test('shows the percentage once the sample is large enough (验收 15 negative)', () => {
  render(
    <WeeklyOverview
      overview={{ ...overview, answered: 5, correct: 4, accuracy: 4 / 5, accuracyReliable: true }}
    />
  );
  expect(screen.getByText('80%（4/5）')).toBeInTheDocument();
  expect(screen.queryByText(/样本不足/)).not.toBeInTheDocument();
});

test('shows a dash before the first answer', () => {
  render(
    <WeeklyOverview
      overview={{
        ...overview,
        answered: 0,
        correct: 0,
        accuracy: null,
        accuracyReliable: false,
        weakestTopic: null
      }}
    />
  );

  expect(screen.getByText('—')).toBeInTheDocument();
  expect(screen.queryByText(/样本不足/)).not.toBeInTheDocument();
  expect(screen.queryByText(/薄弱主题/)).not.toBeInTheDocument();
});

test('shows this week’s overview on the review page and follows the workspace filter', async () => {
  const userEvent = (await import('@testing-library/user-event')).default;
  render(
    <ReviewPage
      workspaces={[
        {
          id: 'kaoyan',
          name: '考研',
          kind: 'exam',
          color: '#0071e3',
          goal: '',
          description: ''
        },
        {
          id: 'english',
          name: '英语',
          kind: 'study',
          color: '#34c759',
          goal: '',
          description: ''
        }
      ]}
      reviews={[]}
      onOpenSidebar={vi.fn()}
      onPrompt={vi.fn()}
      tasks={[
        {
          id: 't1',
          workspaceId: 'kaoyan',
          title: '极限',
          subject: '数学',
          durationMin: 45,
          acceptance: '',
          status: 'done',
          actualMin: 40,
          due: TODAY
        },
        {
          id: 't2',
          workspaceId: 'english',
          title: '精读',
          subject: '英语',
          durationMin: 30,
          acceptance: '',
          status: 'pending',
          due: TODAY
        }
      ]}
    />
  );

  expect(screen.getByRole('heading', { name: '本周概览' })).toBeInTheDocument();
  expect(screen.getByText('1 / 2')).toBeInTheDocument();
  expect(screen.getByText('40 分钟')).toBeInTheDocument();

  await pickOption('按项目筛选复盘', '英语');
  expect(screen.getByText('0 / 1')).toBeInTheDocument();
  expect(screen.getByText('0 分钟')).toBeInTheDocument();
});
