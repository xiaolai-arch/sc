// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workspace } from '../../src/renderer/shell/Workspace';
import type { Conversation } from '../../src/shared/conversations';
import { createMockApi } from '../../web/mock-api';

function setup() {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

async function openConversation(api: ReturnType<typeof setup>): Promise<Conversation> {
  const summaries = await api.listConversations();
  const id = summaries[0]?.id;
  if (!id) throw new Error('no conversation');
  const conversation = await api.getConversation(id);
  if (!conversation) throw new Error('missing conversation');
  return conversation;
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) }
  });
});

test('copies an assistant message and regenerates it without duplicating the user message', async () => {
  const api = setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '帮我排一下今天的优先级' }));
  await screen.findAllByText(/我先按截止时间和精力排/);
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument()
  );

  await userEvent.click(screen.getByRole('button', { name: '复制' }));
  const writeText = navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>;
  expect(writeText).toHaveBeenCalled();
  expect(String(writeText.mock.calls[0]?.[0])).toContain('我先按截止时间和精力排');

  await userEvent.click(screen.getByRole('button', { name: '重新生成' }));
  await waitFor(
    async () => {
      const conversation = await openConversation(api);
      expect(conversation.messages).toHaveLength(2);
      expect(conversation.messages.filter((message) => message.role === 'user')).toHaveLength(1);
      expect(conversation.messages[1]?.role).toBe('assistant');
    },
    { timeout: 3000 }
  );
});

test('edits the last user message before resending it', async () => {
  const api = setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.type(screen.getByLabelText('向阿咲提问'), '记一下：今天数学卡在极限');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findAllByText(/记下了/);

  await userEvent.click(screen.getByRole('button', { name: '编辑' }));
  const composer = screen.getByLabelText('向阿咲提问');
  expect((composer as HTMLTextAreaElement).value).toBe('记一下：今天数学卡在极限');

  await userEvent.clear(composer);
  await userEvent.type(composer, '记一下：今天英语阅读错了两题');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findAllByText(/记下了/);

  await waitFor(async () => {
    const conversation = await openConversation(api);
    const users = conversation.messages.filter((message) => message.role === 'user');
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe('记一下：今天英语阅读错了两题');
    expect(conversation.messages).toHaveLength(2);
  });
});

test('renames and pins a conversation from the sidebar menu', async () => {
  const api = setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '帮我排一下今天的优先级' }));
  await screen.findAllByText(/我先按截止时间和精力排/);

  const menuButton = await screen.findByRole('button', { name: '对话操作' });
  await userEvent.click(menuButton);
  await userEvent.click(screen.getByRole('menuitem', { name: '重命名' }));

  const input = screen.getByLabelText('对话标题');
  await userEvent.clear(input);
  await userEvent.type(input, '我的优先级');
  await userEvent.keyboard('{Enter}');

  expect(await screen.findByText('我的优先级')).toBeInTheDocument();
  expect((await openConversation(api)).title).toBe('我的优先级');

  await userEvent.click(screen.getByRole('button', { name: '对话操作' }));
  await userEvent.click(screen.getByRole('menuitem', { name: '置顶' }));
  await waitFor(async () => {
    const summaries = await api.listConversations();
    expect(summaries[0]?.pinned).toBe(true);
    expect(summaries[0]?.title).toBe('我的优先级');
  });
});

test('deletes a conversation only after confirmation and returns to the draft', async () => {
  const api = setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '帮我排一下今天的优先级' }));
  await screen.findAllByText(/我先按截止时间和精力排/);

  await userEvent.click(screen.getByRole('button', { name: '对话操作' }));
  await userEvent.click(screen.getByRole('menuitem', { name: '删除' }));
  expect(screen.getByRole('menuitem', { name: '确认删除' })).toBeInTheDocument();
  expect((await api.listConversations())).toHaveLength(1);

  await userEvent.click(screen.getByRole('menuitem', { name: '确认删除' }));
  expect(await screen.findByText('早上好，xiaolai。')).toBeInTheDocument();
  expect(await api.listConversations()).toEqual([]);
});

test('searches conversations by message body with a debounced input', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.type(screen.getByLabelText('向阿咲提问'), '记一下：今天数学卡在极限');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findAllByText(/记下了/);

  const search = screen.getByLabelText('搜索对话');
  await userEvent.type(search, '极限');
  const sidebar = screen.getAllByRole('complementary')[0]!;
  expect(
    await within(sidebar).findByText('记一下：今天数学卡在极限')
  ).toBeInTheDocument();

  await userEvent.clear(search);
  await userEvent.type(search, '不存在');
  expect(await screen.findByText('没有找到对话。')).toBeInTheDocument();
});

test('focuses the conversation search with Cmd+K', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  const search = screen.getByLabelText('搜索对话');

  // The window listener is installed by a mount effect that can land after the
  // welcome text; retry the keydown until the focus change proves it is ready.
  await waitFor(() => {
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(search).toHaveFocus();
  });
});

test('closes the conversation menu when clicking outside', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '帮我排一下今天的优先级' }));
  await screen.findAllByText(/我先按截止时间和精力排/);

  await userEvent.click(screen.getByRole('button', { name: '对话操作' }));
  expect(screen.getByRole('menu')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '新对话' }));
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
});

test('closes the conversation menu with Escape', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '帮我排一下今天的优先级' }));
  await screen.findAllByText(/我先按截止时间和精力排/);

  await userEvent.click(screen.getByRole('button', { name: '对话操作' }));
  expect(screen.getByRole('menu')).toBeInTheDocument();

  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
});
