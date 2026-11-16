// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
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

test('the home screen answers what is next and what reminds you', async () => {
  setup();

  expect(await screen.findByRole('region', { name: '接下来' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '最近提醒' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '目标进度' })).toBeInTheDocument();
  expect(
    within(screen.getByRole('region', { name: '接下来' })).getAllByRole('checkbox').length
  ).toBeGreaterThan(0);
  expect(
    within(screen.getByRole('region', { name: '目标进度' })).getByText(
      /还没有进行中的长期目标|%/
    )
  ).toBeInTheDocument();
});

test('the sidebar groups entries without hiding any old page', async () => {
  setup();
  await screen.findByRole('region', { name: '接下来' });

  for (const label of ['阿咲', '目标与计划', '记录与提醒']) {
    expect(nav().getByText(label)).toBeInTheDocument();
  }
  for (const label of [
    '今日',
    '日常',
    '知识库',
    '我的资料',
    '今日安排',
    '长期计划',
    '复盘',
    '记忆',
    '提醒'
  ]) {
    expect(nav().getByRole('button', { name: label })).toBeInTheDocument();
  }
});

test('the Today page opens with priorities, reminders and goal progress', async () => {
  setup();
  await screen.findByRole('region', { name: '接下来' });

  await userEvent.click(nav().getByRole('button', { name: '今日' }));
  expect(
    await screen.findByText('不用先想清楚全部，只需要知道现在最值得做的一件事。')
  ).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '接下来' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '最近提醒' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '目标进度' })).toBeInTheDocument();
});

test('settings expose the four groups', async () => {
  setup();
  await screen.findByRole('region', { name: '接下来' });

  await userEvent.click(screen.getByRole('button', { name: '打开设置' }));
  const groups = await screen.findByRole('navigation', { name: '设置分组' });
  for (const label of ['本机 AI', '提醒与后台', '个人与外观', '数据与备份']) {
    expect(within(groups).getByRole('button', { name: label })).toBeInTheDocument();
  }
});
