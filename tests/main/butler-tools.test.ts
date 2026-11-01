import { createButlerTools, executeButlerTool } from '../../src/main/butler/tools';
import type { KnowledgeService } from '../../src/shared/knowledge';
import type { WorkspaceService } from '../../src/shared/workspace';

function knowledgeStub(overrides: Partial<KnowledgeService> = {}): KnowledgeService {
  return {
    list: async () => [],
    get: async () => null,
    create: async () => {
      throw new Error('unused');
    },
    update: async () => {
      throw new Error('unused');
    },
    delete: async () => undefined,
    record: async () => {
      throw new Error('unused');
    },
    linkTask: async () => undefined,
    linkNote: async () => undefined,
    linkReview: async () => undefined,
    ...overrides
  };
}

const workspaceService = {
  listWorkspaces: async () => [],
  getWorkspaceSnapshot: async () => {
    throw new Error('not used');
  },
  createWorkspace: async (input: {
    name: string;
    kind: string;
    goal: string;
    description: string;
  }) => ({
    id: 'ws-new',
    name: input.name,
    kind: input.kind,
    color: '#0071e3',
    goal: input.goal,
    description: input.description
  }),
  createTask: async (input: {
    workspaceId: string;
    title: string;
    subject: string;
    durationMin: number;
    acceptance: string;
  }) => ({
    id: 'task-1',
    ...input,
    status: 'pending'
  }),
  createReminder: async (input: { time: string; label: string; enabled?: boolean }) => ({
    id: 'rem-1',
    time: input.time,
    label: input.label,
    enabled: input.enabled ?? true
  }),
  updateWorkspaceTask: async () => {
    throw new Error('not used');
  },
  updateWorkspace: async (input: {
    workspaceId: string;
    name?: string;
    goal?: string;
    description?: string;
  }) => ({
    id: input.workspaceId,
    name: input.name ?? '考研',
    kind: 'exam',
    color: '#ef4444',
    goal: input.goal ?? '2027 上岸',
    description: input.description ?? ''
  }),
  createNote: async () => {
    throw new Error('not used');
  },
  updateNote: async () => {
    throw new Error('not used');
  },
  getMemory: async () => [],
  getReminders: async () => [],
  submitReview: async () => undefined
} as unknown as WorkspaceService;

const tools = createButlerTools();
const context = { workspace: workspaceService, workspaceId: 'ws-exam', now: () => new Date() };

test('record_knowledge creates or appends a topic through the service', async () => {
  const record = vi.fn(async (input: { name: string; status?: string; note?: string }) => ({
    id: 'kt-1',
    name: input.name,
    aliases: [],
    status: input.status ?? 'learning',
    summary: input.note ?? '',
    evidence: [],
    createdAt: '',
    updatedAt: ''
  }));
  const result = await executeButlerTool(
    {
      id: '1',
      name: 'record_knowledge',
      arguments: { name: 'LangGraph', status: 'mastered', note: '今天学了状态图' }
    },
    tools,
    {
      workspace: workspaceService,
      knowledge: knowledgeStub({ record: record as unknown as KnowledgeService['record'] }),
      now: () => new Date('2026-11-02T09:00:00.000Z')
    }
  );

  expect(record).toHaveBeenCalledWith({
    name: 'LangGraph',
    status: 'mastered',
    note: '今天学了状态图'
  });
  expect(result.content).toContain('已记录');
});

test('links completed tasks, notes and reviews into the knowledge base', async () => {
  const linkTask = vi.fn(async () => undefined);
  const linkNote = vi.fn(async () => undefined);
  const linkReview = vi.fn(async () => undefined);
  const workspace = {
    ...workspaceService,
    updateWorkspaceTask: async (input: { taskId: string; status?: string }) => ({
      id: input.taskId,
      workspaceId: 'ws-exam',
      title: 'LangChain 练习',
      subject: '',
      durationMin: 10,
      acceptance: '',
      status: input.status ?? 'pending'
    }),
    createNote: async (input: { title: string; body: string }) => ({
      id: 'n1',
      workspaceId: 'ws-exam',
      title: input.title,
      subject: '',
      tags: [],
      updated: '',
      summary: '',
      body: input.body,
      related: []
    })
  } as unknown as WorkspaceService;
  const toolContext = {
    workspace,
    workspaceId: 'ws-exam',
    knowledge: knowledgeStub({ linkTask, linkNote, linkReview }),
    now: () => new Date('2026-11-02T09:00:00.000Z')
  };

  await executeButlerTool(
    { id: '1', name: 'update_task', arguments: { taskId: 't1', status: 'done' } },
    tools,
    toolContext
  );
  expect(linkTask).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', status: 'done' }));

  await executeButlerTool(
    { id: '2', name: 'write_note', arguments: { title: '向量数据库', body: '正文' } },
    tools,
    toolContext
  );
  expect(linkNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }));

  await executeButlerTool(
    { id: '3', name: 'save_review', arguments: { completed: '学了向量数据库' } },
    tools,
    toolContext
  );
  expect(linkReview).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-exam' }));
});

