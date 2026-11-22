// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { homeGreeting } from '../../src/shared/greeting';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

function setup() {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

function nav() {
  return within(screen.getByRole('navigation', { name: '主导航' }));
}

test('adding a plan day links one task to the project goal, and today still renders it', async () => {
  const api = setup();
  await screen.findByText(homeGreeting('xiaolai', new Date()));

  await userEvent.click(nav().getByRole('button', { name: '长期计划' }));
  await screen.findByText('还没有长期计划。');

  await userEvent.click(screen.getByRole('button', { name: '新建长期计划' }));
  await userEvent.type(screen.getByLabelText('目标'), '系统学习 AI Agent，能独立做项目');
  await userEvent.clear(screen.getByLabelText('总周数'));
  await userEvent.type(screen.getByLabelText('总周数'), '2');
  await userEvent.click(screen.getByRole('button', { name: '生成计划' }));

  const detail = await screen.findByRole('region', { name: '计划详情' });
  await userEvent.click(within(detail).getByRole('button', { name: '加入今日安排' }));
  await within(detail).findByText('已加入今日安排');

  // Find the project the plan belongs to, then check the tasks it created.
  const workspaces = await api.listWorkspaces();
  const perWorkspace = await Promise.all(
    workspaces.map(async (workspace) => ({
      workspace,
      tasks: (await api.getWorkspaceSnapshot(workspace.id)).tasks
    }))
  );
  const owner = perWorkspace.find((entry) =>
    entry.tasks.some((task) => task.planItemId !== undefined)
  );
  expect(owner).toBeDefined();
  const planTasks = owner!.tasks.filter((task) => task.planItemId !== undefined);
  expect(owner!.workspace.goalId).toBeTruthy();
  // Every plan-derived task serves the project's goal, and the plan day's
  // task lines stay distinct instead of collapsing into one.
  expect(planTasks.every((task) => task.goalId === owner!.workspace.goalId)).toBe(true);
  expect(new Set(planTasks.map((task) => task.title)).size).toBe(planTasks.length);

  // The 今日安排 page still renders the linked task, goal and all.
  await userEvent.click(nav().getByRole('button', { name: '今日安排' }));
  expect(await screen.findByText('今天的时间表')).toBeInTheDocument();
  expect(await screen.findByText(planTasks[0]!.title)).toBeInTheDocument();
});
