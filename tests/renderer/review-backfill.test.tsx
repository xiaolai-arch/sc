// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReviewRecord } from '../../src/shared/ipc';
import type { SubmitReviewInput, Workspace } from '../../src/shared/workspace';
import { ReviewPage } from '../../src/renderer/shell/ReviewPage';
import { pickOption } from './select-option';

const workspaces: Workspace[] = [
  {
    id: 'kaoyan',
    name: '考研',
    kind: 'exam',
    color: '#0071e3',
    goal: '上岸',
    description: ''
  },
  {
    id: 'english',
    name: '英语',
    kind: 'study',
    color: '#34c759',
    goal: '每天精读',
    description: ''
  }
];

const longCompleted = '完成数学 10 题，整理错题本并把每一道错题的思路重新写了一遍，晚上又复习了极限的定义和常见变形，状态比昨天好很多。';

function makeReview(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    date: '2026-10-30',
    submittedAt: '2026-10-30T21:00:00.000Z',
    completed: '完成数学 10 题',
    stuck: '极限定义',
    tomorrow: '复盘错题',
    ...overrides
  };
}

function renderPage(props: {
  reviews?: ReviewRecord[];
  onSubmitReview?: (input: SubmitReviewInput) => Promise<void>;
  onSubmitted?: () => void;
}) {
  const onPrompt = vi.fn();
  const view = render(
    <ReviewPage
      workspaces={workspaces}
      reviews={props.reviews ?? []}
      onOpenSidebar={vi.fn()}
      onPrompt={onPrompt}
      onSubmitReview={props.onSubmitReview}
      onSubmitted={props.onSubmitted}
    />
  );
  return { ...view, onPrompt };
}

test('renders the backfill button only when onSubmitReview is provided', () => {
  const { rerender } = render(
    <ReviewPage
      workspaces={workspaces}
      reviews={[]}
      onOpenSidebar={vi.fn()}
      onPrompt={vi.fn()}
    />
  );
  expect(screen.queryByRole('button', { name: '补录复盘' })).not.toBeInTheDocument();

  rerender(
    <ReviewPage
      workspaces={workspaces}
      reviews={[]}
      onOpenSidebar={vi.fn()}
      onPrompt={vi.fn()}
      onSubmitReview={vi.fn()}
    />
  );
  expect(screen.getByRole('button', { name: '补录复盘' })).toBeInTheDocument();
});

test('validates an entirely empty backfill form', async () => {
  const onSubmitReview = vi.fn(async () => undefined);
  renderPage({ onSubmitReview });

  await userEvent.click(screen.getByRole('button', { name: '补录复盘' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '保存' }));

  expect(screen.getByRole('alert')).toHaveTextContent('至少填写完成、卡点或明天中的一项。');
  expect(onSubmitReview).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('submits the exact backfill input and refreshes after success', async () => {
  const onSubmitReview = vi.fn(async () => undefined);
  const onSubmitted = vi.fn();
  renderPage({ onSubmitReview, onSubmitted });

  await userEvent.click(screen.getByRole('button', { name: '补录复盘' }));

  fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-10-31' } });
  await pickOption('工作区', '考研');
  await userEvent.type(screen.getByLabelText('完成'), '完成数学 10 题');
  await userEvent.type(screen.getByLabelText('卡点'), '极限定义');
  await userEvent.type(screen.getByLabelText('明天'), '复盘错题');

  await userEvent.click(screen.getByRole('button', { name: '保存' }));

  await waitFor(() =>
    expect(onSubmitReview).toHaveBeenCalledWith({
      date: '2026-10-31',
      workspaceId: 'kaoyan',
      answers: {
        completed: '完成数学 10 题',
        stuck: '极限定义',
        tomorrow: '复盘错题'
      }
    })
  );
  await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('refuses to create a second review for the same date and workspace', async () => {
  const onSubmitReview = vi.fn(async () => undefined);
  renderPage({ reviews: [makeReview({ date: '2026-10-30' })], onSubmitReview });

  await userEvent.click(screen.getByRole('button', { name: '补录复盘' }));
  fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-10-30' } });
  await userEvent.type(screen.getByLabelText('完成'), '重复的一次');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));

  expect(screen.getByRole('alert')).toHaveTextContent('这一天已经有复盘了');
  expect(onSubmitReview).not.toHaveBeenCalled();
});

test('expands and collapses a review to read the full text', async () => {
  renderPage({ reviews: [makeReview({ completed: longCompleted })] });

  const completed = screen.getByText(`完成：${longCompleted}`);
  expect(completed).toHaveClass('line-clamp-2');

  const expand = screen.getByRole('button', { name: '展开 2026-10-30 的复盘全文' });
  expect(expand).toHaveAttribute('aria-expanded', 'false');

  await userEvent.click(expand);

  const collapse = screen.getByRole('button', { name: '收起 2026-10-30 的复盘全文' });
  expect(collapse).toHaveAttribute('aria-expanded', 'true');
  expect(completed).not.toHaveClass('line-clamp-2');

  await userEvent.click(collapse);

  expect(screen.getByText(`完成：${longCompleted}`)).toHaveClass('line-clamp-2');
});

test('keeps filtering reviews by workspace', async () => {
  renderPage({
    reviews: [
      makeReview({ date: '2026-10-30', workspaceId: 'kaoyan', completed: '完成数学 10 题' }),
      makeReview({
        date: '2026-10-29',
        submittedAt: '2026-10-29T21:00:00.000Z',
        workspaceId: 'english',
        completed: '完成外刊精读'
      }),
      makeReview({
        date: '2026-10-28',
        submittedAt: '2026-10-28T21:00:00.000Z',
        completed: '完成全局整理'
      })
    ]
  });

  expect(screen.getByText('完成：完成数学 10 题')).toBeInTheDocument();
  expect(screen.getByText('完成：完成外刊精读')).toBeInTheDocument();
  expect(screen.getByText('完成：完成全局整理')).toBeInTheDocument();

  await pickOption('按工作区筛选复盘', '考研');

  expect(screen.getByText('完成：完成数学 10 题')).toBeInTheDocument();
  expect(screen.queryByText('完成：完成外刊精读')).not.toBeInTheDocument();
  expect(screen.queryByText('完成：完成全局整理')).not.toBeInTheDocument();

  await pickOption('按工作区筛选复盘', '全部工作区');

  expect(screen.getByText('完成：完成外刊精读')).toBeInTheDocument();
  expect(screen.getByText('完成：完成全局整理')).toBeInTheDocument();
});

test('explains when only other workspaces have reviews', async () => {
  renderPage({ reviews: [makeReview({ completed: '完成数学 10 题' })] });

  await pickOption('按工作区筛选复盘', '英语');

  expect(screen.getByText('「英语」还没有复盘记录。')).toBeInTheDocument();
  expect(
    screen.getByText('其他工作区还有 1 条复盘，切换上方筛选即可查看。')
  ).toBeInTheDocument();
});
