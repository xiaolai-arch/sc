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
  buildTemplatePlan,
  createWorkspacePlanner,
  parseWorkspacePlanReply
} from '../../src/main/planning';

const NOW = new Date(2026, 10, 1, 9, 30, 0);

const WORKSPACE: Workspace = {
  id: 'ws-exam',
  name: '考研',
  kind: 'exam',
  color: '#ef4444',
  goal: '2027 考研上岸，数学 130，英语 70，整理错题',
  description: '每天推进一点'
};

const NOTES: WorkspaceNote[] = [
  {
    id: 'n1',
    workspaceId: 'ws-exam',
    title: '极限错题整理',
    subject: '数学',
    tags: ['错题'],
    updated: '2026-10-31',
    summary: '等价无穷小仍有混淆',
    body: '记录了几道极限错题',
    related: []
  },
  {
    id: 'n2',
    workspaceId: 'ws-exam',
    title: '英语阅读复盘',
    subject: '英语',
    tags: [],
    updated: '2026-10-30',
    summary: '长难句定位慢',
    body: '',
    related: []
  }
];

const MEMORY: MemoryItem[] = [
  { id: 'm1', workspaceId: 'ws-exam', text: '晚上效率更高', source: '2026-10-30 复盘' }
];

class FakeWorkspaceService implements WorkspaceService {
  constructor(private readonly snapshot: WorkspaceSnapshot) {}

  async getWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
    if (workspaceId !== this.snapshot.workspace.id) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return this.snapshot;
  }

  async listWorkspaces(): Promise<Workspace[]> {
    return [this.snapshot.workspace];
  }

  async createWorkspace(_input: CreateWorkspaceInput): Promise<Workspace> {
    throw new Error('not used');
  }

  async createTask(_input: CreateTaskInput): Promise<WorkspaceTask> {
    throw new Error('not used');
  }

  async updateWorkspaceTask(_input: UpdateWorkspaceTaskInput): Promise<WorkspaceTask> {
    throw new Error('not used');
  }

  async createNote(_input: CreateNoteInput): Promise<WorkspaceNote> {
    throw new Error('not used');
  }

  async updateNote(_input: UpdateWorkspaceNoteInput): Promise<WorkspaceNote> {
    throw new Error('not used');
  }

  async getMemory(_workspaceId?: string): Promise<MemoryItem[]> {
    return MEMORY;
  }

  async getReminders(): Promise<Reminder[]> {
    return [];
  }

  async submitReview(_input: SubmitReviewInput): Promise<void> {
    throw new Error('not used');
  }
}

function makeWorkspaceService(overrides: Partial<Workspace> = {}): FakeWorkspaceService {
  return new FakeWorkspaceService({
    workspace: { ...WORKSPACE, ...overrides },
    tasks: [],
    notes: NOTES,
    memory: MEMORY,
    reminders: []
  });
}

function joinPrompt(client: FakeModelClient, callIndex = 0): string {
  return (client.calls[callIndex]?.messages ?? [])
    .map((message) => message.content)
    .join('\n');
}

