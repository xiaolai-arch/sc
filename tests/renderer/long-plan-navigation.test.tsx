// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

test('creates a plan from the sidebar and turns today’s row into schedule tasks', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');

  await userEvent.click(nav().getByRole('button', { name: '长期计划' }));
  expect(await screen.findByText('还没有长期计划。')).toBeInTheDocument();
  expect(nav().getByRole('button', { name: '长期计划' })).toHaveAttribute(
    'aria-current',
    'page'
  );

  await userEvent.click(screen.getByRole('button', { name: '新建长期计划' }));
  await userEvent.type(
    screen.getByLabelText('目标'),
    '系统学习 AI Agent，能独立做项目'
  );
  await userEvent.clear(screen.getByLabelText('总周数'));
  await userEvent.type(screen.getByLabelText('总周数'), '2');
  await userEvent.click(screen.getByRole('button', { name: '生成计划' }));

  const detail = await screen.findByRole('region', { name: '计划详情' });
  await within(detail).findByText('系统学习 AI Agent，能独立做项目');
  expect(within(detail).getByText(/通用框架/)).toBeInTheDocument();
  expect(within(detail).getByRole('progressbar', { name: '计划进度' })).toHaveAttribute(
    'aria-valuenow',
    '0'
  );

  await userEvent.click(within(detail).getByRole('button', { name: '加入今日安排' }));
  expect(await within(detail).findByText('已加入今日安排')).toBeInTheDocument();

  await userEvent.click(nav().getByRole('button', { name: '今日安排' }));
  expect(await screen.findByText('今天的时间表')).toBeInTheDocument();
  expect(
    await screen.findByText('明确本周目标，列出 3 个要解决的问题')
  ).toBeInTheDocument();

  await userEvent.click(nav().getByRole('button', { name: '长期计划' }));
  const detailAgain = await screen.findByRole('region', { name: '计划详情' });
  const dayCheckboxes = within(detailAgain).getAllByRole('checkbox', {
    name: /完成第 1 周 .* 的任务/
  });
  await userEvent.click(dayCheckboxes[0]!);
  await waitFor(() =>
    expect(within(detailAgain).getByRole('progressbar', { name: '计划进度' })).toHaveAttribute(
      'aria-valuenow',
      '1'
    )
  );
});
