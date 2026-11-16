// @vitest-environment jsdom
import { homeGreeting } from '../../src/shared/greeting';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { sendPrompt } from './send-prompt';
import type { ButlerStreamListener } from '../../src/shared/butler-stream';
import type { SendMessageInput, SendMessageResult } from '../../src/shared/workspace';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { conversationRuns } from '../../src/renderer/shell/conversation-runs';
import { createMockApi } from '../../web/mock-api';
import { DAILY_WORKSPACE_ID } from '../../src/shared/conversations';

const ANSWER = '导航之后仍然生成的回答';

type StreamFn = (
  input: SendMessageInput,
  onEvent: ButlerStreamListener
) => Promise<SendMessageResult>;

/** Writes the answer back so a reload of the conversation finds it. */
async function persistAnswer(input: SendMessageInput, answer: string) {
  const api = window.studyCoach;
  if (!api || !input.conversationId || !input.assistantMessageId) return;
  await api.appendConversationMessage(input.conversationId, {
    id: input.assistantMessageId,
    role: 'assistant',
    text: answer,
    createdAt: new Date().toISOString()
  });
}

function setup(stream?: StreamFn) {
  localStorage.clear();
  conversationRuns.reset();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  if (stream) api.stream = stream;
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

function gatedStream() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stream: StreamFn = async (input, onEvent) => {
    onEvent({ type: 'reasoning', text: '先看今天的任务' });
    await gate;
    onEvent({ type: 'text', text: ANSWER });
    onEvent({ type: 'done', text: ANSWER });
    await persistAnswer(input, ANSWER);
    return {
      text: ANSWER,
      ...(input.conversationId ? { conversationId: input.conversationId } : {})
    };
  };
  return { stream, release };
}

async function openConversationFromSidebar(title: RegExp) {
  const sidebar = screen.getAllByRole('complementary')[0]!;
  await userEvent.click(await within(sidebar).findByRole('button', { name: title }));
}

test('navigating to another page mid-answer neither cancels nor loses the answer', async () => {
  const { stream, release } = gatedStream();
  const api = setup(stream);
  const cancelRun = vi.spyOn(api, 'cancelRun');
  const cancelStream = vi.spyOn(api, 'cancelStream');

  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await sendPrompt('帮我排一下今天的优先级');

  await userEvent.click(screen.getByRole('button', { name: '今日安排' }));
  await waitFor(() =>
    expect(screen.queryByLabelText('向阿咲提问')).not.toBeInTheDocument()
  );

  release();
  // Let the turn finish while the schedule page is showing.
  await waitFor(async () => {
    const [summary] = await api.listConversations();
    const conversation = await api.getConversation(summary!.id);
    expect(conversation?.messages.some((message) => message.text === ANSWER)).toBe(true);
  });

  expect(cancelRun).not.toHaveBeenCalled();
  expect(cancelStream).not.toHaveBeenCalled();

  // Back to chat: the finished answer is there without any manual refresh.
  await userEvent.click(screen.getByRole('button', { name: '日常' }));
  await openConversationFromSidebar(/帮我排一下今天的优先级/);
  expect((await screen.findAllByText(ANSWER)).length).toBeGreaterThan(0);
});

test('starting a new draft mid-answer keeps the background turn running', async () => {
  const { stream, release } = gatedStream();
  const api = setup(stream);
  const cancelRun = vi.spyOn(api, 'cancelRun');

  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await sendPrompt('帮我排一下今天的优先级');
  await screen.findByText(/先看今天的任务/);

  await userEvent.click(screen.getByRole('button', { name: '新对话' }));
  expect(await screen.findByText(homeGreeting('xiaolai', new Date()))).toBeInTheDocument();

  release();
  await waitFor(async () => {
    const [summary] = await api.listConversations();
    const conversation = await api.getConversation(summary!.id);
    expect(conversation?.messages.some((message) => message.text === ANSWER)).toBe(true);
  });
  expect(cancelRun).not.toHaveBeenCalled();

  const sidebar = screen.getAllByRole('complementary')[0]!;
  await userEvent.click(
    await within(sidebar).findByRole('button', { name: /帮我排一下今天的优先级/ })
  );
  expect((await screen.findAllByText(ANSWER)).length).toBeGreaterThan(0);
});

test('a turn restored after a restart shows its partial answer and why it stopped', async () => {
  localStorage.clear();
  conversationRuns.reset();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  const conversation = await api.createConversation({ workspaceId: DAILY_WORKSPACE_ID });
  await api.appendConversationMessage(conversation.id, {
    id: 'u1',
    role: 'user',
    text: '帮我排一下明天的计划',
    createdAt: new Date().toISOString(),
    source: 'user'
  });
  api.listConversationRuns = async () => [
    {
      runId: 'a1',
      conversationId: conversation.id,
      assistantMessageId: 'a1',
      status: 'interrupted',
      sequence: 6,
      partialText: '明天上午先做数学',
      reasoningText: '先看已有任务',
      steps: [
        { id: 't1', name: 'get_today_plan', label: '读取今日计划', status: 'done' }
      ],
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      errorReason: '应用已退出，本次生成中断。'
    }
  ];
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);

  await screen.findByText(homeGreeting('xiaolai', new Date()));
  const sidebar = screen.getAllByRole('complementary')[0]!;
  await userEvent.click(
    await within(sidebar).findByRole('button', { name: /帮我排一下明天的计划/ })
  );

  expect(await screen.findByText('明天上午先做数学')).toBeInTheDocument();
  expect(
    await screen.findByText('应用已退出，本次生成中断。')
  ).toBeInTheDocument();
  // Restored runs are never "live": no spinner, no stop button.
  expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument();
});