test('creates a workspace through a tool call', async () => {
  const result = await executeButlerTool(
    {
      id: 'c1',
      name: 'create_workspace',
      arguments: { name: '英语', kind: 'study', goal: '每天读外刊' }
    },
    tools,
    context
  );
  expect(result.ok).toBe(true);
  expect(JSON.parse(result.content)).toMatchObject({
    ok: true,
    result: { workspaceId: 'ws-new', name: '英语', kind: 'study' }
  });
});

test('creates a task in the current workspace by default', async () => {
  const result = await executeButlerTool(
    {
      id: 'c2',
      name: 'create_task',
      arguments: {
        title: '精读一篇',
        subject: '英语',
        durationMin: 30,
        acceptance: '整理 5 个表达'
      }
    },
    tools,
    context
  );
  expect(result.ok).toBe(true);
  expect(JSON.parse(result.content)).toMatchObject({
    ok: true,
    result: {
      id: 'task-1',
      workspaceId: 'ws-exam',
      title: '精读一篇',
      status: 'pending'
    }
  });
});

test('creates a task pinned to a start time', async () => {
  const createTask = vi.fn(async (input: { workspaceId: string; startAt?: string }) => ({
    id: 'task-1',
    ...input,
    title: '真题',
    status: 'pending'
  }));
  const result = await executeButlerTool(
    {
      id: 'c2b',
      name: 'create_task',
      arguments: {
        title: '真题',
        subject: '数学',
        durationMin: 45,
        startAt: '2026-11-01T14:00'
      }
    },
    tools,
    {
      ...context,
      workspace: { ...workspaceService, createTask } as unknown as WorkspaceService
    }
  );

  expect(result.ok).toBe(true);
  expect(createTask).toHaveBeenCalledWith(
    expect.objectContaining({ startAt: '2026-11-01T14:00' })
  );
});

test('reschedules a task without changing its status', async () => {
  const updateWorkspaceTask = vi.fn(async (input: { taskId: string; startAt?: string }) => ({
    id: input.taskId,
    status: 'pending',
    startAt: input.startAt
  }));
  const result = await executeButlerTool(
    {
      id: 'c2c',
      name: 'update_task',
      arguments: { taskId: 't-1', startAt: '2026-11-01T15:30' }
    },
    tools,
    {
      ...context,
      workspace: {
        ...workspaceService,
        updateWorkspaceTask
      } as unknown as WorkspaceService
    }
  );

  expect(result.ok).toBe(true);
  expect(updateWorkspaceTask).toHaveBeenCalledWith({
    taskId: 't-1',
    startAt: '2026-11-01T15:30'
  });
});

test('does not create planned tasks when Stop arrives during planning', async () => {
  const controller = new AbortController();
  const createTask = vi.fn();
  const planner = {
    plan: async () => {
      controller.abort();
      return {
        workspaceId: 'ws-exam',
        date: '2026-11-01',
        generatedBy: 'agent' as const,
        tasks: [
          { title: '极限', subject: '数学', durationMin: 30, acceptance: '完成' }
        ]
      };
    }
  };
  const result = await executeButlerTool(
    { id: 'c6', name: 'plan_workspace', arguments: { workspaceId: 'ws-exam' } },
    tools,
    {
      workspace: { ...workspaceService, createTask } as unknown as WorkspaceService,
      workspaceId: 'ws-exam',
      planner,
      signal: controller.signal,
      now: () => new Date()
    }
  );

  expect(result.ok).toBe(false);
  expect(createTask).not.toHaveBeenCalled();
});