describe('WorkspacePlanner', () => {
  test('returns a validated agent plan and includes recent context in the prompt', async () => {
    const client = new FakeModelClient([
      JSON.stringify({
        tasks: [
          {
            title: ' 极限错题二刷 ',
            subject: ' 数学 ',
            durationMin: 50,
            acceptance: ' 完成 10 道错题并订正 '
          },
          {
            title: '背单词',
            subject: '英语',
            durationMin: 30,
            acceptance: '复习 50 个单词'
          }
        ]
      })
    ]);
    const planner = createWorkspacePlanner({
      modelClient: client,
      workspaceService: makeWorkspaceService(),
      now: () => NOW
    });

    const plan = await planner.plan({
      workspaceId: 'ws-exam',
      date: '2026-11-01',
      availableMinutes: 90
    });

    expect(plan).toEqual({
      workspaceId: 'ws-exam',
      date: '2026-11-01',
      generatedBy: 'agent',
      tasks: [
        {
          title: '极限错题二刷',
          subject: '数学',
          durationMin: 50,
          acceptance: '完成 10 道错题并订正'
        },
        {
          title: '背单词',
          subject: '英语',
          durationMin: 30,
          acceptance: '复习 50 个单词'
        }
      ]
    });
    expect(client.calls).toHaveLength(1);

    const prompt = joinPrompt(client);
    expect(prompt).toContain('工作区目标：2027 考研上岸');
    expect(prompt).toContain('极限错题整理');
    expect(prompt).toContain('等价无穷小仍有混淆');
    expect(prompt).toContain('晚上效率更高');
    expect(prompt).toContain('今天：2026-11-01');
    expect(prompt).toContain('90 分钟');
    expect(prompt).toContain('只输出一个 JSON 对象');
    expect(prompt).toContain('"tasks"');
  });

  test('parses fenced JSON surrounded by prose', async () => {
    const client = new FakeModelClient([
      [
        '好的，这是今天的安排：',
        '```json',
        JSON.stringify({
          tasks: [
            {
              title: '阅读真题',
              subject: '英语',
              durationMin: 40,
              acceptance: '完成一篇阅读并复盘错因'
            }
          ]
        }),
        '```',
        '先从阅读开始。'
      ].join('\n')
    ]);
    const planner = createWorkspacePlanner({
      modelClient: client,
      workspaceService: makeWorkspaceService(),
      now: () => NOW
    });

    const plan = await planner.plan({ workspaceId: 'ws-exam', date: '2026-11-01' });

    expect(plan.generatedBy).toBe('agent');
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]?.title).toBe('阅读真题');
  });

  test.each([
    ['prose', '今天先做数学吧，别想太多。'],
    ['empty reply', '   '],
    ['empty task list', '{"tasks":[]}'],
    ['truncated JSON', '{"tasks":[{"title":"极限","subject":"数学","durationMin":45'],
    ['tasks that are not an array', '{"tasks":"数学"}']
  ])('falls back to a template plan for %s', async (_label, reply) => {
    const client = new FakeModelClient([reply]);
    const planner = createWorkspacePlanner({
      modelClient: client,
      workspaceService: makeWorkspaceService(),
      now: () => NOW
    });

    const plan = await planner.plan({
      workspaceId: 'ws-exam',
      date: '2026-11-01',
      availableMinutes: 60
    });

    expect(client.calls).toHaveLength(1);
    expect(plan.generatedBy).toBe('template');
    expect(plan.workspaceId).toBe('ws-exam');
    expect(plan.date).toBe('2026-11-01');
    expect(plan.tasks).toHaveLength(4);
    expect(plan.tasks.map((task) => task.title)).toEqual([
      '2027 考研上岸',
      '数学 130',
      '英语 70',
      '整理错题'
    ]);
    expect(plan.tasks.every((task) => task.subject === '考研')).toBe(true);
    expect(plan.tasks.reduce((total, task) => total + task.durationMin, 0)).toBe(60);
    expect(plan.tasks.every((task) => task.acceptance.length > 0)).toBe(true);
  });

  test('falls back to the template when the model throws', async () => {
    const planner = createWorkspacePlanner({
      modelClient: new FakeModelClient([new Error('model unavailable')]),
      workspaceService: makeWorkspaceService(),
      now: () => NOW
    });

    const plan = await planner.plan({ workspaceId: 'ws-exam', date: '2026-11-01' });

    expect(plan.generatedBy).toBe('template');
    expect(plan.tasks.length).toBeGreaterThan(0);
  });

  test('uses the template without calling a model when no client is configured', async () => {
    const planner = createWorkspacePlanner({
      modelClient: null,
      workspaceService: makeWorkspaceService({ goal: '' }),
      now: () => NOW
    });

    const plan = await planner.plan({ workspaceId: 'ws-exam', availableMinutes: 30 });

    expect(plan.generatedBy).toBe('template');
    expect(plan.date).toBe('2026-11-01');
    expect(plan.tasks).toEqual([
      {
        title: '每天推进一点',
        subject: '考研',
        durationMin: 30,
        acceptance: '完成「每天推进一点」并记录结果'
      }
    ]);
  });

  test('defaults to today and 120 minutes in the prompt', async () => {
    const client = new FakeModelClient([
      '{"tasks":[{"title":"复盘","subject":"数学","durationMin":30,"acceptance":"写下错因"}]}'
    ]);
    const planner = createWorkspacePlanner({
      modelClient: client,
      workspaceService: makeWorkspaceService(),
      now: () => NOW
    });

    const plan = await planner.plan({ workspaceId: 'ws-exam' });

    expect(plan.date).toBe('2026-11-01');
    expect(joinPrompt(client)).toContain('120 分钟');
  });

  test('rejects an invalid explicit date', async () => {
    const planner = createWorkspacePlanner({
      modelClient: null,
      workspaceService: makeWorkspaceService()
    });

    await expect(planner.plan({ workspaceId: 'ws-exam', date: '11/01/2026' })).rejects.toThrow(
      'Invalid plan date'
    );
  });
});

