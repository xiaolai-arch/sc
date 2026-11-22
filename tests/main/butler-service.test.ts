import type {
  CreateNoteInput,
  CreateTaskInput,
  CreateWorkspaceInput,
  MemoryItem,
  Reminder,
  SubmitReviewInput,
  UpdateWorkspaceNoteInput,
  UpdateWorkspaceTaskInput,
  Workspace,
  WorkspaceNote,
  WorkspaceService,
  WorkspaceSnapshot,
  WorkspaceTask
} from '../../src/shared/workspace';
import { FakeModelClient } from '../../src/main/agent/model-client';
import type { Conversation, ConversationMessage } from '../../src/shared/conversations';
import type { ConversationStore } from '../../src/main/conversations/conversation-store';
import type { CreatePracticeSetInput, PracticeService, PracticeSet } from '../../src/shared/practice';
import type { SearchResult, SearchService } from '../../src/shared/search';
import {
  ButlerServiceImpl,
  type ButlerServiceOptions
} from '../../src/main/butler/butler-service';
import { createButlerService } from '../../src/main/butler/create-butler-service';

const NOW = new Date(2026, 9, 31, 9, 30, 0);

class MemoryWorkspaceService implements WorkspaceService {
  readonly workspaces: Workspace[] = [
    {
      id: 'ws-exam',
      name: '考研',
      kind: 'exam',
      color: '#ef4444',
      goal: '2027 上岸',
      description: '考研复习'
    }
  ];
  readonly tasks: WorkspaceTask[] = [
    {
      id: 't1',
      workspaceId: 'ws-exam',
      title: '极限刷题',
      subject: '数学',
      durationMin: 45,
      acceptance: '完成 10 题',
      status: 'pending'
    },
    {
      id: 't2',
      workspaceId: 'ws-exam',
      title: '背单词',
      subject: '英语',
      durationMin: 20,
      acceptance: '复习 50 词',
      status: 'done'
    }
  ];
  readonly notes: WorkspaceNote[] = [];
  readonly memory: MemoryItem[] = [
    { id: 'm1', workspaceId: 'ws-exam', text: '晚上效率更高', source: '复盘' }
  ];
  readonly reminders: Reminder[] = [];
  private noteCounter = 0;

  async listWorkspaces(): Promise<Workspace[]> {
    return this.workspaces;
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const workspace: Workspace = {
      id: `ws-${this.workspaces.length + 1}`,
      name: input.name,
      kind: input.kind,
      color: input.color ?? '#000000',
      goal: input.goal,
      description: input.description
    };
    this.workspaces.push(workspace);
    return workspace;
  }

  async getWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
    const workspace = this.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return {
      workspace,
      tasks: this.tasks.filter((task) => task.workspaceId === workspaceId),
      notes: this.notes.filter((note) => note.workspaceId === workspaceId),
      memory: this.memory.filter((item) => item.workspaceId === workspaceId),
      reminders: this.reminders
    };
  }

  async createTask(input: CreateTaskInput): Promise<WorkspaceTask> {
    const task: WorkspaceTask = {
      id: `t${this.tasks.length + 1}`,
      ...input,
      status: 'pending'
    };
    this.tasks.push(task);
    return task;
  }

  async updateWorkspaceTask(input: UpdateWorkspaceTaskInput): Promise<WorkspaceTask> {
    const task = this.tasks.find((candidate) => candidate.id === input.taskId);
    if (!task) {
      throw new Error(`Task not found: ${input.taskId}`);
    }
    if (input.status !== undefined) task.status = input.status;
    if (input.startAt !== undefined) {
      if (input.startAt === null) delete task.startAt;
      else task.startAt = input.startAt;
    }
    if (input.actualMin !== undefined) {
      task.actualMin = input.actualMin;
    }
    return task;
  }

  async createNote(input: CreateNoteInput): Promise<WorkspaceNote> {
    this.noteCounter += 1;
    const note: WorkspaceNote = {
      id: `n${this.noteCounter}`,
      workspaceId: input.workspaceId,
      title: input.title,
      subject: input.subject,
      tags: input.tags ?? [],
      updated: '2026-10-31',
      summary: input.summary ?? '',
      body: input.body,
      related: input.related ?? [],
      path: `notes/n${this.noteCounter}.md`
    };
    this.notes.push(note);
    return note;
  }

  async updateNote(input: UpdateWorkspaceNoteInput): Promise<WorkspaceNote> {
    const note = this.notes.find((candidate) => candidate.id === input.noteId);
    if (!note) {
      throw new Error(`Note not found: ${input.noteId}`);
    }
    if (input.title !== undefined) note.title = input.title;
    if (input.tags !== undefined) note.tags = input.tags;
    if (input.summary !== undefined) note.summary = input.summary;
    if (input.body !== undefined) note.body = input.body;
    if (input.related !== undefined) note.related = input.related;
    return note;
  }

  async getMemory(workspaceId?: string): Promise<MemoryItem[]> {
    return workspaceId
      ? this.memory.filter((item) => item.workspaceId === workspaceId)
      : this.memory;
  }

  async getReminders(): Promise<Reminder[]> {
    return this.reminders;
  }

  async submitReview(_input: SubmitReviewInput): Promise<void> {
    // no-op for the fake
  }
}

