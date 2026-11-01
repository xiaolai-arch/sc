// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ButlerStreamListener } from '../../src/shared/butler-stream';
import type { SendMessageInput, SendMessageResult } from '../../src/shared/workspace';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

function setup(
  stream: (input: SendMessageInput, onEvent: ButlerStreamListener) => Promise<SendMessageResult>
) {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  api.stream = stream;
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

test('shows the retry status until new output arrives', async () => {
  let api: ReturnType<typeof createMockApi> | null = null;
  api = setup(async (input, onEvent) => {
    onEvent({ type: 'retry', attempt: 1, message: '模型连接失败，正在重试…' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    onEvent({ type: 'text', text: '最终回复' });
    onEvent({ type: 'done', text: '最终回复' });
    if (input.conversationId && api) {
      await api.appendConversationMessage(input.conversationId, {
        id: input.assistantMessageId ?? 'a1',
        role: 'assistant',
        text: '最终回复',
        createdAt: new Date().toISOString()
      });
    }
    return {
      text: '最终回复',
      ...(input.conversationId ? { conversationId: input.conversationId } : {})
    };
  });

  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '帮我排一下今天的优先级' }));

  expect(await screen.findByText('模型连接失败，正在重试…')).toBeInTheDocument();
  expect(await screen.findByText('最终回复')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByText('模型连接失败，正在重试…')).not.toBeInTheDocument()
  );
});

test('shows the classified error and clears the retry status', async () => {
  setup(async (_input, onEvent) => {
    onEvent({ type: 'retry', attempt: 1, message: '模型连接失败，正在重试…' });
    onEvent({
      type: 'error',
      message: '模型认证失败，请检查 API Key 或 CLI 登录：401'
    });
    onEvent({ type: 'done', text: '（模型暂时不可用，我先根据本地记录给你一个简要回复。）' });
    return { text: '（模型暂时不可用，我先根据本地记录给你一个简要回复。）' };
  });

  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '帮我排一下今天的优先级' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('模型认证失败');
  await waitFor(() =>
    expect(screen.queryByText('模型连接失败，正在重试…')).not.toBeInTheDocument()
  );
});
