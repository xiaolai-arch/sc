import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  StreamingModelClient
} from '../../src/main/agent/model-client';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { ButlerServiceImpl } from '../../src/main/butler/butler-service';
import { ConversationStore } from '../../src/main/conversations/conversation-store';
import type { ButlerStreamEvent } from '../../src/shared/butler-stream';
import type { ConversationMessage } from '../../src/shared/conversations';
import type {
  Workspace,
  WorkspaceService,
  WorkspaceSnapshot
} from '../../src/shared/workspace';

const NOW = new Date('2026-11-01T09:00:00.000Z');

const workspace: Workspace = {
  id: 'ws-exam',
  name: '考研',
  kind: 'exam',
  color: '#ef4444',
  goal: '2027 上岸',
  description: '考研复习'
};

const snapshot: WorkspaceSnapshot = {
  workspace,
  tasks: [],
  notes: [],
  memory: [],
  reminders: []
};

function message(
  id: string,
  role: 'user' | 'assistant',
  text: string
): ConversationMessage {
  return { id, role, text, createdAt: NOW.toISOString() };
}

function fakeWorkspaceService() {
  const created: unknown[] = [];
  const tasks: unknown[] = [];
  const service = {
    listWorkspaces: async () => [workspace],
    getWorkspaceSnapshot: async (id: string) => {
      if (id !== 'ws-exam') throw new Error(`unknown workspace ${id}`);
      return snapshot;
    },
    getMemory: async () => [],
    createWorkspace: async (input: {
      name: string;
      kind: Workspace['kind'];
      goal: string;
      description: string;
    }) => {
      created.push(input);
      return {
        id: 'ws-new',
        name: input.name,
        kind: input.kind,
        color: '#0071e3',
        goal: input.goal,
        description: input.description
      };
    },
    createTask: async (input: {
      workspaceId: string;
      title: string;
      subject: string;
      durationMin: number;
      acceptance: string;
    }) => {
      tasks.push(input);
      return {
        id: 't1',
        ...input,
        status: 'pending'
      };
    },
    createNote: async () => {
      throw new Error('not used');
    },
    updateWorkspaceTask: async () => {
      throw new Error('not used');
    },
    getReminders: async () => [],
    submitReview: async () => undefined
  } as unknown as WorkspaceService;
  return { service, created, tasks };
}

class ScriptedStreamingClient implements StreamingModelClient {
  readonly calls: ModelRequest[] = [];
  constructor(
    private readonly script: Array<{ events: ModelStreamEvent[]; response: ModelResponse }>
  ) {}

  async complete(): Promise<ModelResponse> {
    throw new Error('complete should not be called');
  }

  async stream(
    request: ModelRequest,
    onEvent: (event: ModelStreamEvent) => void
  ): Promise<ModelResponse> {
    this.calls.push(request);
    const next = this.script.shift();
    if (!next) throw new Error('no scripted round');
    for (const event of next.events) onEvent(event);
    return next.response;
  }
}

async function storeInTemp(): Promise<{ dir: string; store: ConversationStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-butler-conversation-'));
  return { dir, store: new ConversationStore(dir, { now: () => NOW }) };
}