function makeService(
  modelClient: FakeModelClient | null,
  workspaceService: WorkspaceService | null = new MemoryWorkspaceService(),
  overrides: Partial<ButlerServiceOptions> = {}
): ButlerServiceImpl {
  return new ButlerServiceImpl({
    workspaceService,
    modelClient,
    now: () => NOW,
    modelRetry: { delayMs: 0 },
    ...overrides
  });
}

function systemPromptOf(client: FakeModelClient, callIndex = 0): string {
  const request = client.calls[callIndex];
  const system = request?.messages.find((message) => message.role === 'system');
  return system?.content ?? '';
}

function lastToolMessage(client: FakeModelClient, callIndex: number) {
  const request = client.calls[callIndex];
  return request?.messages.filter((message) => message.role === 'tool').at(-1);
}

function longConversation(count: number): Conversation {
  return {
    id: 'c1',
    title: '长对话',
    kind: 'chat',
    workspaceId: 'ws-exam',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    messages: Array.from({ length: count }, (_, index) => ({
      id: `m${index}`,
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `旧消息 ${index + 1}`,
      createdAt: NOW.toISOString()
    }))
  };
}

function fakeConversationStore(conversation: Conversation) {
  let stored = conversation;
  const store = {
    get: async () => structuredClone(conversation),
    update: async (
      _id: string,
      mutator: (current: Conversation) => Conversation
    ) => {
      stored = mutator(structuredClone(conversation));
      return structuredClone(stored);
    },
    appendMessage: vi.fn(async () => undefined),
    linkWorkspace: vi.fn(async () => undefined)
  } as unknown as ConversationStore;
  return { store, current: () => stored };
}

