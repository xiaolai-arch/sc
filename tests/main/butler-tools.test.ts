import {
  createButlerTools,
  executeButlerTool,
  ToolInputError
} from '../../src/main/butler/tools';
import type { KnowledgeService } from '../../src/shared/knowledge';
import type { ProfileService } from '../../src/shared/profile';
import type {
  CreatePracticeSetInput,
  PracticeService,
  PracticeSet
} from '../../src/shared/practice';
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
    expect.objectContaining({ workspaceId: 'ws-exam', title: '极限小测', subject: '数学' })
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