test('passes the Stop signal into review memory synthesis', async () => {
  const controller = new AbortController();
  const synthesizeFromReview = vi
    .fn()
    .mockResolvedValue({ items: [], generatedBy: 'rules' });
  const result = await executeButlerTool(
    {
      id: 'c7',
      name: 'save_review',
      arguments: { workspaceId: 'ws-exam', completed: '数学', stuck: '极限', tomorrow: '复盘' }
    },
    tools,
    {
      workspace: workspaceService,
      memory: { synthesizeFromReview } as never,
      signal: controller.signal,
      now: () => new Date()
    }
  );

  expect(result.ok).toBe(true);
  expect(synthesizeFromReview).toHaveBeenCalledWith(
    expect.objectContaining({ signal: controller.signal })
  );
});

test('sets a global reminder', async () => {
  const result = await executeButlerTool(
    {
      id: 'c3',
      name: 'set_reminder',
      arguments: { time: '21:30', label: '复盘' }
    },
    tools,
    context
  );
  expect(result.ok).toBe(true);
  expect(JSON.parse(result.content)).toMatchObject({
    ok: true,
    result: { id: 'rem-1', time: '21:30', label: '复盘' }
  });
});

test('reports missing workspace and reminder capability', async () => {
  const noWorkspace = await executeButlerTool(
    {
      id: 'c4',
      name: 'create_task',
      arguments: { title: '任务', durationMin: 20 }
    },
    tools,
    { workspace: workspaceService, now: () => new Date() }
  );
  expect(noWorkspace.ok).toBe(false);
  expect(noWorkspace.content).toContain('workspaceId');

  const noReminder = await executeButlerTool(
    {
      id: 'c5',
      name: 'set_reminder',
      arguments: { time: '21:30', label: '复盘' }
    },
    tools,
    {
      workspace: { ...workspaceService, createReminder: undefined } as unknown as WorkspaceService,
      now: () => new Date()
    }
  );
  expect(noReminder.ok).toBe(false);
  expect(noReminder.content).toContain('不支持写入提醒');
});


test('saves a review and synthesizes memory', async () => {
  const memory = {
    synthesizeFromReview: async () => ({
      items: [{ id: 'm1', workspaceId: 'ws-exam', text: '极限还不稳', source: 'review:2026-11-01' }],
      generatedBy: 'rules' as const
    })
  };
  const result = await executeButlerTool(
    {
      id: 'c6',
      name: 'save_review',
      arguments: {
        date: '2026-11-01',
        completed: '数学两小时',
        stuck: '极限',
        tomorrow: '先复习'
      }
    },
    tools,
    { ...context, memory: memory as never }
  );
  expect(result.ok).toBe(true);
  expect(JSON.parse(result.content)).toMatchObject({
    ok: true,
    result: {
      date: '2026-11-01',
      workspaceId: 'ws-exam',
      answers: { completed: '数学两小时', stuck: '极限', tomorrow: '先复习' },
      memory: [{ text: '极限还不稳' }]
    }
  });
});

test('plans a workspace and persists the plan tasks', async () => {
  const planner = {
    plan: async (input: { workspaceId: string; date?: string }) => ({
      workspaceId: input.workspaceId,
      date: input.date ?? '2026-11-01',
      generatedBy: 'template' as const,
      tasks: [
        {
          title: '极限 10 题',
          subject: '数学',
          durationMin: 45,
          acceptance: '正确率 80%'
        }
      ]
    })
  };
  const result = await executeButlerTool(
    { id: 'c7', name: 'plan_workspace', arguments: { availableMinutes: 90 } },
    tools,
    { ...context, planner: planner as never }
  );
  expect(result.ok).toBe(true);
  expect(JSON.parse(result.content)).toMatchObject({
    ok: true,
    result: {
      workspaceId: 'ws-exam',
      generatedBy: 'template',
      tasks: [{ title: '极限 10 题', workspaceId: 'ws-exam' }]
    }
  });
});

test('updates workspace metadata', async () => {
  const result = await executeButlerTool(
    {
      id: 'c8',
      name: 'update_workspace',
      arguments: { goal: '2027 考研 400 分' }
    },
    tools,
    context
  );
  expect(result.ok).toBe(true);
  expect(JSON.parse(result.content)).toMatchObject({
    ok: true,
    result: { id: 'ws-exam', goal: '2027 考研 400 分' }
  });
});

test('does not start a tool after generation was stopped', async () => {
  const controller = new AbortController();
  controller.abort();
  const execute = vi.fn();
  await expect(
    executeButlerTool(
      { id: 'c-stop', name: 'noop', arguments: {} },
      [{ name: 'noop', description: '', parameters: {}, execute }],
      { ...context, signal: controller.signal }
    )
  ).rejects.toThrow(/已停止生成/);
  expect(execute).not.toHaveBeenCalled();
});
