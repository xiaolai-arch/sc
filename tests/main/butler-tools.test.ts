import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createButlerTools,
  executeButlerTool,
  ToolInputError
} from '../../src/main/butler/tools';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';
import { parseTaskFile } from '../../src/main/workspace/records/tasks';
import type { KnowledgeService, KnowledgeTopic } from '../../src/shared/knowledge';
import type { ProfileService } from '../../src/shared/profile';
import type {
  CreatePracticeSetInput,
  PracticeAttempt,
  PracticeMistake,
  PracticeService,
  PracticeSet
} from '../../src/shared/practice';
import type { WorkspaceService } from '../../src/shared/workspace';
import type { CommitmentService } from '../../src/main/commitments/service';

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
    getNote: async (topicId) => ({ topicId, body: '', updatedAt: '' }),
    saveNote: async (input) => ({ ...input, updatedAt: '' }),
    getBacklinks: async () => [],
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

/** A workspace service whose snapshot carries a readable workspace name. */
function workspaceWithName(name: string): WorkspaceService {
  return {
    ...workspaceService,
    getWorkspaceSnapshot: async (workspaceId: string) => ({
      workspace: {
        id: workspaceId,
        name,
        kind: 'exam',
        color: '#ef4444',
        goal: '',
        description: ''
      },
      tasks: [],
      notes: [],
      memory: [],
      reminders: []
    })
  } as unknown as WorkspaceService;
}

function practiceStub(): { service: PracticeService; createSet: ReturnType<typeof vi.fn> } {
  const createSet = vi.fn(async (input: CreatePracticeSetInput): Promise<PracticeSet> => ({
    id: 'set-1',
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
    createdAt: '2026-11-21T00:00:00.000Z',
    updatedAt: '2026-11-21T00:00:00.000Z'
  }));
  return { createSet, service: { createSet } as unknown as PracticeService };
}

function quizQuestions(): unknown[] {
  return [
    {
      prompt: '极限 lim(x→0) sin(x)/x 等于多少？',
      options: ['0', '1', '∞', '不存在'],
      answer: 1,
      explanation: '重要极限。'
    },
    {
      prompt: 'x→0 时，下列哪组是等价无穷小？',
      options: ['x 与 x²', 'x 与 sin(x)', 'x 与 ln(x)', 'x 与 1/x'],
      answer: 1
    },
    {
      prompt: '夹逼准则适用于哪类数列收敛的判定？',
      options: ['单调有界数列', '两边夹住的数列', '递推数列', '任意数列'],
      answer: 1
    }
  ];
}

/** Runs the new tool's execute directly and returns what it threw (null on success). */
async function createPracticeSetError(questions: unknown): Promise<unknown> {
  const tool = createButlerTools().find((entry) => entry.name === 'create_practice_set');
  if (!tool) throw new Error('create_practice_set tool is missing');
  try {
    await tool.execute(
      { title: '极限小测', questions },
      {
        workspace: workspaceService,
        workspaceId: 'ws-exam',
        practice: practiceStub().service,
        now: () => new Date()
      }
    );
    return null;
  } catch (error) {
    return error;
  }
}

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

test('create_task passes an optional cue to the service', async () => {
  const createTask = vi.fn(
    async (input: { workspaceId: string; title: string; cue?: string }) => ({
      id: 'task-1',
      ...input,
      status: 'pending'
    })
  );
  const result = await executeButlerTool(
    {
      id: 'c2d',
      name: 'create_task',
      arguments: { title: '真题', subject: '数学', durationMin: 45, cue: '到自习室' }
    },
    tools,
    {
      ...context,
      workspace: { ...workspaceService, createTask } as unknown as WorkspaceService
    }
  );

  expect(result.ok).toBe(true);
  expect(createTask).toHaveBeenCalledWith(
    expect.objectContaining({ title: '真题', cue: '到自习室' })
  );
});