describe('parseWorkspacePlanReply', () => {
  test('accepts a bare JSON array and normalizes numeric strings', () => {
    const plan = parseWorkspacePlanReply(
      '[{"title":"阅读","subject":"英语","durationMin":"30","acceptance":"完成一篇"}]',
      'ws-exam',
      '2026-11-01'
    );

    expect(plan).toMatchObject({
      workspaceId: 'ws-exam',
      date: '2026-11-01',
      generatedBy: 'agent',
      tasks: [
        { title: '阅读', subject: '英语', durationMin: 30, acceptance: '完成一篇' }
      ]
    });
  });

  test('drops invalid and duplicate tasks and clamps durations', () => {
    const plan = parseWorkspacePlanReply(
      JSON.stringify({
        tasks: [
          { title: '极限', subject: '数学', durationMin: '30', acceptance: '完成 10 题' },
          { title: '', subject: '数学', durationMin: 20, acceptance: '完成' },
          { title: '无验收', subject: '数学', durationMin: 20 },
          { title: '负时长', subject: '数学', durationMin: -3, acceptance: '完成' },
          { title: '太短', subject: '数学', durationMin: 2, acceptance: '完成' },
          { title: '太长', subject: '英语', durationMin: 9999, acceptance: '完成' },
          { title: '极限', subject: '数学', durationMin: 45, acceptance: '重复任务' }
        ]
      }),
      'ws-exam',
      '2026-11-01'
    );

    expect(plan?.tasks).toEqual([
      { title: '极限', subject: '数学', durationMin: 30, acceptance: '完成 10 题' },
      { title: '太短', subject: '数学', durationMin: 5, acceptance: '完成' },
      { title: '太长', subject: '英语', durationMin: 600, acceptance: '完成' }
    ]);
  });

  test('keeps at most five tasks', () => {
    const plan = parseWorkspacePlanReply(
      JSON.stringify({
        tasks: Array.from({ length: 7 }, (_value, index) => ({
          title: `任务 ${index + 1}`,
          subject: '数学',
          durationMin: 15,
          acceptance: `完成 ${index + 1}`
        }))
      }),
      'ws-exam',
      '2026-11-01'
    );

    expect(plan?.tasks).toHaveLength(5);
    expect(plan?.tasks.map((task) => task.title)).toEqual([
      '任务 1',
      '任务 2',
      '任务 3',
      '任务 4',
      '任务 5'
    ]);
  });

  test.each([
    ['prose', '先做数学。'],
    ['empty', ''],
    ['invalid JSON', '{"tasks":['],
    ['no tasks field', '{"plan":[]}'],
    ['all tasks invalid', '{"tasks":[{"title":"","subject":"","durationMin":0}]}']
  ])('returns null for %s', (_label, reply) => {
    expect(parseWorkspacePlanReply(reply, 'ws-exam', '2026-11-01')).toBeNull();
  });
});

describe('buildTemplatePlan', () => {
  test('caps goals at five tasks, dedupes clauses, and respects available time', () => {
    const plan = buildTemplatePlan({
      workspace: {
        ...WORKSPACE,
        goal: '数学、英语、数学、政治、专业课、复盘、运动'
      },
      date: '2026-11-01',
      availableMinutes: 50
    });

    expect(plan.generatedBy).toBe('template');
    expect(plan.tasks.map((task) => task.title)).toEqual([
      '数学',
      '英语',
      '政治',
      '专业课',
      '复盘'
    ]);
    expect(plan.tasks.reduce((total, task) => total + task.durationMin, 0)).toBe(50);
  });
});

test('passes the abort signal to the planning model call', async () => {
  const client = new FakeModelClient([
    '{"tasks":[{"title":"极限","subject":"数学","durationMin":30,"acceptance":"完成"}]}'
  ]);
  const planner = createWorkspacePlanner({
    modelClient: client,
    workspaceService: makeWorkspaceService(),
    now: () => NOW
  });
  const controller = new AbortController();

  await planner.plan({ workspaceId: 'ws-exam', signal: controller.signal });

  expect(client.calls[0]?.signal).toBe(controller.signal);
});

test('does not fall back to a template plan after abort', async () => {
  const client = new FakeModelClient(['{"tasks":[]}']);
  const planner = createWorkspacePlanner({
    modelClient: client,
    workspaceService: makeWorkspaceService(),
    now: () => NOW
  });
  const controller = new AbortController();
  controller.abort();

  await expect(
    planner.plan({ workspaceId: 'ws-exam', signal: controller.signal })
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(client.calls).toHaveLength(0);
});