describe('ButlerServiceImpl replies', () => {
  test('summarizes older history and keeps using it instead of dropping it', async () => {
    const client = new FakeModelClient([
      {
        text: '用户在准备考研，极限是薄弱点。',
        usage: { inputTokens: 5, outputTokens: 3 }
      },
      { text: '继续。', usage: { inputTokens: 12, outputTokens: 8 } }
    ]);
    const { store, current } = fakeConversationStore(longConversation(26));
    const service = makeService(client, new MemoryWorkspaceService(), {
      conversationStore: store
    });

    const result = await service.send({ conversationId: 'c1', message: '接下来呢？' });

    expect(result.text).toBe('继续。');
    expect(result.usage).toEqual({ inputTokens: 17, outputTokens: 11 });

    expect(client.calls[0]?.tools).toBeUndefined();
    expect(client.calls[0]?.messages.some((message) => message.content.includes('摘要'))).toBe(
      true
    );

    const stored = current();
    expect(stored.summary).toContain('极限');
    expect(stored.summaryCount).toBeGreaterThan(0);

    const system = systemPromptOf(client, 1);
    expect(system).toContain('此前对话摘要');
    expect(system).toContain('极限');
    // The summarized prefix is no longer sent verbatim.
    expect(client.calls[1]?.messages.some((message) => message.content === '旧消息 1')).toBe(
      false
    );
  });

  test('does not summarize a short conversation', async () => {
    const client = new FakeModelClient(['好。']);
    const { store } = fakeConversationStore(longConversation(4));
    const service = makeService(client, new MemoryWorkspaceService(), {
      conversationStore: store
    });

    await service.send({ conversationId: 'c1', message: '继续？' });

    expect(client.calls).toHaveLength(1);
  });

  test('continues the turn when summarization fails', async () => {
    const client = new FakeModelClient([new Error('summary failed'), '继续。']);
    const { store, current } = fakeConversationStore(longConversation(26));
    const service = makeService(client, new MemoryWorkspaceService(), {
      conversationStore: store
    });

    const result = await service.send({ conversationId: 'c1', message: '接下来呢？' });

    expect(result.text).toBe('继续。');
    expect(current().summary).toBeUndefined();
    expect(systemPromptOf(client, 1)).not.toContain('此前对话摘要');
  });

  test('returns the fake model response and builds Chinese context', async () => {
    const client = new FakeModelClient([
      { text: '先把极限做完。', usage: { inputTokens: 12, outputTokens: 8 } }
    ]);

    const result = await makeService(client).send({
      workspaceId: 'ws-exam',
      taskId: 't1',
      message: '今天学什么？'
    });

    expect(result).toEqual({
      text: '先把极限做完。',
      usage: { inputTokens: 12, outputTokens: 8 }
    });
    expect(client.calls).toHaveLength(1);

    const system = systemPromptOf(client);
    expect(system).toContain('老师');
    expect(system).toContain('规划');
    expect(system).toContain('记录');
    expect(system).toContain('督促');
    expect(system).toContain('始终使用中文回答');
    expect(system).toContain('考研');
    expect(system).toContain('2027 上岸');
    expect(system).toContain('极限刷题');
    expect(system).toContain('晚上效率更高');

    const request = client.calls[0];
    expect(request?.messages.at(-1)).toEqual({ role: 'user', content: '今天学什么？' });
    expect(request?.tools?.map((tool) => tool.name)).toEqual([
      'create_workspace',
      'create_task',
      'set_reminder',
      'save_review',
      'plan_workspace',
      'create_long_plan',
      'update_workspace',
      'get_today_plan',
      'write_note',
      'update_task',
      'get_memory',
      'record_knowledge',
      'schedule_revisit',
      'record_commitment',
      'resolve_commitment',
      'set_week_availability',
      'save_profile',
      'create_practice_set',
      'get_practice_overview'
    ]);
  });

  test('forwards the conversation permissions to the model request', async () => {
    const client = new FakeModelClient(['好。']);
    const service = makeService(client);

    await service.send({
      message: '帮我查一下今年招生简章',
      permissions: { web: true, write: false, shell: false }
    });

    expect(client.calls[0]?.webTools).toBe(true);
    expect(client.calls[0]?.allowWrites).toBe(false);
    expect(client.calls[0]?.allowShell).toBe(false);
  });

  test('falls back to the permissions stored with the conversation', async () => {
    const client = new FakeModelClient(['好。']);
    const conversation: Conversation = {
      ...longConversation(2),
      permissions: { web: false, write: true, shell: true }
    };
    const { store } = fakeConversationStore(conversation);
    const service = makeService(client, new MemoryWorkspaceService(), {
      conversationStore: store
    });

    await service.send({ conversationId: 'c1', message: '继续。' });

    expect(client.calls[0]?.webTools).toBe(false);
    expect(client.calls[0]?.allowWrites).toBe(true);
    expect(client.calls[0]?.allowShell).toBe(true);
  });

  test('inlines text attachments and lets the caller drop image files after use', async () => {
    const client = new FakeModelClient(['看完了。']);
    const service = makeService(client);

    await service.send({
      message: '看看这份笔记',
      attachments: [
        {
          name: '笔记.md',
          mediaType: 'text/markdown',
          size: 12,
          kind: 'text',
          data: '# 极限\n用夹逼法'
        },
        {
          name: 'screen.png',
          mediaType: 'image/png',
          size: 3,
          kind: 'image',
          // 1x1 transparent PNG.
          data:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
        }
      ]
    });

    const request = client.calls[0];
    expect(request?.messages.at(-1)?.content).toContain('## 附件内容');
    expect(request?.messages.at(-1)?.content).toContain('用夹逼法');
    expect(request?.messages.at(-1)?.images).toHaveLength(1);
  });

  test('finds a focus task across workspaces when workspaceId is omitted', async () => {
    const client = new FakeModelClient(['这个任务先拆成两步。']);

    await makeService(client).send({ taskId: 't1', message: '这个任务怎么做？' });

    const system = systemPromptOf(client);
    expect(system).toContain('当前聚焦任务：极限刷题');
    expect(system).toContain('当前项目：考研');
  });

  test('returns a template reply when no API key is available', async () => {
    const result = await makeService(null).send({
      workspaceId: 'ws-exam',
      message: '今天学什么？'
    });

    expect(result.usage).toBeUndefined();
    expect(result.text).toContain('API Key');
    expect(result.text).toContain('考研');
    expect(result.text).toContain('极限刷题');
    expect(result.text).toContain('建议先做');
  });

  test('returns a generic template reply without workspace data', async () => {
    const service = new ButlerServiceImpl({ now: () => NOW });

    const result = await service.send({ message: '你好' });

    expect(result.text).toContain('API Key');
    expect(result.text).toContain('还没有看到今天的任务记录');
  });

  test('the factory maps a missing provider key to template mode', async () => {
    const service = createButlerService('/tmp/vault', {
      workspaceService: new MemoryWorkspaceService(),
      provider: { kind: 'anthropic', model: 'claude-sonnet-5-5' },
      apiKey: null,
      now: () => NOW
    });

    const result = await service.send({ workspaceId: 'ws-exam', message: '你好' });

    expect(result.text).toContain('API Key');
  });

  test('the factory accepts an injected fake model client', async () => {
    const client = new FakeModelClient(['你好，我是阿咲。']);
    const service = createButlerService('/tmp/vault', {
      workspaceService: new MemoryWorkspaceService(),
      modelClient: client,
      now: () => NOW
    });

    const result = await service.send({ workspaceId: 'ws-exam', message: '你好' });

    expect(result.text).toBe('你好，我是阿咲。');
    expect(client.calls).toHaveLength(1);
  });

  test('an empty message never calls the model', async () => {
    const client = new FakeModelClient(['should not be called']);

    const result = await makeService(client).send({ message: '   ' });

    expect(result.text).toContain('没有收到具体内容');
    expect(client.calls).toHaveLength(0);
  });

  test('feeds the references shown in the UI into the system prompt', async () => {
    const client = new FakeModelClient(['先把极限笔记复习一遍。']);
    const searchResult: SearchResult = {
      workspaceId: 'ws-exam',
      docId: 'n1',
      kind: 'note',
      title: '极限笔记',
      snippet: '等价无穷小替换',
      score: 1,
      path: 'workspaces/ws-exam/notes/n1.md'
    };
    const search = {
      search: vi.fn().mockResolvedValue([searchResult]),
      searchAll: vi.fn().mockResolvedValue([searchResult]),
      rebuild: vi.fn(),
      dispose: vi.fn()
    } as unknown as SearchService;

    await makeService(client, new MemoryWorkspaceService(), {
      getSearchService: () => search
    }).send({ workspaceId: 'ws-exam', message: '极限怎么复习？' });

    const system = systemPromptOf(client);
    expect(system).toContain('## 本次检索');
    expect(system).toContain('- [笔记] 极限笔记：等价无穷小替换');
  });

  test('a throwing search still answers without adding a prompt section', async () => {
    const client = new FakeModelClient(['先按计划复习。']);
    const search = {
      search: vi.fn().mockRejectedValue(new Error('index offline')),
      searchAll: vi.fn().mockRejectedValue(new Error('index offline')),
      rebuild: vi.fn(),
      dispose: vi.fn()
    } as unknown as SearchService;

    const result = await makeService(client, new MemoryWorkspaceService(), {
      getSearchService: () => search
    }).send({ workspaceId: 'ws-exam', message: '极限怎么复习？' });

    expect(result.text).toBe('先按计划复习。');
    expect(systemPromptOf(client)).not.toContain('## 本次检索');
  });
});