test('create_task refuses a fake due before it reaches the vault', async () => {
  // The model can put any string in `due`; here the tool is wired to the real
  // workspace service, so this is the model-reachable path end to end. The
  // fake day the Date parser rolls over must be refused and nothing written.
  const dir = await mkdtemp(join(tmpdir(), 'asaki-butler-create-task-'));
  try {
    const service = createWorkspaceService(dir, { seed: false });
    const workspace = await service.createWorkspace({
      name: '考研',
      kind: 'exam',
      goal: '上岸',
      description: ''
    });
    const result = await executeButlerTool(
      {
        id: 'c2e',
        name: 'create_task',
        arguments: { title: '真题', subject: '数学', durationMin: 45, due: '2026-02-30' }
      },
      tools,
      {
        workspace: service,
        workspaceId: workspace.id,
        now: () => new Date('2026-11-22T20:30:00')
      }
    );

    expect(result.ok).toBe(false);
    expect(JSON.parse(result.content).error).toContain('task due date');
    expect((await service.getWorkspaceSnapshot(workspace.id)).tasks).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('update_task sets and clears the cue', async () => {
  const updateWorkspaceTask = vi.fn(
    async (input: { taskId: string; cue?: string | null }) => ({
      id: input.taskId,
      status: 'pending',
      ...(input.cue !== undefined ? { cue: input.cue } : {})
    })
  );
  const toolContext = {
    ...context,
    workspace: {
      ...workspaceService,
      updateWorkspaceTask
    } as unknown as WorkspaceService
  };

  const set = await executeButlerTool(
    { id: 'c2e', name: 'update_task', arguments: { taskId: 't-1', cue: '晚饭后' } },
    tools,
    toolContext
  );
  expect(set.ok).toBe(true);
  expect(updateWorkspaceTask).toHaveBeenLastCalledWith({ taskId: 't-1', cue: '晚饭后' });

  const clear = await executeButlerTool(
    { id: 'c2f', name: 'update_task', arguments: { taskId: 't-1', cue: null } },
    tools,
    toolContext
  );
  expect(clear.ok).toBe(true);
  expect(updateWorkspaceTask).toHaveBeenLastCalledWith({ taskId: 't-1', cue: null });
});

test('update_task sets, truncates and clears nextStep through the real vault', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'butler-next-step-'));
  const service = createWorkspaceService(dir);
  try {
    const created = await service.createTask({
      workspaceId: 'kaoyan',
      title: '真题一套',
      subject: '数学',
      durationMin: 120,
      acceptance: '一套'
    });

    const tools = createButlerTools();
    const toolContext = {
      ...context,
      workspace: service
    } as unknown as Parameters<typeof executeButlerTool>[2];

    // Set: the one-line first step lands in the frontmatter, trimmed.
    const set = await executeButlerTool(
      {
        id: 'ns1',
        name: 'update_task',
        arguments: { taskId: created.id, nextStep: ' 先翻到教材第 42 页把例题抄一遍 ' }
      },
      tools,
      toolContext
    );
    expect(set.ok).toBe(true);
    const stored = (await service.getWorkspaceSnapshot('kaoyan')).tasks.find(
      (entry) => entry.id === created.id
    );
    expect(stored?.nextStep).toBe('先翻到教材第 42 页把例题抄一遍');

    // >80 code points truncates to exactly 80, never rejects.
    const long = '一'.repeat(100);
    await executeButlerTool(
      { id: 'ns2', name: 'update_task', arguments: { taskId: created.id, nextStep: long } },
      tools,
      toolContext
    );
    const truncated = (await service.getWorkspaceSnapshot('kaoyan')).tasks.find(
      (entry) => entry.id === created.id
    );
    expect([...(truncated?.nextStep ?? '')]).toHaveLength(80);

    // An empty string clears the field (key deletion, not an empty value).
    await executeButlerTool(
      { id: 'ns3', name: 'update_task', arguments: { taskId: created.id, nextStep: '' } },
      tools,
      toolContext
    );
    const cleared = (await service.getWorkspaceSnapshot('kaoyan')).tasks.find(
      (entry) => entry.id === created.id
    );
    expect(cleared?.nextStep).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('update_task schema carries the one-line next-step instruction', () => {
  const tool = createButlerTools().find((entry) => entry.name === 'update_task');
  if (!tool) throw new Error('update_task tool is missing');
  const properties = (tool.parameters as {
    properties: Record<string, { type: string; description: string }>;
  }).properties;
  expect(properties.nextStep.type).toBe('string');
  expect(properties.nextStep.description).toContain('单行');
  expect(properties.nextStep.description).toContain('一句话');
  expect(properties.nextStep.description).toContain('可执行');
  // The rest of the schema is untouched.
  expect(Object.keys(properties)).toEqual([
    'taskId',
    'status',
    'actualMin',
    'cue',
    'nextStep',
    'startAt'
  ]);
  expect(tool.description).toBe(
    '更新任务状态（pending / in-progress / done / skipped）、记录实际用时，或把任务固定到某个开始时间（startAt）。'
  );
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

test('plan_workspace dues its tasks to the plan day, including a future one', async () => {
  // item 66 P1-1: a plan asked for a future day must land its tasks on that
  // day. The createTask call carries `due` (like create_task does), so the
  // workspace service writes tasks/<plan.date>.md instead of falling back to
  // today. The same-day plan passes the same shape, so its behavior is
  // unchanged.
  const createTask = vi.fn(async (input: {
    workspaceId: string;
    title: string;
    due?: string;
  }) => ({ id: 'task-1', ...input, status: 'pending' as const }));
  const planner = {
    plan: async (input: { workspaceId: string; date?: string }) => ({
      workspaceId: input.workspaceId,
      date: input.date ?? '2026-11-22',
      generatedBy: 'template' as const,
      tasks: [
        { title: '极限 10 题', subject: '数学', durationMin: 45, acceptance: '正确率 80%' }
      ]
    })
  };
  const toolContext = (now: () => Date) => ({
    workspace: { ...workspaceService, createTask } as unknown as WorkspaceService,
    workspaceId: 'ws-exam',
    planner: planner as never,
    now
  });

  await executeButlerTool(
    { id: 'c7f', name: 'plan_workspace', arguments: { date: '2026-12-01' } },
    tools,
    toolContext(() => new Date('2026-11-22T09:00:00'))
  );
  expect(createTask).toHaveBeenCalledWith(
    expect.objectContaining({ workspaceId: 'ws-exam', due: '2026-12-01' })
  );

  createTask.mockClear();
  await executeButlerTool(
    { id: 'c7t', name: 'plan_workspace', arguments: {} },
    tools,
    toolContext(() => new Date('2026-11-22T09:00:00'))
  );
  // Same-day plan: the due equals today, which is exactly what the service's
  // fallback used to produce — behavior unchanged.
  expect(createTask).toHaveBeenCalledWith(
    expect.objectContaining({ workspaceId: 'ws-exam', due: '2026-11-22' })
  );
});

test('plan_workspace lands a future-dated plan in tasks/<plan.date>.md', async () => {
  // End to end over the real workspace service: the file the plan day names
  // exists and the record carries the due, while today's file stays untouched.
  const dir = await mkdtemp(join(tmpdir(), 'asaki-butler-plan-due-'));
  try {
    const service = createWorkspaceService(dir, { seed: false });
    const workspace = await service.createWorkspace({
      name: '考研',
      kind: 'exam',
      goal: '上岸',
      description: ''
    });
    const planner = {
      plan: async (input: { workspaceId: string; date?: string }) => ({
        workspaceId: input.workspaceId,
        date: input.date ?? '2026-11-22',
        generatedBy: 'template' as const,
        tasks: [
          { title: '极限 10 题', subject: '数学', durationMin: 45, acceptance: '正确率 80%' }
        ]
      })
    };
    const result = await executeButlerTool(
      { id: 'c7r', name: 'plan_workspace', arguments: { date: '2026-11-30' } },
      tools,
      {
        workspace: service,
        workspaceId: workspace.id,
        planner: planner as never,
        now: () => new Date('2026-11-22T09:00:00')
      }
    );
    expect(result.ok).toBe(true);

    const future = parseTaskFile(
      await readFile(
        join(dir, 'workspaces', workspace.id, 'tasks', '2026-11-30.md'),
        'utf8'
      )
    );
    expect(future).toHaveLength(1);
    expect(future[0]).toMatchObject({ title: '极限 10 题', due: '2026-11-30' });
    // The plan day owns the tasks; today stays empty.
    await expect(
      readFile(join(dir, 'workspaces', workspace.id, 'tasks', '2026-11-22.md'), 'utf8')
    ).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('creates a long plan through the long plan service', async () => {
  const create = vi.fn(async (input: {
    workspaceId: string;
    goal: string;
    weeks: number;
    weeklyHours?: number;
  }) => ({
    id: 'lp-1',
    workspaceId: input.workspaceId,
    goal: input.goal,
    startDate: '2026-11-16',
    weeks: input.weeks,
    weeklyHours: input.weeklyHours ?? 10,
    generatedBy: 'agent',
    createdAt: '2026-11-15T09:00:00.000Z',
    updatedAt: '2026-11-15T09:00:00.000Z',
    phases: [
      {
        id: 'ph1',
        title: '起步',
        subtitle: '',
        goal: '',
        weeks: [
          {
            id: 'w1',
            number: 1,
            title: 'W47',
            goal: '',
            startDate: '2026-11-16',
            endDate: '2026-11-22',
            days: [],
            checks: []
          }
        ]
      }
    ]
  }));
  const result = await executeButlerTool(
    { id: 'c-lp', name: 'create_long_plan', arguments: { weeks: 6, weeklyHours: 10 } },
    tools,
    {
      workspace: {
        ...workspaceService,
        getWorkspaceSnapshot: async (workspaceId: string) => ({
          workspace: {
            id: workspaceId,
            name: '考研',
            kind: 'exam',
            color: '#000000',
            goal: '2028 中科大软件工程',
            description: ''
          },
          tasks: [],
          notes: [],
          memory: [],
          reminders: []
        })
      } as unknown as WorkspaceService,
      workspaceId: 'ws-exam',
      longPlans: { create } as never,
      now: () => new Date()
    }
  );

  expect(result.ok).toBe(true);
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      workspaceId: 'ws-exam',
      goal: '2028 中科大软件工程',
      weeks: 6,
      weeklyHours: 10
    })
  );
  expect(JSON.parse(result.content)).toMatchObject({
    ok: true,
    result: { planId: 'lp-1', workspaceId: 'ws-exam', weeks: 6 }
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

// --- the exam stage parameter (iter34 P3, 验收 24) --------------------------

function phaseService(kind: 'exam' | 'study'): {
  service: WorkspaceService;
  update: ReturnType<typeof vi.fn>;
} {
  const update = vi.fn(async (input: Record<string, unknown>) => ({
    id: String(input.workspaceId),
    name: '考研',
    kind,
    color: '#ef4444',
    goal: '2027 上岸',
    description: '',
    ...(input.phase !== undefined ? { phase: input.phase } : {})
  }));
  const service = {
    ...workspaceService,
    getWorkspaceSnapshot: async (workspaceId: string) => ({
      workspace: {
        id: workspaceId,
        name: '考研',
        kind,
        color: '#ef4444',
        goal: '',
        description: ''
      },
      tasks: [],
      notes: [],
      memory: [],
      reminders: []
    }),
    updateWorkspace: update
  } as unknown as WorkspaceService;
  return { service, update };
}

test('update_workspace forwards a phase on an exam project (验收 24)', async () => {
  const { service, update } = phaseService('exam');
  const result = await executeButlerTool(
    { id: 'c-phase', name: 'update_workspace', arguments: { phase: '强化' } },
    tools,
    { workspace: service, workspaceId: 'ws-exam', now: () => new Date() }
  );
  expect(result.ok).toBe(true);
  expect(update).toHaveBeenCalledWith({ workspaceId: 'ws-exam', phase: '强化' });
});

test('update_workspace refuses a phase on a non-exam project (验收 24)', async () => {
  const { service, update } = phaseService('study');
  const result = await executeButlerTool(
    { id: 'c-phase', name: 'update_workspace', arguments: { phase: '基础' } },
    tools,
    { workspace: service, workspaceId: 'ws-study', now: () => new Date() }
  );
  expect(result.ok).toBe(false);
  expect(JSON.parse(result.content)).toMatchObject({ ok: false });
  expect(JSON.parse(result.content).error).toContain('备考项目');
  expect(update).not.toHaveBeenCalled();
});

test('update_workspace refuses a label outside the three stages (验收 24)', async () => {
  const { service, update } = phaseService('exam');
  const result = await executeButlerTool(
    { id: 'c-phase', name: 'update_workspace', arguments: { phase: '预习' } },
    tools,
    { workspace: service, workspaceId: 'ws-exam', now: () => new Date() }
  );
  expect(result.ok).toBe(false);
  expect(update).not.toHaveBeenCalled();
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

test('save_profile keeps a model guess pending unless the user confirmed it', async () => {
  const tools = createButlerTools();
  const create = vi.fn(async (input: Parameters<ProfileService['create']>[0]) => ({
    id: 'p1',
    category: input.category,
    text: input.text,
    source: 'model' as const,
    confidence: 'candidate' as const,
    status: 'active' as const,
    origin: input.origin ?? '对话',
    createdAt: '2026-11-02T09:00:00.000Z',
    updatedAt: '2026-11-02T09:00:00.000Z'
  }));
  const profile = { create } as unknown as ProfileService;

  await executeButlerTool(
    {
      id: '1',
      name: 'save_profile',
      arguments: { category: 'constraints', text: '工作日只能学一小时' }
    },
    tools,
    {
      workspace: workspaceService,
      profile,
      now: () => new Date('2026-11-02T09:00:00.000Z')
    }
  );

  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      category: 'constraints',
      text: '工作日只能学一小时',
      source: 'model',
      confidence: 'candidate'
    })
  );
});

test('create_practice_set creates a set through the practice service', async () => {
  const { createSet, service } = practiceStub();
  const result = await executeButlerTool(
    {
      id: 'p1',
      name: 'create_practice_set',
      arguments: { title: '极限小测', subject: '数学', questions: quizQuestions() }
    },
    tools,
    {
      workspace: workspaceWithName('考研'),
      workspaceId: 'ws-exam',
      practice: service,
      now: () => new Date('2026-11-21T09:00:00.000Z')
    }
  );

  expect(result.ok).toBe(true);
  expect(createSet).toHaveBeenCalledTimes(1);
  expect(createSet).toHaveBeenCalledWith(
    expect.objectContaining({
      workspaceId: 'ws-exam',
      title: '极限小测',
      subject: '数学',
      // Model-written questions stay 待核对 until the learner reviews them.
      source: 'model'
    })
  );
  expect(JSON.parse(result.content)).toMatchObject({
    ok: true,
    result: {
      setId: 'set-1',
      workspaceId: 'ws-exam',
      title: '极限小测',
      questionCount: 3,
      message: '已出题：极限小测（3 题，考研）· 去学习页作答，错题会自动进错题本'
    }
  });
});

test('create_practice_set rejects invalid question lists with Chinese messages', async () => {
  const singleOption = { prompt: '只有一个选项？', options: ['是的'], answer: 0 };
  const duplicated = { prompt: '重复选项？', options: ['甲', '乙', '甲'], answer: 0 };
  const outOfRange = { prompt: '下标越界？', options: ['甲', '乙'], answer: 5 };

  const tooFew = await createPracticeSetError(quizQuestions().slice(0, 2));
  expect(tooFew).toBeInstanceOf(ToolInputError);
  expect((tooFew as ToolInputError).message).toContain('3-10 道题');

  const tooMany = await createPracticeSetError(
    Array.from({ length: 11 }, (_, index) => ({
      prompt: `第 ${index + 1} 题`,
      options: ['甲', '乙'],
      answer: 0
    }))
  );
  expect(tooMany).toBeInstanceOf(ToolInputError);
  expect((tooMany as ToolInputError).message).toContain('3-10 道题');

  const oneOption = await createPracticeSetError([singleOption, singleOption, singleOption]);
  expect(oneOption).toBeInstanceOf(ToolInputError);
  expect((oneOption as ToolInputError).message).toContain('2-6 个选项');

  const badAnswer = await createPracticeSetError([outOfRange, outOfRange, outOfRange]);
  expect(badAnswer).toBeInstanceOf(ToolInputError);
  expect((badAnswer as ToolInputError).message).toContain('整数下标');

  const sameOptions = await createPracticeSetError([duplicated, duplicated, duplicated]);
  expect(sameOptions).toBeInstanceOf(ToolInputError);
  expect((sameOptions as ToolInputError).message).toContain('选项不能重复');
});

test('create_practice_set accepts a mixed choice/short list', async () => {
  const { createSet, service } = practiceStub();
  const result = await executeButlerTool(
    {
      id: 'p4',
      name: 'create_practice_set',
      arguments: {
        title: '混合小测',
        questions: [
          quizQuestions()[0],
          { kind: 'short', prompt: '用自己的话说明夹逼准则。', referenceAnswer: '两边夹住即可' },
          { prompt: '选择题默认是 choice', options: ['甲', '乙'], answer: 1 }
        ]
      }
    },
    tools,
    {
      workspace: workspaceWithName('考研'),
      workspaceId: 'ws-exam',
      practice: service,
      now: () => new Date('2026-11-21T09:00:00.000Z')
    }
  );

  expect(result.ok).toBe(true);
  expect(createSet).toHaveBeenCalledWith({
    workspaceId: 'ws-exam',
    title: '混合小测',
    source: 'model',
    questions: [
      {
        prompt: '极限 lim(x→0) sin(x)/x 等于多少？',
        options: ['0', '1', '∞', '不存在'],
        answer: 1,
        explanation: '重要极限。'
      },
      { kind: 'short', prompt: '用自己的话说明夹逼准则。', referenceAnswer: '两边夹住即可' },
      { prompt: '选择题默认是 choice', options: ['甲', '乙'], answer: 1 }
    ]
  });
});

test('create_practice_set passes short-question checkpoints through and drops stray ones', async () => {
  const { createSet, service } = practiceStub();
  const result = await executeButlerTool(
    {
      id: 'p5',
      name: 'create_practice_set',
      arguments: {
        title: '检查点小测',
        questions: [
          {
            kind: 'short',
            prompt: '用自己的话说明第一个重要极限。',
            referenceAnswer: 'x→0 时 sin x / x 的极限是 1。',
            checkpoints: ['答出了极限值是 1', '提到了 x→0 这个条件', '', '   ']
          },
          { kind: 'short', prompt: '只有一条检查点。', referenceAnswer: '答案。', checkpoints: ['只有一条'] },
          { prompt: '选择题不收检查点。', options: ['甲', '乙'], answer: 1, checkpoints: ['一', '二'] },
          { kind: 'short', prompt: '没给检查点也可以。', referenceAnswer: '答案。' }
        ]
      }
    },
    tools,
    {
      workspace: workspaceWithName('考研'),
      workspaceId: 'ws-exam',
      practice: service,
      now: () => new Date('2026-11-21T09:00:00.000Z')
    }
  );

  expect(result.ok).toBe(true);
  // 建模集路径：checkpoints 随题写入，2-3 条生效；空串丢弃；1 条视为无；
  // choice 题与未提供的短答题零检查点。
  expect(createSet).toHaveBeenCalledWith({
    workspaceId: 'ws-exam',
    title: '检查点小测',
    source: 'model',
    questions: [
      {
        kind: 'short',
        prompt: '用自己的话说明第一个重要极限。',
        referenceAnswer: 'x→0 时 sin x / x 的极限是 1。',
        checkpoints: ['答出了极限值是 1', '提到了 x→0 这个条件']
      },
      { kind: 'short', prompt: '只有一条检查点。', referenceAnswer: '答案。' },
      { prompt: '选择题不收检查点。', options: ['甲', '乙'], answer: 1 },
      { kind: 'short', prompt: '没给检查点也可以。', referenceAnswer: '答案。' }
    ]
  });
});

test('create_practice_set schema carries the checkpoint instruction and nothing else changes', () => {
  const tool = createButlerTools().find((entry) => entry.name === 'create_practice_set');
  if (!tool) throw new Error('create_practice_set tool is missing');
  const parameters = tool.parameters as {
    properties: {
      questions: { items: { properties: Record<string, unknown>; required: string[] } };
    };
  };
  const items = parameters.properties.questions.items;
  // The checkpoints property is the only addition, appended after the
  // pre-existing properties; required stays untouched.
  expect(Object.keys(items.properties)).toEqual([
    'kind',
    'prompt',
    'options',
    'answer',
    'referenceAnswer',
    'explanation',
    'checkpoints'
  ]);
  expect(items.required).toEqual(['prompt']);
  // The instruction appears only in the new property and states the
  // short-only, sentence-level, 2-3 rule.
  const checkpoints = items.properties.checkpoints as { type: string; description: string };
  expect(checkpoints.type).toBe('array');
  expect(checkpoints.description).toContain('仅短答题');
  expect(checkpoints.description).toContain('2-3 条句子级检查点');
  expect(checkpoints.description).toContain('答到了吗');
  expect(checkpoints.description).toContain('不要提供');
  // 其余建集提示词逐字节不变：literal snapshots of the pre-P2a strings.
  expect(tool.description).toBe(
    '出 3-10 道题组成一份练习集，写入学习页的练习模块。用户说「考考我 / 出几道题 / 测测我 / 帮我复习」时，从用户学过的内容出题。选择题设 kind 为 choice（或省略 kind），answer 是正确选项的下标（从 0 开始）；短答题请把 kind 设为 short 并给 referenceAnswer（参考答案），让用户用自己的话作答。'
  );
  expect((items.properties.kind as { description: string }).description).toBe(
    '题型：choice 选择题（默认）或 short 短答题'
  );
  expect((items.properties.prompt as { description: string }).description).toBe('题干');
  expect((items.properties.options as { description: string }).description).toBe(
    '选择题的 2-6 个选项；短答题省略'
  );
  expect((items.properties.answer as { description: string }).description).toBe(
    '选择题正确选项的下标，从 0 开始的整数；短答题省略'
  );
  expect((items.properties.referenceAnswer as { description: string }).description).toBe(
    '短答题的参考答案；短答题必填'
  );
  expect((items.properties.explanation as { description: string }).description).toBe('解析，可选');
});

test('create_practice_set rejects a short question missing referenceAnswer', async () => {
  const short = { kind: 'short', prompt: '用自己的话说明夹逼准则。' };
  const other = quizQuestions()[0];
  const error = await createPracticeSetError([other, short, other]);

  expect(error).toBeInstanceOf(ToolInputError);
  expect((error as ToolInputError).message).toContain('参考答案');

  const wrongKind = await createPracticeSetError([
    other,
    { kind: 'essay', prompt: '题', options: ['甲', '乙'], answer: 0 },
    other
  ]);
  expect(wrongKind).toBeInstanceOf(ToolInputError);
  expect((wrongKind as ToolInputError).message).toContain('choice 或 short');
});

test('create_practice_set reports when the practice service is unavailable', async () => {
  const result = await executeButlerTool(
    {
      id: 'p2',
      name: 'create_practice_set',
      arguments: { title: '极限小测', questions: quizQuestions() }
    },
    tools,
    {
      workspace: workspaceWithName('考研'),
      workspaceId: 'ws-exam',
      practice: null,
      now: () => new Date()
    }
  );

  expect(result.ok).toBe(false);
  expect(result.content).toContain('练习服务未连接');
});

test('create_practice_set is gated by write permissions like other write tools', async () => {
  const { createSet, service } = practiceStub();
  const result = await executeButlerTool(
    {
      id: 'p3',
      name: 'create_practice_set',
      arguments: { title: '极限小测', questions: quizQuestions() }
    },
    tools,
    {
      workspace: workspaceWithName('考研'),
      workspaceId: 'ws-exam',
      practice: service,
      permissions: { web: true, write: false, shell: false },
      now: () => new Date()
    }
  );

  expect(result.ok).toBe(false);
  expect(result.content).toContain('仅可查看');
  expect(createSet).not.toHaveBeenCalled();
});

function overviewSet(id: string, subject: string, title = id): PracticeSet {
  return {
    id,
    workspaceId: 'ws-exam',
    title,
    subject,
    questions: [
      {
        id: `${id}-q1`,
        prompt: `${id} 的题目`,
        options: ['A', 'B'],
        answer: 0,
        explanation: ''
      }
    ]
  };
}

function attempt(
  id: string,
  setId: string,
  correct: boolean,
  answeredAt: string
): PracticeAttempt {
  return {
    id,
    workspaceId: 'ws-exam',
    setId,
    questionId: `${setId}-q1`,
    choice: correct ? 0 : 1,
    correct,
    answeredAt
  };
}

function activeMistake(id: string, setId: string): PracticeMistake {
  return {
    id,
    workspaceId: 'ws-exam',
    setId,
    questionId: `${setId}-q1`,
    prompt: `${setId} 的题目`,
    options: ['A', 'B'],
    answer: 0,
    explanation: '',
    wrongCount: 1,
    correctStreak: 0,
    priority: 1,
    intervalDays: 1,
    due: '2026-11-21',
    status: 'active',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    lastAnsweredAt: '2026-11-01T00:00:00.000Z'
  };
}

function overviewPractice(options: {
  sets: PracticeSet[];
  attempts: PracticeAttempt[];
  mistakes: PracticeMistake[];
}): PracticeService {
  return {
    listSets: async () => options.sets,
    listAttempts: async () => options.attempts,
    getMistakes: async () => options.mistakes,
    getDue: async () => [],
    getSet: async () => null,
    createSet: async () => {
      throw new Error('unused');
    },
    submitAnswer: async () => {
      throw new Error('unused');
    },
    submitShortAnswer: async () => {
      throw new Error('unused');
    }
  } as unknown as PracticeService;
}

test('get_practice_overview reports per-subject sets, attempts, accuracy and mistakes', async () => {
  const now = new Date('2026-11-21T12:00:00.000Z');
  const practice = overviewPractice({
    sets: [
      overviewSet('ms1', '数学'),
      overviewSet('ms2', '数学'),
      overviewSet('en1', '英语')
    ],
    attempts: [
      attempt('a1', 'ms1', true, '2026-11-17T09:00:00.000Z'),
      attempt('a2', 'ms1', true, '2026-11-18T09:00:00.000Z'),
      attempt('a3', 'ms1', false, '2026-11-19T09:00:00.000Z'),
      // Outside the 8-week window: counts toward the all-time attempt total.
      attempt('a4', 'ms2', true, '2026-08-01T09:00:00.000Z'),
      attempt('a5', 'en1', true, '2026-11-20T09:00:00.000Z')
    ],
    mistakes: [activeMistake('m1', 'ms1'), activeMistake('m2', 'en1'), activeMistake('m3', 'en1')]
  });

  const result = await executeButlerTool(
    {
      id: 'po1',
      name: 'get_practice_overview',
      arguments: {}
    },
    tools,
    { workspace: workspaceService, workspaceId: 'ws-exam', practice, now: () => now }
  );

  expect(result.ok).toBe(true);
  const payload = JSON.parse(result.content) as {
    ok: boolean;
    result: {
      available: boolean;
      workspaceId: string;
      windowWeeks: number;
      subjects: Array<Record<string, unknown>>;
    };
  };
  expect(payload.result.available).toBe(true);
  expect(payload.result.workspaceId).toBe('ws-exam');
  expect(payload.result.windowWeeks).toBe(8);
  expect(payload.result.subjects).toEqual([
    {
      subject: '数学',
      setCount: 2,
      attemptCount: 4,
      recentAnswered: 3,
      recentCorrect: 2,
      accuracy: 67,
      activeMistakes: 1
    },
    {
      subject: '英语',
      setCount: 1,
      attemptCount: 1,
      recentAnswered: 1,
      recentCorrect: 1,
      accuracy: 100,
      activeMistakes: 2
    }
  ]);
});

test('get_practice_overview reads attempts with and without durationMs alike (iter33 P1)', async () => {
  const now = new Date('2026-11-21T12:00:00.000Z');
  const practice = overviewPractice({
    sets: [overviewSet('ms1', '数学')],
    attempts: [
      // iter33 P1: 新记录带用时；旧记录与错题复习不带——两条都要能读。
      { ...attempt('a1', 'ms1', true, '2026-11-17T09:00:00.000Z'), durationMs: 8000 },
      attempt('a2', 'ms1', false, '2026-11-18T09:00:00.000Z')
    ],
    mistakes: []
  });

  const result = await executeButlerTool(
    { id: 'po-dur', name: 'get_practice_overview', arguments: {} },
    tools,
    { workspace: workspaceService, workspaceId: 'ws-exam', practice, now: () => now }
  );

  expect(result.ok).toBe(true);
  const payload = JSON.parse(result.content) as {
    result: { available: boolean; subjects: Array<{ subject: string; attemptCount: number; accuracy: number }> };
  };
  expect(payload.result.available).toBe(true);
  // 概览口径不变：计数与正确率仍按全量 attempt，与用时无关。
  expect(payload.result.subjects[0]).toMatchObject({ subject: '数学', attemptCount: 2, accuracy: 50 });
});

test('get_practice_overview says practice data is unavailable without a service', async () => {  const result = await executeButlerTool(
    { id: 'po2', name: 'get_practice_overview', arguments: {} },
    tools,
    {
      workspace: workspaceService,
      workspaceId: 'ws-exam',
      practice: null,
      now: () => new Date()
    }
  );

  expect(result.ok).toBe(true);
  const payload = JSON.parse(result.content) as {
    result: { available: boolean; message: string };
  };
  expect(payload.result.available).toBe(false);
  expect(payload.result.message).toContain('练习数据不可用');
});

test('get_practice_overview is read-only and allowed under view-only permissions', async () => {
  const practice = overviewPractice({
    sets: [overviewSet('ms1', '数学')],
    attempts: [],
    mistakes: []
  });

  const result = await executeButlerTool(
    { id: 'po3', name: 'get_practice_overview', arguments: {} },
    tools,
    {
      workspace: workspaceService,
      workspaceId: 'ws-exam',
      practice,
      permissions: { web: true, write: false, shell: false },
      now: () => new Date()
    }
  );

  expect(result.ok).toBe(true);
  expect(result.content).toContain('"available":true');
});

test('get_practice_overview requires a workspace id', async () => {
  const tool = createButlerTools().find((entry) => entry.name === 'get_practice_overview');
  if (!tool) throw new Error('get_practice_overview tool is missing');
  await expect(
    tool.execute(
      {},
      {
        workspace: workspaceService,
        practice: overviewPractice({ sets: [], attempts: [], mistakes: [] }),
        now: () => new Date()
      }
    )
  ).rejects.toThrow('缺少 workspaceId');
});

function makeTopic(
  overrides: Partial<KnowledgeTopic> & Pick<KnowledgeTopic, 'id' | 'name'>
): KnowledgeTopic {
  return {
    aliases: [],
    status: 'learning',
    summary: '',
    evidence: [],
    createdAt: '',
    updatedAt: '',
    ...overrides
  };
}

/** An update stub that records revisit writes and echoes them back. */
function updatingKnowledge(topics: KnowledgeTopic[]): {
  service: KnowledgeService;
  update: ReturnType<typeof vi.fn>;
} {
  const update = vi.fn(
    async (input: { id: string; revisitDue?: string | null; revisitStep?: number | null }) => ({
      ...topics.find((topic) => topic.id === input.id)!,
      revisitDue: input.revisitDue ?? undefined,
      ...(input.revisitStep !== undefined ? { revisitStep: input.revisitStep ?? undefined } : {})
    })
  );
  return {
    update,
    service: knowledgeStub({
      list: async () => topics,
      update: update as unknown as KnowledgeService['update']
    })
  };
}

/**
 * An in-memory knowledge service whose `update` persists back onto the topic,
 * so a sequence of tool calls reads the step written by the one before it.
 */
function persistedKnowledge(topic: KnowledgeTopic): {
  service: KnowledgeService;
  current: () => KnowledgeTopic;
} {
  let state: KnowledgeTopic = { ...topic };
  return {
    service: knowledgeStub({
      list: async () => [state],
      update: async (input) => {
        const next: KnowledgeTopic = { ...state, id: state.id, updatedAt: 'stamp' };
        if (input.revisitDue === null) delete next.revisitDue;
        else if (input.revisitDue !== undefined) next.revisitDue = input.revisitDue;
        if (input.revisitStep === null) delete next.revisitStep;
        else if (input.revisitStep !== undefined) next.revisitStep = input.revisitStep;
        state = next;
        return state;
      }
    }),
    current: () => state
  };
}

test('schedule_revisit defaults to tomorrow and confirms in Chinese', async () => {
  const { service, update } = updatingKnowledge([makeTopic({ id: 'kt-1', name: 'LangChain' })]);
  const result = await executeButlerTool(
    { id: 'r1', name: 'schedule_revisit', arguments: { name: 'LangChain' } },
    tools,
    {
      workspace: workspaceService,
      knowledge: service,
      now: () => new Date('2026-11-21T10:00:00')
    }
  );

  expect(update).toHaveBeenCalledWith({ id: 'kt-1', revisitDue: '2026-11-22' });
  expect(result.ok).toBe(true);
  const payload = JSON.parse(result.content) as {
    result: { message: string; revisitDue: string; name: string };
  };
  expect(payload.result.message).toBe('已安排：明天抽 5 分钟自测「LangChain」。');
  expect(payload.result.revisitDue).toBe('2026-11-22');
});

test('schedule_revisit resolves an alias and rolls over the month', async () => {
  const { service, update } = updatingKnowledge([
    makeTopic({ id: 'kt-1', name: 'LangChain', aliases: ['LC'] })
  ]);
  const result = await executeButlerTool(
    { id: 'r2', name: 'schedule_revisit', arguments: { name: 'LC', days: 10 } },
    tools,
    {
      workspace: workspaceService,
      knowledge: service,
      now: () => new Date('2026-11-25T09:00:00')
    }
  );

  expect(update).toHaveBeenCalledWith({ id: 'kt-1', revisitDue: '2026-12-05' });
  const payload = JSON.parse(result.content) as { result: { message: string } };
  expect(payload.result.message).toContain('10 天后（2026-12-05）');
  expect(payload.result.message).toContain('LangChain');
});

test('schedule_revisit lands on the ladder and writes the step when recalled', async () => {
  const { service, update } = updatingKnowledge([
    makeTopic({ id: 'kt-1', name: 'LangChain', revisitDue: '2026-11-21' })
  ]);
  const result = await executeButlerTool(
    { id: 'l1', name: 'schedule_revisit', arguments: { name: 'LangChain', recalled: true } },
    tools,
    {
      workspace: workspaceService,
      knowledge: service,
      now: () => new Date('2026-11-21T10:00:00')
    }
  );

  // No step yet -> first rung: 3 days later, step 1.
  expect(update).toHaveBeenCalledWith({
    id: 'kt-1',
    revisitDue: '2026-11-24',
    revisitStep: 1
  });
  expect(result.ok).toBe(true);
  const payload = JSON.parse(result.content) as {
    result: { message: string; revisitDue: string };
  };
  expect(payload.result.message).toBe('已安排：3 天后（2026-11-24）抽 5 分钟自测「LangChain」。');
  expect(payload.result.revisitDue).toBe('2026-11-24');
});

test('schedule_revisit with recalled ignores days entirely', async () => {
  const { service, update } = updatingKnowledge([
    makeTopic({ id: 'kt-1', name: 'LangChain', revisitDue: '2026-11-21', revisitStep: 1 })
  ]);
  await executeButlerTool(
    {
      id: 'l2',
      name: 'schedule_revisit',
      arguments: { name: 'LangChain', days: 5, recalled: true }
    },
    tools,
    {
      workspace: workspaceService,
      knowledge: service,
      now: () => new Date('2026-11-21T10:00:00')
    }
  );

  // `recalled` wins over `days`: step 1 caught -> 7 days, not 5.
  expect(update).toHaveBeenCalledWith({
    id: 'kt-1',
    revisitDue: '2026-11-28',
    revisitStep: 2
  });
});

test('schedule_revisit walks the ladder across catches and clears the key on a miss', async () => {
  const { service, current } = persistedKnowledge(makeTopic({ id: 'kt-1', name: 'LangChain' }));
  const context = {
    workspace: workspaceService,
    knowledge: service,
    now: () => new Date('2026-11-21T10:00:00')
  };
  const run = (args: Record<string, unknown>, id: string) =>
    executeButlerTool({ id, name: 'schedule_revisit', arguments: args }, tools, context);

  // Catch once -> step 1 / 3 days.
  await run({ name: 'LangChain', recalled: true }, 'l3');
  expect(current().revisitStep).toBe(1);
  expect(current().revisitDue).toBe('2026-11-24');

  // Catch twice -> step 2 / 7 days.
  await run({ name: 'LangChain', recalled: true }, 'l4');
  expect(current().revisitStep).toBe(2);
  expect(current().revisitDue).toBe('2026-11-28');

  // Then a miss -> the step key is removed (never written as 0), tomorrow.
  await run({ name: 'LangChain', recalled: false }, 'l5');
  expect(current().revisitStep).toBeUndefined();
  expect('revisitStep' in current()).toBe(false);
  expect(current().revisitDue).toBe('2026-11-22');
});

test('schedule_revisit omitting recalled stays byte-identical to the baseline', async () => {
  const { service, update } = updatingKnowledge([
    makeTopic({ id: 'kt-1', name: 'LangChain', revisitStep: 3 })
  ]);
  const context = {
    workspace: workspaceService,
    knowledge: service,
    now: () => new Date('2026-11-21T10:00:00')
  };

  // Explicit days: only revisitDue is written, the existing step is untouched.
  await executeButlerTool(
    { id: 'l6', name: 'schedule_revisit', arguments: { name: 'LangChain', days: 10 } },
    tools,
    context
  );
  expect(update).toHaveBeenLastCalledWith({ id: 'kt-1', revisitDue: '2026-12-01' });

  // Default tomorrow: same shape, no step key in the input.
  await executeButlerTool(
    { id: 'l7', name: 'schedule_revisit', arguments: { name: 'LangChain' } },
    tools,
    context
  );
  expect(update).toHaveBeenLastCalledWith({ id: 'kt-1', revisitDue: '2026-11-22' });
  for (const call of update.mock.calls) {
    expect(Object.keys(call[0]).sort()).toEqual(['id', 'revisitDue']);
  }
});

test('schedule_revisit documents that recalled wins over days', () => {
  const tool = createButlerTools().find((entry) => entry.name === 'schedule_revisit');
  if (!tool) throw new Error('schedule_revisit tool is missing');
  expect(tool.description).toContain('recalled 与 days 同时给出时以 recalled 为准');
  const properties = (tool.parameters as {
    properties: Record<string, { description?: string }>;
  }).properties;
  expect(properties.recalled).toBeDefined();
  expect(properties.days?.description).toContain('忽略');
});

test('schedule_revisit clamps days into 1-30', async () => {
  const { service, update } = updatingKnowledge([makeTopic({ id: 'kt-1', name: 'LangChain' })]);
  const toolContext = {
    workspace: workspaceService,
    knowledge: service,
    now: () => new Date('2026-11-21T09:00:00')
  };

  await executeButlerTool(
    { id: 'r3', name: 'schedule_revisit', arguments: { name: 'LangChain', days: 0 } },
    tools,
    toolContext
  );
  expect(update).toHaveBeenLastCalledWith({ id: 'kt-1', revisitDue: '2026-11-22' });

  await executeButlerTool(
    { id: 'r4', name: 'schedule_revisit', arguments: { name: 'LangChain', days: 99 } },
    tools,
    toolContext
  );
  expect(update).toHaveBeenLastCalledWith({ id: 'kt-1', revisitDue: '2026-12-21' });
});

test('schedule_revisit rejects an unknown topic with a Chinese error naming it', async () => {
  const { service } = updatingKnowledge([makeTopic({ id: 'kt-9', name: '番茄工作法' })]);
  const result = await executeButlerTool(
    { id: 'r5', name: 'schedule_revisit', arguments: { name: 'LangChain' } },
    tools,
    { workspace: workspaceService, knowledge: service, now: () => new Date() }
  );

  expect(result.ok).toBe(false);
  const payload = JSON.parse(result.content) as { error: string };
  expect(payload.error).toContain('LangChain');
  expect(payload.error).toContain('没有');
});

test('schedule_revisit refuses without a knowledge service', async () => {
  const result = await executeButlerTool(
    { id: 'r6', name: 'schedule_revisit', arguments: { name: 'LangChain' } },
    tools,
    { workspace: workspaceService, now: () => new Date() }
  );

  expect(result.ok).toBe(false);
  expect(result.content).toContain('知识库未连接');
});

test('schedule_revisit is gated by write permissions like other write tools', async () => {
  const { service, update } = updatingKnowledge([makeTopic({ id: 'kt-1', name: 'LangChain' })]);
  const result = await executeButlerTool(
    { id: 'r7', name: 'schedule_revisit', arguments: { name: 'LangChain' } },
    tools,
    {
      workspace: workspaceService,
      knowledge: service,
      permissions: { web: true, write: false, shell: false },
      now: () => new Date()
    }
  );

  expect(result.ok).toBe(false);
  expect(result.content).toContain('仅可查看');
  expect(update).not.toHaveBeenCalled();
});

test('get_today_plan lists only topics due for a revisit today or earlier', async () => {
  const knowledge = knowledgeStub({
    list: async () => [
      makeTopic({ id: 'kt-due', name: '极限', revisitDue: '2026-11-21' }),
      makeTopic({ id: 'kt-overdue', name: '积分', revisitDue: '2026-11-19' }),
      makeTopic({ id: 'kt-future', name: '级数', revisitDue: '2026-11-25' }),
      makeTopic({ id: 'kt-none', name: '向量' })
    ]
  });
  const workspace = workspaceWithName('考研');
  const result = await executeButlerTool(
    { id: 'r8', name: 'get_today_plan', arguments: {} },
    tools,
    {
      workspace,
      knowledge,
      now: () => new Date('2026-11-21T09:00:00')
    }
  );

  expect(result.ok).toBe(true);
  const payload = JSON.parse(result.content) as {
    result: { revisits: Array<{ topicId: string; name: string; revisitDue: string }> };
  };
  expect(payload.result.revisits.map((revisit) => revisit.topicId)).toEqual([
    'kt-overdue',
    'kt-due'
  ]);
  expect(payload.result.revisits[0]).toEqual({
    topicId: 'kt-overdue',
    name: '积分',
    revisitDue: '2026-11-19'
  });
});

test('get_today_plan omits revisits entirely without due topics or a knowledge service', async () => {
  const workspace = workspaceWithName('考研');
  const noneDue = await executeButlerTool(
    { id: 'r9', name: 'get_today_plan', arguments: {} },
    tools,
    {
      workspace,
      knowledge: knowledgeStub({ list: async () => [makeTopic({ id: 'kt-f', name: '级数', revisitDue: '2026-12-01' })] }),
      now: () => new Date('2026-11-21T09:00:00')
    }
  );
  expect(JSON.parse(noneDue.content).result.revisits).toBeUndefined();

  const noService = await executeButlerTool(
    { id: 'r10', name: 'get_today_plan', arguments: {} },
    tools,
    { workspace, now: () => new Date('2026-11-21T09:00:00') }
  );
  expect(JSON.parse(noService.content).result.revisits).toBeUndefined();
});

// --- commitment tools -------------------------------------------------------

function commitmentStub(
  overrides: Partial<CommitmentService> = {}
): CommitmentService {
  return {
    list: async () => [],
    create: async (input) => ({
      id: 'cm-new',
      text: input.text,
      due: input.due ?? '2026-11-23',
      status: 'open',
      createdAt: '2026-11-22T08:00:00.000Z'
    }),
    resolve: async (input) => ({
      id: input.id ?? 'cm-1',
      text: input.text ?? '背单词',
      due: input.newDue ?? '2026-11-22',
      status: input.outcome ?? 'open',
      createdAt: '2026-11-22T08:00:00.000Z'
    }),
    pending: async () => [],
    listSummaries: async () => [],
    ...overrides
  };
}

const NOW_22 = () => new Date('2026-11-22T09:00:00');

test('record_commitment defaults to tomorrow and confirms in Chinese', async () => {
  const create = vi.fn(commitmentStub().create);
  const service = commitmentStub({ create: create as unknown as CommitmentService['create'] });
  const result = await executeButlerTool(
    { id: 'c1', name: 'record_commitment', arguments: { text: '背 20 个单词' } },
    tools,
    { workspace: workspaceService, commitments: service, now: NOW_22 }
  );

  expect(result.ok).toBe(true);
  expect(create).toHaveBeenCalledWith({ text: '背 20 个单词' });
  const payload = JSON.parse(result.content) as {
    result: { message: string; commitment: { due: string } };
  };
  expect(payload.result.message).toBe(
    '已记下「背 20 个单词」（明天），到那天只问一次。'
  );
  expect(payload.result.commitment.due).toBe('2026-11-23');
});

test('record_commitment resolves a spoken due phrase', async () => {
  const create = vi.fn(commitmentStub().create);
  const service = commitmentStub({ create: create as unknown as CommitmentService['create'] });
  const result = await executeButlerTool(
    {
      id: 'c2',
      name: 'record_commitment',
      arguments: { text: '写完论文', due: '这周内' }
    },
    tools,
    { workspace: workspaceService, commitments: service, now: NOW_22 }
  );

  expect(result.ok).toBe(true);
  // 2026-11-22 is a Sunday, so 这周内 is today.
  expect(create).toHaveBeenCalledWith({ text: '写完论文', due: '2026-11-22' });
});

test('record_commitment rejects empty text and text over 200 chars', async () => {
  const service = commitmentStub();
  const empty = await executeButlerTool(
    { id: 'c3', name: 'record_commitment', arguments: { text: '   ' } },
    tools,
    { workspace: workspaceService, commitments: service, now: NOW_22 }
  );
  expect(empty.ok).toBe(false);
  expect(empty.content).toContain('缺少参数 text');

  const tooLong = await executeButlerTool(
    {
      id: 'c4',
      name: 'record_commitment',
      arguments: { text: '长'.repeat(201) }
    },
    tools,
    { workspace: workspaceService, commitments: service, now: NOW_22 }
  );
  expect(tooLong.ok).toBe(false);
  expect(tooLong.content).toContain('承诺内容不能超过 200 字');
});

test('commitment tools refuse without a commitment service', async () => {
  const record = await executeButlerTool(
    { id: 'c5', name: 'record_commitment', arguments: { text: '背单词' } },
    tools,
    { workspace: workspaceService, now: NOW_22 }
  );
  expect(record.ok).toBe(false);
  expect(record.content).toContain('不支持记录承诺');

  const resolve = await executeButlerTool(
    { id: 'c6', name: 'resolve_commitment', arguments: { id: 'cm-1', outcome: 'done' } },
    tools,
    { workspace: workspaceService, now: NOW_22 }
  );
  expect(resolve.ok).toBe(false);
  expect(resolve.content).toContain('不支持记录承诺');
});

test('resolve_commitment closes a promise (done / dropped) and refuses the old newDue path', async () => {
  const resolve = vi.fn(commitmentStub().resolve);
  const service = commitmentStub({ resolve: resolve as unknown as CommitmentService['resolve'] });

  const done = await executeButlerTool(
    { id: 'r1', name: 'resolve_commitment', arguments: { id: 'cm-1', outcome: 'done' } },
    tools,
    { workspace: workspaceService, commitments: service, now: NOW_22 }
  );
  expect(resolve).toHaveBeenLastCalledWith({ id: 'cm-1', outcome: 'done' });
  expect(done.content).toContain('已结案');

  const dropped = await executeButlerTool(
    { id: 'r2', name: 'resolve_commitment', arguments: { text: '背单词', outcome: 'dropped' } },
    tools,
    { workspace: workspaceService, commitments: service, now: NOW_22 }
  );
  expect(resolve).toHaveBeenLastCalledWith({ text: '背单词', outcome: 'dropped' });
  expect(dropped.content).toContain('已放下');

  // 改期收敛（spec P3/P4）：旧工具不再接受 newDue，改期唯一入口是
  // reschedule_commitment。携带 newDue 的旧式调用被拒、不触达服务。
  resolve.mockClear();
  const moved = await executeButlerTool(
    { id: 'r3', name: 'resolve_commitment', arguments: { id: 'cm-1', newDue: '明天' } },
    tools,
    { workspace: workspaceService, commitments: service, now: NOW_22 }
  );
  expect(moved.ok).toBe(false);
  expect(moved.content).toContain('改期请用 reschedule_commitment');
  expect(resolve).not.toHaveBeenCalled();
});

test('resolve_commitment surfaces an unknown id as a Chinese error', async () => {
  const service = commitmentStub({
    resolve: async (input) => {
      throw new Error(`没有找到承诺：「${input.id ?? input.text ?? ''}」。`);
    }
  });
  const result = await executeButlerTool(
    { id: 'r4', name: 'resolve_commitment', arguments: { id: 'cm-nope', outcome: 'done' } },
    tools,
    { workspace: workspaceService, commitments: service, now: NOW_22 }
  );
  expect(result.ok).toBe(false);
  expect(result.content).toContain('没有找到承诺：「cm-nope」');
});

test('resolve_commitment needs an id or text and an outcome (newDue no longer accepted)', async () => {
  const service = commitmentStub();
  const noTarget = await executeButlerTool(
    { id: 'r5', name: 'resolve_commitment', arguments: { outcome: 'done' } },
    tools,
    { workspace: workspaceService, commitments: service, now: NOW_22 }
  );
  expect(noTarget.ok).toBe(false);
  expect(noTarget.content).toContain('请提供 id 或 text');

  const noAction = await executeButlerTool(
    { id: 'r6', name: 'resolve_commitment', arguments: { id: 'cm-1' } },
    tools,
    { workspace: workspaceService, commitments: service, now: NOW_22 }
  );
  expect(noAction.ok).toBe(false);
  expect(noAction.content).toContain('outcome 只能是 done 或 dropped');
});

test('reschedule_commitment is the only newDue entry and goes through resolve({ newDue })', async () => {
  const resolve = vi.fn(commitmentStub().resolve);
  const service = commitmentStub({ resolve: resolve as unknown as CommitmentService['resolve'] });

  const moved = await executeButlerTool(
    { id: 's1', name: 'reschedule_commitment', arguments: { id: 'cm-1', newDue: '明天' } },
    tools,
    { workspace: workspaceService, commitments: service, now: NOW_22 }
  );
  expect(moved.ok).toBe(true);
  // 唯一改期路径：后端 CommitmentService.resolve({ newDue })。
  expect(resolve).toHaveBeenLastCalledWith({ id: 'cm-1', newDue: '2026-11-23' });
  expect(moved.content).toContain('已改到明天');

  const badDate = await executeButlerTool(
    { id: 's2', name: 'reschedule_commitment', arguments: { id: 'cm-1', newDue: '2026-02-30' } },
    tools,
    { workspace: workspaceService, commitments: service, now: NOW_22 }
  );
  expect(badDate.ok).toBe(false);
  expect(badDate.content).toContain('newDue 必须是 YYYY-MM-DD 或「明天」这类日期');
  expect(resolve).toHaveBeenLastCalledWith({ id: 'cm-1', newDue: '2026-11-23' });

  const missingDue = await executeButlerTool(
    { id: 's3', name: 'reschedule_commitment', arguments: { id: 'cm-1' } },
    tools,
    { workspace: workspaceService, commitments: service, now: NOW_22 }
  );
  expect(missingDue.ok).toBe(false);
  expect(missingDue.content).toContain('缺少参数 newDue');
});

test('reschedule_commitment candidate probe lists same-name promises only when ambiguous', async () => {
  const service = commitmentStub({
    list: async () => [
      { id: 'cm-a', text: '背单词', due: '2026-11-22', status: 'open' as const, createdAt: '2026-11-20T08:00:00.000Z' },
      { id: 'cm-b', text: '背单词', due: '2026-11-25', status: 'open' as const, createdAt: '2026-11-21T08:00:00.000Z' },
      { id: 'cm-c', text: '写完第三章', due: '2026-11-24', status: 'open' as const, createdAt: '2026-11-21T08:00:00.000Z' }
    ]
  });
  const reschedule = tools.find((tool) => tool.name === 'reschedule_commitment');
  expect(reschedule?.approvalCandidates).toBeDefined();

  const ambiguous = await reschedule!.approvalCandidates!(
    { text: '背单词', newDue: '明天' },
    { workspace: workspaceService, commitments: service, now: NOW_22 }
  );
  expect(ambiguous).toEqual([
    { id: 'cm-a', label: '背单词', detail: '到期 2026-11-22' },
    { id: 'cm-b', label: '背单词', detail: '到期 2026-11-25' }
  ]);

  const unique = await reschedule!.approvalCandidates!(
    { text: '写完第三章', newDue: '明天' },
    { workspace: workspaceService, commitments: service, now: NOW_22 }
  );
  expect(unique).toBeNull();

  // id 已精确定位 → 不探测（无歧义）。
  const pinned = await reschedule!.approvalCandidates!(
    { id: 'cm-a', newDue: '明天' },
    { workspace: workspaceService, commitments: service, now: NOW_22 }
  );
  expect(pinned).toBeNull();
});

test('the commitment write tools are gated by write permissions', async () => {
  const service = commitmentStub();
  const result = await executeButlerTool(
    { id: 'p1', name: 'record_commitment', arguments: { text: '背单词' } },
    tools,
    {
      workspace: workspaceService,
      commitments: service,
      permissions: { web: true, write: false, shell: false },
      now: NOW_22
    }
  );
  expect(result.ok).toBe(false);
  expect(result.content).toContain('仅可查看');
});
