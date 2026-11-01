// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

function setup() {
  localStorage.clear();
  const api = createMockApi(localStorage);
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

test('shows the welcome draft and sends a message', async () => {
  setup();
  expect(await screen.findByText('早上好，xiaolai。')).toBeInTheDocument();
  expect(screen.getByText('还没有对话。告诉管家你想做什么。')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '帮我排一下今天的优先级' }));

  expect((await screen.findAllByText(/我先按截止时间和精力排/)).length).toBeGreaterThan(0);
  expect(screen.getAllByText('帮我排一下今天的优先级').length).toBeGreaterThan(1);
});

test('starts a new draft and reopens a previous conversation', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '帮我排一下今天的优先级' }));
  await screen.findAllByText(/我先按截止时间和精力排/);

  await userEvent.click(screen.getByRole('button', { name: '新对话' }));
  expect(await screen.findByText('早上好，xiaolai。')).toBeInTheDocument();

  const sidebar = screen.getAllByRole('complementary')[0]!;
  const conversation = within(sidebar).getByRole('button', {
    name: /帮我排一下今天的优先级/
  });
  await userEvent.click(conversation);
  expect((await screen.findAllByText(/我先按截止时间和精力排/)).length).toBeGreaterThan(0);
});

test('selects a project and filters the project panel', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  expect(await screen.findByText('外刊精读')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '考研' }));

  expect(await screen.findByText('极限与连续')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('外刊精读')).not.toBeInTheDocument());
});

test('records a note and previews it from the records tab', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '记一下：今天数学卡在极限' }));
  expect((await screen.findAllByText(/记下了/, {}, { timeout: 3000 })).length).toBeGreaterThan(0);

  await userEvent.click(screen.getByRole('button', { name: '记录' }));
  const noteButton = await screen.findByRole(
    'button',
    { name: /^今天数学卡在极限/ },
    { timeout: 3000 }
  );
  await userEvent.click(noteButton);

  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/记一下：今天数学卡在极限/)).toBeInTheDocument();
});

test('shows the review and reminder tabs', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');

  await userEvent.click(screen.getByRole('button', { name: '复盘' }));
  expect(await screen.findByText('还没有复盘记录。')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '提醒' }));
  expect(await screen.findByText('21:30')).toBeInTheDocument();
});

test('opens the settings modal from the sidebar', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');

  await userEvent.click(screen.getByRole('button', { name: '打开设置' }));
  expect(await screen.findByLabelText('模型名称')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByLabelText('模型名称')).not.toBeInTheDocument());
});

test('creates a project through the conversation', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');

  await userEvent.type(screen.getByLabelText('向管家提问'), '我想考研');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(
    await screen.findByText(/已(创建|找到)项目「考研」/, {}, { timeout: 3000 })
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '考研' })).toBeInTheDocument();
  expect(await screen.findByText('2027 考研：数学一 / 英语一 / 政治')).toBeInTheDocument();
});

test('opens practice from the project panel', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');

  await userEvent.click(screen.getByRole('button', { name: '练习' }));
  expect((await screen.findAllByText('极限基础 3 题')).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '关闭练习' })).toBeInTheDocument();
});