describe('ButlerServiceImpl tool calls', () => {
  test('executes get_today_plan and sums usage across steps', async () => {
    const client = new FakeModelClient([
      {
        text: '',
        usage: { inputTokens: 10, outputTokens: 2 },
        toolCalls: [
          { id: 'c1', name: 'get_today_plan', arguments: { workspaceId: 'ws-exam' } }
        ]
      },
      { text: '今天先做极限刷题。', usage: { inputTokens: 20, outputTokens: 5 } }
    ]);

    const result = await makeService(client).send({
      workspaceId: 'ws-exam',
      message: '今天做什么？'
    });

    expect(result).toEqual({
      text: '今天先做极限刷题。',
      usage: { inputTokens: 30, outputTokens: 7 }
    });
    expect(client.calls).toHaveLength(2);

    const assistantMessage = client.calls[1]?.messages.find(
      (message) => message.role === 'assistant' && message.toolCalls?.length
    );
    expect(assistantMessage?.toolCalls?.[0]?.id).toBe('c1');

    const toolMessage = lastToolMessage(client, 1);
    expect(toolMessage?.toolCallId).toBe('c1');
    const payload = JSON.parse(toolMessage?.content ?? '{}');
    expect(payload.ok).toBe(true);
    expect(payload.result.date).toBe('2026-10-31');
    expect(payload.result.tasks).toHaveLength(2);
    expect(payload.result.tasks[0]).toMatchObject({
      id: 't1',
      title: '极限刷题',
      status: 'pending'
    });
    expect(payload.result.counts).toEqual({
      total: 2,
      pending: 1,
      inProgress: 0,
      done: 1,
      skipped: 0
    });
  });

  test('persists the plan step with the minutes and their source', async () => {
    const client = new FakeModelClient([
      {
        text: '',
        usage: { inputTokens: 2, outputTokens: 1 },
        toolCalls: [{ id: 'c1', name: 'plan_workspace', arguments: {} }]
      },
      { text: '今天先做极限。', usage: { inputTokens: 3, outputTokens: 1 } }
    ]);
    const { store } = fakeConversationStore({
      id: 'c1',
      title: '计划',
      kind: 'chat',
      workspaceId: 'ws-exam',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      messages: []
    });
    const planner = {
      plan: async (input: { workspaceId: string; date?: string }) => ({
        workspaceId: input.workspaceId,
        date: input.date ?? '2026-10-31',
        generatedBy: 'agent' as const,
        availableMinutes: 45,
        availableMinutesSource: 'workspace' as const,
        tasks: [
          { title: '极限 10 题', subject: '数学', durationMin: 30, acceptance: '完成并订正' }
        ]
      })
    };

    await makeService(client, new MemoryWorkspaceService(), {
      conversationStore: store,
      planner
    }).send({ conversationId: 'c1', message: '排一下今天的计划' });

    const appendMessage = store.appendMessage as unknown as {
      mock: { calls: Array<[string, ConversationMessage]> };
    };
    const persisted = appendMessage.mock.calls.at(-1)?.[1];
    expect(persisted?.steps).toEqual([
      expect.objectContaining({
        name: 'plan_workspace',
        status: 'done',
        detail: '每天可用 45 分钟 · 来自项目设置'
      })
    ]);
  });

  test('an invalid plan result never gains a fabricated minutes label', async () => {
    const client = new FakeModelClient([
      {
        text: '',
        usage: { inputTokens: 2, outputTokens: 1 },
        toolCalls: [{ id: 'c1', name: 'plan_workspace', arguments: {} }]
      },
      { text: '今天先做极限。', usage: { inputTokens: 3, outputTokens: 1 } }
    ]);
    const { store } = fakeConversationStore({
      id: 'c1',
      title: '计划',
      kind: 'chat',
      workspaceId: 'ws-exam',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      messages: []
    });
    const planner = {
      plan: async (input: { workspaceId: string; date?: string }) => ({
        workspaceId: input.workspaceId,
        date: input.date ?? '2026-10-31',
        generatedBy: 'template' as const,
        tasks: [
          { title: '极限 10 题', subject: '数学', durationMin: 30, acceptance: '完成并订正' }
        ]
      })
    };

    await makeService(client, new MemoryWorkspaceService(), {
      conversationStore: store,
      planner
    }).send({ conversationId: 'c1', message: '排一下今天的计划' });

    const appendMessage = store.appendMessage as unknown as {
      mock: { calls: Array<[string, ConversationMessage]> };
    };
    const persisted = appendMessage.mock.calls.at(-1)?.[1];
    expect(persisted?.steps?.[0]).not.toHaveProperty('detail');
  });

  test('write_note defaults to the selected workspace and derives the subject', async () => {
    const workspace = new MemoryWorkspaceService();
    const client = new FakeModelClient([
      {
        text: '',
        usage: { inputTokens: 4, outputTokens: 1 },
        toolCalls: [
          {
            id: 'c1',
            name: 'write_note',
            arguments: { title: '极限笔记', body: '等价无穷小替换', tags: ['数学'] }
          }
        ]
      },
      { text: '已经记下来了。', usage: { inputTokens: 5, outputTokens: 3 } }
    ]);

    const result = await makeService(client, workspace).send({
      workspaceId: 'ws-exam',
      message: '记一下等价无穷小'
    });

    expect(result.text).toBe('已经记下来了。');
    expect(workspace.notes).toHaveLength(1);
    expect(workspace.notes[0]).toMatchObject({
      workspaceId: 'ws-exam',
      title: '极限笔记',
      subject: '考研',
      tags: ['数学'],
      body: '等价无穷小替换'
    });
    const payload = JSON.parse(lastToolMessage(client, 1)?.content ?? '{}');
    expect(payload).toEqual({
      ok: true,
      result: { noteId: 'n1', workspaceId: 'ws-exam', title: '极限笔记', path: 'notes/n1.md' }
    });
  });

  test('update_task applies status and actual minutes', async () => {
    const workspace = new MemoryWorkspaceService();
    const client = new FakeModelClient([
      {
        text: '',
        usage: { inputTokens: 4, outputTokens: 1 },
        toolCalls: [
          {
            id: 'c1',
            name: 'update_task',
            arguments: { taskId: 't1', status: 'done', actualMin: 40 }
          }
        ]
      },
      { text: '已经标记完成。', usage: { inputTokens: 5, outputTokens: 3 } }
    ]);

    await makeService(client, workspace).send({
      workspaceId: 'ws-exam',
      message: '极限做完了'
    });

    expect(workspace.tasks.find((task) => task.id === 't1')).toMatchObject({
      status: 'done',
      actualMin: 40
    });
  });

  test('get_memory filters by the selected workspace', async () => {
    const client = new FakeModelClient([
      {
        text: '',
        usage: { inputTokens: 4, outputTokens: 1 },
        toolCalls: [{ id: 'c1', name: 'get_memory', arguments: {} }]
      },
      { text: '你晚上效率更高。', usage: { inputTokens: 5, outputTokens: 3 } }
    ]);

    await makeService(client).send({ workspaceId: 'ws-exam', message: '你记得我什么？' });

    const payload = JSON.parse(lastToolMessage(client, 1)?.content ?? '{}');
    expect(payload.ok).toBe(true);
    expect(payload.result.workspaceId).toBe('ws-exam');
    expect(payload.result.count).toBe(1);
    expect(payload.result.items[0].text).toBe('晚上效率更高');
  });

  test('write_note without a workspace returns a tool error to the model', async () => {
    const workspace = new MemoryWorkspaceService();
    const client = new FakeModelClient([
      {
        text: '',
        usage: { inputTokens: 4, outputTokens: 1 },
        toolCalls: [
          {
            id: 'c1',
            name: 'write_note',
            arguments: { title: '想法', body: '先记下来' }
          }
        ]
      },
      { text: '需要先选择项目才能写笔记。', usage: { inputTokens: 5, outputTokens: 3 } }
    ]);

    const result = await makeService(client, workspace).send({ message: '记一下' });

    expect(result.text).toBe('需要先选择项目才能写笔记。');
    const payload = JSON.parse(lastToolMessage(client, 1)?.content ?? '{}');
    expect(payload).toMatchObject({ ok: false, tool: 'write_note' });
    expect(payload.error).toContain('workspaceId');
    expect(workspace.notes).toHaveLength(0);
  });
});