test('loads history and uses the conversation workspace over the send workspace', async () => {
  const { dir, store } = await storeInTemp();
  try {
    const conversation = await store.create({ workspaceId: 'ws-exam' });
    await store.appendMessage(conversation.id, message('u1', 'user', '上一轮问题'));
    await store.appendMessage(conversation.id, message('a1', 'assistant', '上一轮回答'));
    await store.appendMessage(conversation.id, message('u2', 'user', '你好'));

    const { service } = fakeWorkspaceService();
    const client = new FakeModelClient(['你好，我是阿咲。']);
    const butler = new ButlerServiceImpl({
      workspaceService: service,
      modelClient: client,
      conversationStore: store,
      now: () => NOW
    });

    const result = await butler.send({
      conversationId: conversation.id,
      assistantMessageId: 'a2',
      workspaceId: 'other',
      message: '你好'
    });

    expect(client.calls[0]?.messages[0]?.content).toContain('当前工作区：考研');
    expect(
      client.calls[0]?.messages.slice(1).map((entry) => ({
        role: entry.role,
        content: entry.content
      }))
    ).toEqual([
      { role: 'user', content: '上一轮问题' },
      { role: 'assistant', content: '上一轮回答' },
      { role: 'user', content: '你好' }
    ]);

    const stored = await store.get(conversation.id);
    expect(stored?.messages.map((entry) => entry.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(stored?.messages[3]).toMatchObject({
      role: 'assistant',
      text: '你好，我是阿咲。',
      source: 'butler'
    });
    expect(result.conversationId).toBe(conversation.id);
    expect(result.text).toBe('你好，我是阿咲。');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('creates a workspace from a tool call and links the conversation', async () => {
  const { dir, store } = await storeInTemp();
  try {
    const conversation = await store.create();
    await store.appendMessage(conversation.id, message('u1', 'user', '我想学英语'));

    const { service, created } = fakeWorkspaceService();
    const client = new FakeModelClient([
      {
        text: '',
        usage: { inputTokens: 1, outputTokens: 1 },
        toolCalls: [
          {
            id: 'c1',
            name: 'create_workspace',
            arguments: {
              name: '英语',
              kind: 'study',
              goal: '每天读外刊'
            }
          }
        ]
      },
      '项目已创建。'
    ]);
    const butler = new ButlerServiceImpl({
      workspaceService: service,
      modelClient: client,
      conversationStore: store,
      now: () => NOW
    });

    const result = await butler.send({
      conversationId: conversation.id,
      assistantMessageId: 'a2',
      message: '我想学英语'
    });

    expect(created).toEqual([
      {
        name: '英语',
        kind: 'study',
        goal: '每天读外刊',
        description: ''
      }
    ]);
    const stored = await store.get(conversation.id);
    expect(stored?.workspaceId).toBe('ws-new');
    expect(stored?.messages.at(-1)).toMatchObject({
      id: 'a2',
      text: '项目已创建。',
      steps: [{ name: 'create_workspace', label: '创建项目', status: 'done' }]
    });
    expect(result.text).toBe('项目已创建。');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('caps model history to the recent window', async () => {
  const { dir, store } = await storeInTemp();
  try {
    const conversation = await store.create({ workspaceId: 'ws-exam' });
    for (let index = 0; index < 25; index += 1) {
      await store.appendMessage(
        conversation.id,
        message(`u${index}`, 'user', `消息 ${index}`)
      );
    }
    const { service } = fakeWorkspaceService();
    const client = new FakeModelClient(['收到。']);
    const butler = new ButlerServiceImpl({
      workspaceService: service,
      modelClient: client,
      conversationStore: store,
      now: () => NOW
    });

    await butler.send({
      conversationId: conversation.id,
      assistantMessageId: 'a-last',
      message: '最后一条'
    });

    expect(client.calls[0]?.messages.length).toBeLessThanOrEqual(22);
    expect(client.calls[0]?.messages[1]?.content).toBe('消息 5');
    expect(client.calls[0]?.messages.at(-1)).toEqual({
      role: 'user',
      content: '最后一条'
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stream persists the assistant reply with the renderer id', async () => {
  const { dir, store } = await storeInTemp();
  try {
    const conversation = await store.create({ workspaceId: 'ws-exam' });
    await store.appendMessage(conversation.id, message('u1', 'user', '你好'));

    const { service } = fakeWorkspaceService();
    const client = new ScriptedStreamingClient([
      {
        events: [{ type: 'text', text: '你好呀' }],
        response: { text: '你好呀', usage: { inputTokens: 2, outputTokens: 3 } }
      }
    ]);
    const butler = new ButlerServiceImpl({
      workspaceService: service,
      modelClient: client,
      conversationStore: store,
      now: () => NOW
    });

    const events: ButlerStreamEvent[] = [];
    const result = await butler.stream(
      {
        conversationId: conversation.id,
        assistantMessageId: 'a2',
        message: '你好'
      },
      (event) => events.push(event)
    );

    expect(events.map((event) => event.type)).toEqual(['text', 'done']);
    expect(result.conversationId).toBe(conversation.id);
    const stored = await store.get(conversation.id);
    expect(stored?.messages.at(-1)).toMatchObject({
      id: 'a2',
      role: 'assistant',
      text: '你好呀',
      source: 'butler'
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

class HangingStreamingClient implements StreamingModelClient {
  async complete(): Promise<ModelResponse> {
    throw new Error('complete should not be called');
  }

  async stream(
    request: ModelRequest,
    onEvent: (event: ModelStreamEvent) => void
  ): Promise<ModelResponse> {
    onEvent({ type: 'text', text: '部分回答' });
    await new Promise<void>((_resolve, reject) => {
      request.signal?.addEventListener(
        'abort',
        () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        },
        { once: true }
      );
    });
    throw new Error('unreachable');
  }
}

test('aborting a stream persists the partial reply and emits a canceled done', async () => {
  const { dir, store } = await storeInTemp();
  try {
    const conversation = await store.create({ workspaceId: 'ws-exam' });
    await store.appendMessage(conversation.id, message('u1', 'user', '你好'));
    const { service } = fakeWorkspaceService();
    const butler = new ButlerServiceImpl({
      workspaceService: service,
      modelClient: new HangingStreamingClient(),
      conversationStore: store,
      now: () => NOW
    });
    const controller = new AbortController();
    const events: ButlerStreamEvent[] = [];
    let textSeen: (() => void) | undefined;
    const seen = new Promise<void>((resolve) => {
      textSeen = resolve;
    });

    const promise = butler.stream(
      {
        conversationId: conversation.id,
        assistantMessageId: 'a2',
        message: '你好'
      },
      (event) => {
        events.push(event);
        if (event.type === 'text') textSeen?.();
      },
      { signal: controller.signal }
    );

    await seen;
    controller.abort();
    const result = await promise;

    expect(events.at(-1)).toMatchObject({
      type: 'done',
      text: '部分回答',
      canceled: true
    });
    expect(result.text).toBe('部分回答');
    const stored = await store.get(conversation.id);
    expect(stored?.messages.at(-1)).toMatchObject({
      id: 'a2',
      role: 'assistant',
      text: '部分回答'
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
