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

/** Opens a sidebar conversation and waits until its messages have loaded. */
async function selectConversationFromSidebar(title: RegExp) {
  await openConversationFromSidebar(title);
  await waitFor(() =>
    expect(screen.queryByText('正在打开对话…')).not.toBeInTheDocument()
  );
}

/** Seeds a conversation with one user message so it appears in the sidebar. */
async function seedConversation(
  api: ReturnType<typeof createMockApi>,
  text: string
): Promise<string> {
  const conversation = await api.createConversation({ workspaceId: DAILY_WORKSPACE_ID });
  await api.appendConversationMessage(conversation.id, {
    id: `seed-${conversation.id}`,
    role: 'user',
    text,
    createdAt: new Date().toISOString(),
    source: 'user'
  });
  return conversation.id;
}

/**
 * Like `setup`, but conversations can be prepared before the first render, and
 * the stream can be built from the ids the seed step produced.
 */
async function setupWithConversations(
  seed: (api: ReturnType<typeof createMockApi>) => Promise<void>,
  attachStream?: (api: ReturnType<typeof createMockApi>) => StreamFn
) {
  localStorage.clear();
  conversationRuns.reset();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  await seed(api);
  const stream = attachStream?.(api);
  if (stream) api.stream = stream;
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

/** One independently gated stream per conversation, so two can run at once. */
function gatedConversationStreams(answers: Map<string, string>) {
  const gates = new Map<string, Promise<void>>();
  const releases = new Map<string, () => void>();
  function gateFor(conversationId: string): Promise<void> {
    const existing = gates.get(conversationId);
    if (existing) return existing;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    gates.set(conversationId, gate);
    releases.set(conversationId, release);
    return gate;
  }
  const stream: StreamFn = async (input, onEvent) => {
    const conversationId = input.conversationId;
    if (!conversationId) throw new Error('缺少对话 id，无法路由回答');
    const answer = answers.get(conversationId);
    if (answer === undefined) throw new Error(`没有为对话 ${conversationId} 准备回答`);
    onEvent({ type: 'reasoning', text: '先看今天的任务' });
    await gateFor(conversationId);
    onEvent({ type: 'text', text: answer });
    onEvent({ type: 'done', text: answer });
    await persistAnswer(input, answer);
    return { text: answer, conversationId };
  };
  const release = (conversationId: string) => {
    gateFor(conversationId);
    releases.get(conversationId)!();
  };
  return { stream, release };
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

test('a reply survives 今日 / 知识库 / 设置 and never leaks into another conversation', async () => {
  const { stream, release } = gatedStream();
  const otherPrompt = '另一个对话里的旧消息';
  let otherId = '';
  const api = await setupWithConversations(
    async (seedApi) => {
      otherId = await seedConversation(seedApi, otherPrompt);
    },
    () => stream
  );
  const cancelRun = vi.spyOn(api, 'cancelRun');
  const cancelStream = vi.spyOn(api, 'cancelStream');

  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await sendPrompt('帮我排一下今天的优先级');
  expect(await screen.findByText(/先看今天的任务/)).toBeInTheDocument();
  const originalId = conversationRuns
    .list()
    .find((run) => run.conversationId !== otherId)!.conversationId;

  // 今日: the chat page unmounts, but the run must keep going in the background.
  await userEvent.click(screen.getByRole('button', { name: '今日' }));
  expect(await screen.findByText('接下来做什么')).toBeInTheDocument();
  expect(screen.queryByLabelText('向阿咲提问')).not.toBeInTheDocument();

  // 知识库
  await userEvent.click(screen.getByRole('button', { name: '知识库' }));
  expect(await screen.findByText('还没有知识主题')).toBeInTheDocument();
  expect(screen.queryByLabelText('向阿咲提问')).not.toBeInTheDocument();

  // 设置
  await userEvent.click(screen.getByRole('button', { name: '打开设置' }));
  expect(await screen.findByLabelText('模型名称')).toBeInTheDocument();
  expect(screen.queryByLabelText('向阿咲提问')).not.toBeInTheDocument();

  // Still gated: none of this navigation produced or leaked the answer early.
  expect(screen.queryByText(ANSWER)).not.toBeInTheDocument();

  release();
  await waitFor(async () => {
    const conversation = await api.getConversation(originalId);
    expect(conversation?.messages.some((message) => message.text === ANSWER)).toBe(true);
  });
  const settled = conversationRuns.getForConversation(originalId);
  expect(settled?.text).toBe(ANSWER);
  expect(settled?.canceled).toBe(false);
  expect(cancelRun).not.toHaveBeenCalled();
  expect(cancelStream).not.toHaveBeenCalled();

  // Back to chat, then open another conversation: this answer stays in the first one.
  await userEvent.click(screen.getByRole('button', { name: '日常' }));
  await selectConversationFromSidebar(new RegExp(otherPrompt));
  await waitFor(() => expect(screen.queryByText(ANSWER)).not.toBeInTheDocument());
  const other = await api.getConversation(otherId);
  expect(other?.messages.some((message) => message.text === ANSWER)).toBe(false);

  // Switching back shows the finished answer without a manual refresh.
  await selectConversationFromSidebar(/帮我排一下今天的优先级/);
  expect((await screen.findAllByText(ANSWER)).length).toBeGreaterThan(0);
});

test('two conversations stream at once without crossing answers or assistant ids', async () => {
  const promptA = '早上先背单词';
  const promptB = '晚上复盘数学';
  const answerA = '第一个对话的回答只属于它自己';
  const answerB = '第二个对话的回答只属于它自己';
  let aId = '';
  let bId = '';
  let release!: (conversationId: string) => void;
  const api = await setupWithConversations(
    async (seedApi) => {
      aId = await seedConversation(seedApi, promptA);
      bId = await seedConversation(seedApi, promptB);
    },
    () => {
      const gated = gatedConversationStreams(
        new Map([
          [aId, answerA],
          [bId, answerB]
        ])
      );
      release = gated.release;
      return gated.stream;
    }
  );
  const cancelRun = vi.spyOn(api, 'cancelRun');

  await screen.findByText(homeGreeting('xiaolai', new Date()));

  // Conversation A starts generating and stays gated.
  await selectConversationFromSidebar(new RegExp(promptA));
  await sendPrompt('先把今天的任务列出来');
  await waitFor(() =>
    expect(conversationRuns.getForConversation(aId)?.phase).toBe('running')
  );

  // Conversation B starts its own turn while A is still generating.
  await selectConversationFromSidebar(new RegExp(promptB));
  await sendPrompt('也帮我看看');
  await waitFor(() =>
    expect(conversationRuns.getForConversation(bId)?.phase).toBe('running')
  );
  expect(conversationRuns.getForConversation(aId)?.phase).toBe('running');

  release(aId);
  release(bId);
  await waitFor(async () => {
    const [conversationA, conversationB] = await Promise.all([
      api.getConversation(aId),
      api.getConversation(bId)
    ]);
    expect(
      conversationA?.messages.some((message) => message.text === answerA)
    ).toBe(true);
    expect(
      conversationB?.messages.some((message) => message.text === answerB)
    ).toBe(true);
  });

  const [conversationA, conversationB] = await Promise.all([
    api.getConversation(aId),
    api.getConversation(bId)
  ]);
  expect(conversationA).not.toBeNull();
  expect(conversationB).not.toBeNull();

  const textA = conversationA!.messages.map((message) => message.text).join('\n');
  const textB = conversationB!.messages.map((message) => message.text).join('\n');
  expect(textA).toContain(answerA);
  expect(textA).not.toContain(answerB);
  expect(textA).not.toContain(promptB);
  expect(textB).toContain(answerB);
  expect(textB).not.toContain(answerA);
  expect(textB).not.toContain(promptA);

  // Each conversation owns exactly one assistant message, and the ids never repeat.
  const assistantIdsA = conversationA!.messages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.id);
  const assistantIdsB = conversationB!.messages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.id);
  expect(assistantIdsA).toHaveLength(1);
  expect(assistantIdsB).toHaveLength(1);
  expect(new Set([...assistantIdsA, ...assistantIdsB]).size).toBe(2);
  for (const conversation of [conversationA!, conversationB!]) {
    const ids = conversation.messages.map((message) => message.id);
    expect(new Set(ids).size).toBe(ids.length);
  }
  expect(cancelRun).not.toHaveBeenCalled();

  // The open conversation only draws its own answer.
  expect((await screen.findAllByText(answerB)).length).toBeGreaterThan(0);
  expect(screen.queryByText(answerA)).not.toBeInTheDocument();

  await selectConversationFromSidebar(new RegExp(promptA));
  expect((await screen.findAllByText(answerA)).length).toBeGreaterThan(0);
  expect(screen.queryByText(answerB)).not.toBeInTheDocument();
});