describe('ButlerServiceImpl failure degradation', () => {
  test('a failing tool becomes a tool result and the final text still returns', async () => {
    const workspace = new MemoryWorkspaceService();
    vi.spyOn(workspace, 'createNote').mockRejectedValueOnce(new Error('disk full'));
    const client = new FakeModelClient([
      {
        text: '',
        usage: { inputTokens: 4, outputTokens: 1 },
        toolCalls: [
          { id: 'c1', name: 'write_note', arguments: { title: 'x', body: 'y' } }
        ]
      },
      { text: '记录没有写成，你可以先手动记一下。', usage: { inputTokens: 5, outputTokens: 3 } }
    ]);

    const result = await makeService(client, workspace).send({
      workspaceId: 'ws-exam',
      message: '记一下'
    });

    expect(result.text).toBe('记录没有写成，你可以先手动记一下。');
    const payload = JSON.parse(lastToolMessage(client, 1)?.content ?? '{}');
    expect(payload).toMatchObject({ ok: false, tool: 'write_note', error: 'disk full' });
  });

  test('a model failure after a tool failure falls back to text, not a throw', async () => {
    const workspace = new MemoryWorkspaceService();
    vi.spyOn(workspace, 'getMemory').mockRejectedValueOnce(new Error('read failed'));
    const client = new FakeModelClient([
      {
        text: '',
        usage: { inputTokens: 5, outputTokens: 1 },
        toolCalls: [{ id: 'c1', name: 'get_memory', arguments: {} }]
      },
      new Error('provider down')
    ]);

    const result = await makeService(client, workspace).send({
      workspaceId: 'ws-exam',
      message: '你记得什么？'
    });

    expect(result.text).toContain('get_memory');
    expect(result.text).toContain('没有成功');
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 1 });
  });

  test('a model failure on the first call returns a template reply', async () => {
    const client = new FakeModelClient([new Error('provider down')]);

    const result = await makeService(client).send({
      workspaceId: 'ws-exam',
      message: '你好'
    });

    expect(result.text).toContain('已自动重试 1 次');
    expect(result.text).toContain('考研');
    expect(result.usage).toBeUndefined();
  });

  test('unreadable selected workspace context does not block a model reply', async () => {
    const workspace = new MemoryWorkspaceService();
    vi.spyOn(workspace, 'getWorkspaceSnapshot').mockRejectedValueOnce(
      new Error('vault offline')
    );
    const client = new FakeModelClient(['我仍然可以回答。']);

    const result = await makeService(client, workspace).send({
      workspaceId: 'ws-exam',
      message: '你好'
    });

    expect(result.text).toBe('我仍然可以回答。');
    expect(systemPromptOf(client)).toContain('读取本地记录不完整');
  });

  test('unreadable workspace list does not block a model reply', async () => {
    const workspace = new MemoryWorkspaceService();
    vi.spyOn(workspace, 'listWorkspaces').mockRejectedValueOnce(new Error('vault offline'));
    const client = new FakeModelClient(['我仍然可以回答。']);

    const result = await makeService(client, workspace).send({ message: '你好' });

    expect(result.text).toBe('我仍然可以回答。');
    expect(systemPromptOf(client)).toContain('读取本地记录不完整');
  });

  test('an unknown tool is reported back without throwing', async () => {
    const client = new FakeModelClient([
      {
        text: '',
        usage: { inputTokens: 4, outputTokens: 1 },
        toolCalls: [{ id: 'c1', name: 'delete_everything', arguments: {} }]
      },
      { text: '这个操作不可用。', usage: { inputTokens: 5, outputTokens: 2 } }
    ]);

    const result = await makeService(client).send({
      workspaceId: 'ws-exam',
      message: '删掉所有东西'
    });

    expect(result.text).toBe('这个操作不可用。');
    const payload = JSON.parse(lastToolMessage(client, 1)?.content ?? '{}');
    expect(payload).toMatchObject({ ok: false, tool: 'delete_everything' });
    expect(payload.error).toContain('未知工具');
  });

  test('stops after the tool-step limit instead of looping forever', async () => {
    const client = new FakeModelClient([
      {
        text: '',
        usage: { inputTokens: 1, outputTokens: 1 },
        toolCalls: [{ id: 'c1', name: 'get_today_plan', arguments: {} }]
      },
      {
        text: '',
        usage: { inputTokens: 1, outputTokens: 1 },
        toolCalls: [{ id: 'c2', name: 'get_today_plan', arguments: {} }]
      }
    ]);

    const result = await makeService(client, new MemoryWorkspaceService(), {
      maxToolSteps: 1
    }).send({ workspaceId: 'ws-exam', message: '计划？' });

    expect(result.text).toContain('多次工具');
    expect(result.usage).toEqual({ inputTokens: 2, outputTokens: 2 });
    expect(client.calls).toHaveLength(2);
  });

  test('tools fail cleanly when no workspace service is connected', async () => {
    const client = new FakeModelClient([
      {
        text: '',
        usage: { inputTokens: 4, outputTokens: 1 },
        toolCalls: [{ id: 'c1', name: 'get_today_plan', arguments: {} }]
      },
      { text: '本地数据还没有连接。', usage: { inputTokens: 5, outputTokens: 2 } }
    ]);

    const result = await makeService(client, null).send({ message: '今天做什么？' });

    expect(result.text).toBe('本地数据还没有连接。');
    const payload = JSON.parse(lastToolMessage(client, 1)?.content ?? '{}');
    expect(payload).toMatchObject({ ok: false, tool: 'get_today_plan' });
    expect(payload.error).toContain('未连接');
  });
});

