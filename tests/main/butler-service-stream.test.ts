import type {
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  StreamingModelClient
} from '../../src/main/agent/model-client';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { ButlerServiceImpl } from '../../src/main/butler/butler-service';
import type { ButlerStreamEvent } from '../../src/shared/butler-stream';
import type {
  Workspace,
  WorkspaceService,
  WorkspaceSnapshot
} from '../../src/shared/workspace';

const NOW = new Date(2026, 10, 1, 9, 30, 0);

class ScriptedStreamingClient implements StreamingModelClient {
  readonly calls: ModelRequest[] = [];

  constructor(
    private readonly script: Array<{
      events: ModelStreamEvent[];
      response: ModelResponse;
    }>
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

class ThrowingStreamingClient implements StreamingModelClient {
  async complete(): Promise<ModelResponse> {
    throw new Error('complete should not be called');
  }

  async stream(): Promise<ModelResponse> {
    throw new Error('model exploded');
  }
}

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

const workspaceService = {
  listWorkspaces: async () => [workspace],
  getWorkspaceSnapshot: async () => snapshot,
  getMemory: async () => [],
  createNote: async (input: { title: string; body: string }) => ({
    id: 'n1',
    workspaceId: 'ws-exam',
    title: input.title,
    subject: '考研',
    tags: [],
    updated: '2026-11-01',
    summary: '',
    body: input.body,
    related: []
  }),
  updateWorkspaceTask: async (input: { taskId: string; status: string }) => ({
    id: input.taskId,
    workspaceId: 'ws-exam',
    title: '任务',
    subject: '数学',
    durationMin: 30,
    acceptance: '完成',
    status: input.status
  })
} as unknown as WorkspaceService;

function service(client: StreamingModelClient | FakeModelClient, maxToolSteps = 4) {
  return new ButlerServiceImpl({
    workspaceService,
    modelClient: client,
    now: () => NOW,
    maxToolSteps
  });
}

function input(message: string) {
  return { workspaceId: 'ws-exam', message };
}

test('streams reasoning, narration, tool steps and the final answer', async () => {
  const client = new ScriptedStreamingClient([
    {
      events: [{ type: 'reasoning', text: '先想' }],
      response: {
        text: '我先记一下',
        usage: { inputTokens: 5, outputTokens: 2 },
        toolCalls: [
          {
            id: 'c1',
            name: 'write_note',
            arguments: { title: '极限', body: '等价无穷小' }
          }
        ]
      }
    },
    {
      events: [
        { type: 'reasoning', text: '再想' },
        { type: 'text', text: '记好了' }
      ],
      response: { text: '记好了', usage: { inputTokens: 3, outputTokens: 4 } }
    }
  ]);

  const events: ButlerStreamEvent[] = [];
  const result = await service(client).stream(input('记一下极限'), (event) =>
    events.push(event)
  );

  expect(events.map((event) => event.type)).toEqual([
    'reasoning',
    'narration',
    'tool-start',
    'tool-result',
    'reasoning',
    'text',
    'done'
  ]);
  expect(events[1]).toEqual({ type: 'narration', text: '我先记一下' });
  expect(events[2]).toMatchObject({ type: 'tool-start', name: 'write_note', label: '写入笔记' });
  expect(events[3]).toMatchObject({ type: 'tool-result', name: 'write_note', ok: true });
  expect(events.at(-1)).toEqual({
    type: 'done',
    text: '记好了',
    usage: { inputTokens: 8, outputTokens: 6 }
  });
  expect(result.text).toBe('记好了');
  expect(result.usage).toEqual({ inputTokens: 8, outputTokens: 6 });
});

test('falls back to complete for non-streaming clients', async () => {
  const events: ButlerStreamEvent[] = [];
  const result = await service(new FakeModelClient(['模板回答'])).stream(
    input('你好'),
    (event) => events.push(event)
  );

  expect(events).toEqual([
    { type: 'text', text: '模板回答' },
    {
      type: 'done',
      text: '模板回答',
      usage: { inputTokens: 0, outputTokens: 0 }
    }
  ]);
  expect(result.text).toBe('模板回答');
});

test('emits an error and a template done when the model throws', async () => {
  const events: ButlerStreamEvent[] = [];
  const result = await service(new ThrowingStreamingClient()).stream(
    input('你好'),
    (event) => events.push(event)
  );

  expect(events.some((event) => event.type === 'error')).toBe(true);
  const done = events.find((event) => event.type === 'done');
  expect(done?.type).toBe('done');
  if (done?.type === 'done') {
    expect(done.text.length).toBeGreaterThan(0);
    expect(done.text).not.toBe('model exploded');
  }
  expect(result.text).not.toBe('model exploded');
});

test('continues after a failed tool call', async () => {
  const client = new ScriptedStreamingClient([
    {
      events: [],
      response: {
        text: '',
        usage: { inputTokens: 1, outputTokens: 1 },
        toolCalls: [{ id: 'c1', name: 'no_such_tool', arguments: {} }]
      }
    },
    {
      events: [{ type: 'text', text: '完成了' }],
      response: { text: '完成了', usage: { inputTokens: 1, outputTokens: 1 } }
    }
  ]);

  const events: ButlerStreamEvent[] = [];
  const result = await service(client).stream(input('试试'), (event) => events.push(event));

  const toolResult = events.find((event) => event.type === 'tool-result');
  expect(toolResult).toMatchObject({ type: 'tool-result', ok: false });
  if (toolResult?.type === 'tool-result') {
    expect(toolResult.detail).toMatch(/未知工具/);
  }
  expect(result.text).toBe('完成了');
});

test('stops at maxToolSteps with a template reply', async () => {
  const toolCall = {
    id: 'c1',
    name: 'write_note',
    arguments: { title: 't', body: 'b' }
  };
  const client = new ScriptedStreamingClient([
    {
      events: [],
      response: {
        text: '',
        usage: { inputTokens: 0, outputTokens: 0 },
        toolCalls: [toolCall]
      }
    },
    {
      events: [{ type: 'text', text: '第二轮' }],
      response: {
        text: '第二轮',
        usage: { inputTokens: 0, outputTokens: 0 },
        toolCalls: [{ ...toolCall, id: 'c2' }]
      }
    }
  ]);

  const events: ButlerStreamEvent[] = [];
  const result = await service(client, 1).stream(input('继续'), (event) =>
    events.push(event)
  );

  expect(result.text).not.toBe('第二轮');
  expect(events.at(-1)?.type).toBe('done');
});
