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
