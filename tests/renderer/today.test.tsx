// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TodayPage } from '../../src/renderer/today/TodayPage';

const plan = {
  date: '2026-10-31',
  generatedBy: 'agent' as const,
  tasks: [
    {
      id: 't1',
      title: '极限与连续',
      subject: '数学',
      durationMin: 45,
      materialRefs: [],
      acceptance: '完成 10 题',
      status: 'pending' as const
    },
    {
      id: 't2',
      title: '阅读理解',
      subject: '英语',
      durationMin: 30,
      materialRefs: [],
      acceptance: '精读 1 篇',
      status: 'pending' as const
    }
  ]
};

test('renders tasks and completes one', async () => {
  const updateTask = vi
    .fn()
    .mockResolvedValue({ ...plan, tasks: [{ ...plan.tasks[0], status: 'done' }, plan.tasks[1]] });
  window.studyCoach = { getTodayPlan: vi.fn().mockResolvedValue(plan), updateTask } as never;
  render(<TodayPage />);
  expect(await screen.findByText('极限与连续')).toBeInTheDocument();
  expect(screen.getByText('完成 10 题')).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: '完成' })[0]);
  expect(updateTask).toHaveBeenCalledWith({ taskId: 't1', status: 'done' });
  expect(await screen.findByText('1 / 2 完成')).toBeInTheDocument();
});

test('shows a generate button when there is no plan', async () => {
  const generate = vi.fn().mockResolvedValue(plan);
  window.studyCoach = { getTodayPlan: vi.fn().mockResolvedValue(null), generateTodayPlan: generate } as never;
  render(<TodayPage />);
  await userEvent.click(await screen.findByRole('button', { name: '生成今日计划' }));
  expect(generate).toHaveBeenCalled();
});

test('shows a retry and no generate action when loading fails', async () => {
  const generate = vi.fn();
  window.studyCoach = {
    getTodayPlan: vi.fn().mockRejectedValue(new Error('读取失败')),
    generateTodayPlan: generate
  } as never;
  render(<TodayPage />);
  expect(await screen.findByText('今日计划加载失败')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '生成今日计划' })).not.toBeInTheDocument();
  expect(generate).not.toHaveBeenCalled();
});

test('shows an alert and keeps the plan when completing fails', async () => {
  const updateTask = vi.fn().mockRejectedValue(new Error('保存失败'));
  window.studyCoach = { getTodayPlan: vi.fn().mockResolvedValue(plan), updateTask } as never;
  render(<TodayPage />);
  await screen.findByText('极限与连续');
  await userEvent.click(screen.getAllByRole('button', { name: '完成' })[0]);
  expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
  expect(screen.getByText('0 / 2 完成')).toBeInTheDocument();
});

test('shows an empty state when the plan has no tasks', async () => {
  window.studyCoach = {
    getTodayPlan: vi.fn().mockResolvedValue({ date: '2026-10-31', generatedBy: 'template', tasks: [] })
  } as never;
  render(<TodayPage />);
  expect(await screen.findByText('今天没有安排任务')).toBeInTheDocument();
});

test('records elapsed time when completing an in-progress task', async () => {
  const inProgress = {
    ...plan,
    tasks: [{ ...plan.tasks[0], status: 'in-progress' as const }, plan.tasks[1]]
  };
  const updateTask = vi.fn().mockResolvedValue({
    ...inProgress,
    tasks: [{ ...inProgress.tasks[0], status: 'done' as const, actualMin: 0 }, inProgress.tasks[1]]
  });
  window.studyCoach = { getTodayPlan: vi.fn().mockResolvedValue(inProgress), updateTask } as never;
  render(<TodayPage />);
  await userEvent.click(await screen.findByRole('button', { name: '开始计时' }));
  await userEvent.click(screen.getAllByRole('button', { name: '完成' })[0]);
  expect(updateTask).toHaveBeenCalledWith(
    expect.objectContaining({ taskId: 't1', status: 'done', actualMin: 0 })
  );
});

test('keeps break-words on long unbroken task text', async () => {
  const longTitle = 'A'.repeat(120);
  const longPlan = {
    ...plan,
    tasks: [{ ...plan.tasks[0], title: longTitle, acceptance: 'B'.repeat(120) }]
  };
  window.studyCoach = { getTodayPlan: vi.fn().mockResolvedValue(longPlan) } as never;
  render(<TodayPage />);
  const title = await screen.findByText(longTitle);
  expect(title.className).toContain('break-words');
});
