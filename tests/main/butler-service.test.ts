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

describe('ButlerServiceImpl replies', () => {
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
      'update_workspace',
      'get_today_plan',
      'write_note',
      'update_task',
      'get_memory'
    ]);
  });

  test('finds a focus task across workspaces when workspaceId is omitted', async () => {
    const client = new FakeModelClient(['这个任务先拆成两步。']);

    await makeService(client).send({ taskId: 't1', message: '这个任务怎么做？' });

    const system = systemPromptOf(client);
    expect(system).toContain('当前聚焦任务：极限刷题');
    expect(system).toContain('当前工作区：考研');
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
      { text: '需要先选择工作区才能写笔记。', usage: { inputTokens: 5, outputTokens: 3 } }
    ]);

    const result = await makeService(client, workspace).send({ message: '记一下' });

    expect(result.text).toBe('需要先选择工作区才能写笔记。');
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
