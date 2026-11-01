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

async function sendFirstMessage() {
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '帮我排一下今天的优先级' }));
  await screen.findAllByText(/我先按截止时间和精力排/);
}

test('has no model picker without an active conversation', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');

  expect(
    screen.queryByRole('button', { name: '设置本对话模型' })
  ).not.toBeInTheDocument();
});

test('sets, shows and clears a per-conversation model', async () => {
  const api = setup();
  await sendFirstMessage();

  await userEvent.click(screen.getByRole('button', { name: '设置本对话模型' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('本对话模型')).toBeInTheDocument();
  expect(screen.getByLabelText('模型 ID')).toHaveValue('');
  expect(screen.getByPlaceholderText(/跟随全局/)).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('模型 ID'), 'gpt-x');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: '设置本对话模型' })).toHaveTextContent('gpt-x');

  const summary = (await api.listConversations())[0]!;
  expect((await api.getConversation(summary.id))?.model).toBe('gpt-x');

  await userEvent.click(screen.getByRole('button', { name: '设置本对话模型' }));
  await userEvent.clear(screen.getByLabelText('模型 ID'));
  await userEvent.click(screen.getByRole('button', { name: '保存' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect((await api.getConversation(summary.id))?.model).toBeUndefined();
  expect(screen.getByRole('button', { name: '设置本对话模型' })).not.toHaveTextContent(
    'gpt-x'
  );
});

test('keeps the dialog and input when saving fails', async () => {
  const api = setup();
  await sendFirstMessage();
  const spy = vi
    .spyOn(api, 'setConversationModel')
    .mockRejectedValueOnce(new Error('保存失败'));

  await userEvent.click(screen.getByRole('button', { name: '设置本对话模型' }));
  await userEvent.type(screen.getByLabelText('模型 ID'), 'bad-model');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));

  expect(await screen.findByText('保存失败')).toBeInTheDocument();
  expect(screen.getByLabelText('模型 ID')).toHaveValue('bad-model');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  spy.mockRestore();
});

test('shows the override only for its own conversation', async () => {
  setup();
  await sendFirstMessage();

  await userEvent.click(screen.getByRole('button', { name: '设置本对话模型' }));
  await userEvent.type(screen.getByLabelText('模型 ID'), 'model-a');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  await userEvent.click(screen.getByRole('button', { name: '新对话' }));
  expect(
    screen.queryByRole('button', { name: '设置本对话模型' })
  ).not.toBeInTheDocument();

  const sidebar = screen.getAllByRole('complementary')[0]!;
  await userEvent.click(
    within(sidebar).getByRole('button', { name: /帮我排一下今天的优先级/ })
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '设置本对话模型' })).toHaveTextContent(
      'model-a'
    )
  );
});