test('passes the workspace directory as cwd to the model client', async () => {
  const { mkdtemp, mkdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'butler-cwd-'));
  const workspaceDir = join(root, 'workspaces', 'ws-exam');
  await mkdir(workspaceDir, { recursive: true });
  const model = new FakeModelClient(['好的']);
  const service = new ButlerServiceImpl({
    workspaceService: new MemoryWorkspaceService(),
    workspaceRoot: root,
    modelClient: model,
    now: () => NOW
  });

  try {
    await service.send({ workspaceId: 'ws-exam', message: '你好' });
    expect(model.calls[0]?.cwd).toBe(workspaceDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('routes create_practice_set tool calls to the injected practice service', async () => {
  const client = new FakeModelClient([
    {
      text: '',
      usage: { inputTokens: 6, outputTokens: 3 },
      toolCalls: [
        {
          id: 'c1',
          name: 'create_practice_set',
          arguments: {
            title: '极限小测',
            subject: '数学',
            questions: [
              { prompt: 'lim(x→0) sin(x)/x = ?', options: ['0', '1'], answer: 1 },
              { prompt: 'x→0 时 x 与 tan(x) 等价吗？', options: ['等价', '不等价'], answer: 0 },
              { prompt: '夹逼准则需要几边夹住？', options: ['一边', '两边'], answer: 1 }
            ]
          }
        }
      ]
    },
    { text: '已出好 3 道题，去学习页作答。', usage: { inputTokens: 9, outputTokens: 5 } }
  ]);
  const createSet = vi.fn(async (input: CreatePracticeSetInput): Promise<PracticeSet> => ({
    id: 'set-9',
    workspaceId: input.workspaceId,
    title: input.title,
    subject: input.subject ?? '',
    questions: input.questions.map((question, index) => ({
      id: `q-${index + 1}`,
      prompt: question.prompt,
      options: question.options ?? [],
      answer: question.answer ?? 0,
      explanation: question.explanation ?? ''
    })),
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString()
  }));
  const service = makeService(client, new MemoryWorkspaceService(), {
    practiceService: { createSet } as unknown as PracticeService
  });

  const result = await service.send({ workspaceId: 'ws-exam', message: '考考我极限' });

  expect(result.text).toBe('已出好 3 道题，去学习页作答。');
  expect(createSet).toHaveBeenCalledWith(
    expect.objectContaining({ workspaceId: 'ws-exam', title: '极限小测', subject: '数学' })
  );
  const toolMessage = lastToolMessage(client, 1);
  expect(toolMessage?.toolCallId).toBe('c1');
  const payload = JSON.parse(toolMessage?.content ?? '{}');
  expect(payload.ok).toBe(true);
  expect(payload.result.setId).toBe('set-9');
  expect(payload.result.message).toBe(
    '已出题：极限小测（3 题，考研）· 去学习页作答，错题会自动进错题本'
  );
});
