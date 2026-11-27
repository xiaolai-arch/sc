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
  parseWorkspacePlanReply,
  BUSY_DAY_MINUTES
} from '../../src/main/planning';
import { parseJsonLenient } from '../../src/main/planning/parse';

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
      availableMinutes: 90,
      availableMinutesSource: 'input',
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
    expect(prompt).toContain('项目目标：2027 考研上岸');
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

describe('week availability minutes', () => {
  test('an explicit input still beats a packed-day budget', async () => {
    const planner = createWorkspacePlanner({
      modelClient: null,
      workspaceService: makeWorkspaceService({ availableMinutes: 45 })
    });

    const plan = await planner.plan({
      workspaceId: 'ws-exam',
      availableMinutes: 90,
      weekAvailabilityMinutes: BUSY_DAY_MINUTES
    });

    expect(plan.availableMinutes).toBe(90);
    expect(plan.availableMinutesSource).toBe('input');
  });

  test('a packed-day budget beats the workspace setting and carries its own label', async () => {
    const planner = createWorkspacePlanner({
      modelClient: null,
      workspaceService: makeWorkspaceService({ availableMinutes: 45 })
    });

    const plan = await planner.plan({
      workspaceId: 'ws-exam',
      weekAvailabilityMinutes: BUSY_DAY_MINUTES
    });

    expect(plan.availableMinutes).toBe(BUSY_DAY_MINUTES);
    expect(plan.availableMinutesSource).toBe('week');
  });

  test('without a packed-day budget the workspace setting and default still apply', async () => {
    const withSetting = await createWorkspacePlanner({
      modelClient: null,
      workspaceService: makeWorkspaceService({ availableMinutes: 45 })
    }).plan({ workspaceId: 'ws-exam' });
    expect(withSetting.availableMinutesSource).toBe('workspace');

    const withoutSetting = await createWorkspacePlanner({
      modelClient: null,
      workspaceService: makeWorkspaceService()
    }).plan({ workspaceId: 'ws-exam' });
    expect(withoutSetting.availableMinutes).toBe(120);
    expect(withoutSetting.availableMinutesSource).toBe('default');
  });

  test('only a week day prompt names the source and adds the one-small-task line', async () => {
    const client = new FakeModelClient(['{"tasks":[]}']);
    const planner = createWorkspacePlanner({
      modelClient: client,
      workspaceService: makeWorkspaceService()
    });

    await planner.plan({
      workspaceId: 'ws-exam',
      date: '2026-11-01',
      weekAvailabilityMinutes: BUSY_DAY_MINUTES
    });

    const prompt = joinPrompt(client);
    expect(prompt).toContain('今日可用时间：约 10 分钟（来自你说的一周安排）');
    expect(prompt).toContain(
      '这天用户说特别满：只安排 1 个不超过 10 分钟的小任务，不要凑满时间。'
    );
  });

  test('other sources keep the prompt free of the packed-day line', async () => {
    const client = new FakeModelClient(['{"tasks":[]}']);
    const planner = createWorkspacePlanner({
      modelClient: client,
      workspaceService: makeWorkspaceService({ availableMinutes: 45 })
    });

    await planner.plan({ workspaceId: 'ws-exam', date: '2026-11-01' });

    const prompt = joinPrompt(client);
    expect(prompt).toContain('今日可用时间：约 45 分钟（来自项目设置的每天可用时间）');
    expect(prompt).not.toContain('来自你说的一周安排');
    expect(prompt).not.toContain('这天用户说特别满');
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

  test('parses a reply with a raw line break inside a string', () => {
    const plan = parseWorkspacePlanReply(
      `{"tasks":[{"title":"错题整理
第二步：重做","subject":"数学","durationMin":30,"acceptance":"完成"}]}`,
      'ws-exam',
      '2026-11-01'
    );
    expect(plan?.tasks[0]?.title).toBe('错题整理\n第二步：重做');
  });

  test('parses a reply with trailing commas and a cut-off tail', () => {
    const plan = parseWorkspacePlanReply(
      '{"tasks":[{"title":"背单词","subject":"英语","durationMin":20,"acceptance":"完成",}],"meta":{"date":"2026-11-01"',
      'ws-exam',
      '2026-11-01'
    );
    expect(plan?.tasks).toHaveLength(1);
    expect(plan?.tasks[0]?.title).toBe('背单词');
  });

  test('parseJsonLenient repairs control characters, trailing commas and truncation', () => {
    expect(parseJsonLenient('{"a":"第一行\n第二行","b":[1,2,]}')).toEqual({
      a: '第一行\n第二行',
      b: [1, 2]
    });
    expect(parseJsonLenient('{"list":["x","y"')).toEqual({ list: ['x', 'y'] });
    expect(parseJsonLenient('not json at all')).toBeNull();
    expect(parseJsonLenient('{"a":1}')).toEqual({ a: 1 });
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

describe('past-7-day completion lines', () => {
  const REPLY =
    '{"tasks":[{"title":"复盘","subject":"数学","durationMin":30,"acceptance":"写下错因"}]}';

  function serviceWithTasks(tasks: WorkspaceTask[]): FakeWorkspaceService {
    return new FakeWorkspaceService({
      workspace: WORKSPACE,
      tasks,
      notes: NOTES,
      memory: MEMORY,
      reminders: []
    });
  }

  // Plan date defaults to NOW = 2026-11-01, so the window is
  // [2026-10-26, 2026-11-01].
  function dated(offsetDays: number): string {
    const date = new Date(2026, 10, 1 + offsetDays);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function task(id: string, due: string, status: WorkspaceTask['status']): WorkspaceTask {
    return {
      id,
      workspaceId: 'ws-exam',
      title: `任务 ${id}`,
      subject: '数学',
      durationMin: 30,
      acceptance: '完成',
      status,
      due
    };
  }

  test('a low completion rate adds the fact line and the code-computed compression line', async () => {
    const client = new FakeModelClient([REPLY]);
    const planner = createWorkspacePlanner({
      modelClient: client,
      // Default budget (120 minutes): 2 of 5 done = 40% → 48 → 50 minutes.
      workspaceService: serviceWithTasks([
        task('a', dated(-4), 'done'),
        task('b', dated(-3), 'done'),
        task('c', dated(-2), 'pending'),
        task('d', dated(-1), 'pending'),
        task('f', dated(0), 'pending'),
        task('e', dated(0), 'skipped')
      ]),
      now: () => NOW
    });

    await planner.plan({ workspaceId: 'ws-exam' });

    const prompt = joinPrompt(client);
    expect(prompt).toContain('过去 7 天：安排 5 项，完成 2 项（40%）。');
    expect(prompt).toContain(
      '完成率偏低：请把今天的任务总量压到约 50 分钟（按过去 7 天完成率 40% × 可用 120 分钟），宁可少排，不要排满。'
    );
  });

  test('the compression line carries the 15-minute floor', async () => {
    const client = new FakeModelClient([REPLY]);
    const planner = createWorkspacePlanner({
      modelClient: client,
      workspaceService: serviceWithTasks([
        task('a', dated(-2), 'done'),
        task('b', dated(-1), 'pending'),
        task('c', dated(-1), 'pending'),
        task('d', dated(0), 'pending'),
        task('e', dated(0), 'pending')
      ]),
      now: () => NOW
    });

    // 1 of 5 done = 20%; 30 × 20% = 6 minutes → floored to 15.
    await planner.plan({ workspaceId: 'ws-exam', availableMinutes: 30 });

    expect(joinPrompt(client)).toContain(
      '完成率偏低：请把今天的任务总量压到约 15 分钟（按过去 7 天完成率 20% × 可用 30 分钟），宁可少排，不要排满。'
    );
  });

  test('the compression line rounds the budget to 5 minutes', async () => {
    // 13 of 25 done = 52%; 100 × 52% = 52 minutes → rounded to 50.
    const tasks = Array.from({ length: 25 }, (_value, index) =>
      task(`t${index}`, dated(-((index % 6) + 1)), index < 13 ? 'done' : 'pending')
    );
    const client = new FakeModelClient([REPLY]);
    const planner = createWorkspacePlanner({
      modelClient: client,
      workspaceService: serviceWithTasks(tasks),
      now: () => NOW
    });

    await planner.plan({ workspaceId: 'ws-exam', availableMinutes: 100 });

    expect(joinPrompt(client)).toContain('过去 7 天：安排 25 项，完成 13 项（52%）。');
    expect(joinPrompt(client)).toContain(
      '完成率偏低：请把今天的任务总量压到约 50 分钟（按过去 7 天完成率 52% × 可用 100 分钟），宁可少排，不要排满。'
    );
  });

  test('a rate of 60 or more keeps the fact line and drops the compression line', async () => {
    const client = new FakeModelClient([REPLY]);
    const planner = createWorkspacePlanner({
      modelClient: client,
      workspaceService: serviceWithTasks([
        task('a', dated(-4), 'done'),
        task('b', dated(-3), 'done'),
        task('c', dated(-2), 'done'),
        task('d', dated(-1), 'done'),
        task('e', dated(0), 'pending')
      ]),
      now: () => NOW
    });

    await planner.plan({ workspaceId: 'ws-exam' });

    const prompt = joinPrompt(client);
    expect(prompt).toContain('过去 7 天：安排 5 项，完成 4 项（80%）。');
    expect(prompt).not.toContain('完成率偏低');
  });

  test('below the five-item sample the prompt is byte-identical to the no-sample prompt', async () => {
    const client = new FakeModelClient([REPLY]);
    const planner = createWorkspacePlanner({
      modelClient: client,
      // Only four dated tasks in the window → no sample.
      workspaceService: serviceWithTasks([
        task('a', dated(-4), 'done'),
        task('b', dated(-3), 'done'),
        task('c', dated(-2), 'done'),
        task('d', dated(-1), 'done')
      ]),
      now: () => NOW
    });
    const baselineClient = new FakeModelClient([REPLY]);
    const baselinePlanner = createWorkspacePlanner({
      modelClient: baselineClient,
      workspaceService: makeWorkspaceService(),
      now: () => NOW
    });

    await planner.plan({ workspaceId: 'ws-exam' });
    await baselinePlanner.plan({ workspaceId: 'ws-exam' });

    expect(joinPrompt(client)).toBe(joinPrompt(baselineClient));
    expect(joinPrompt(client)).not.toContain('过去 7 天');
  });

  test('the completion lines sit after the countdown and before the recent notes', async () => {
    const client = new FakeModelClient([REPLY]);
    const planner = createWorkspacePlanner({
      modelClient: client,
      workspaceService: new FakeWorkspaceService({
        workspace: { ...WORKSPACE, targetDate: '2027-06-01' },
        tasks: [
          task('a', dated(-4), 'done'),
          task('b', dated(-3), 'done'),
          task('c', dated(-2), 'pending'),
          task('d', dated(-1), 'pending'),
          task('e', dated(0), 'pending')
        ],
        notes: [],
        memory: [],
        reminders: []
      }),
      now: () => NOW
    });

    await planner.plan({ workspaceId: 'ws-exam' });

    const lines = joinPrompt(client).split('\n');
    const countdownAt = lines.findIndex((line) => line.startsWith('目标日期：'));
    const completionAt = lines.findIndex((line) => line.startsWith('过去 7 天：'));
    expect(countdownAt).toBeGreaterThan(-1);
    // The fact line lands right after the two countdown lines; the
    // compression line follows immediately; then the notes section.
    expect(completionAt).toBe(countdownAt + 2);
    expect(lines[completionAt + 1]).toContain('完成率偏低');
    expect(lines[completionAt + 2]).toBe('最近记录：暂无。');
  });

  test('the window ends on the plan date, matching the prompt frame of today', async () => {
    const client = new FakeModelClient([REPLY]);
    const planner = createWorkspacePlanner({
      modelClient: client,
      workspaceService: serviceWithTasks([
        task('a', '2026-11-14', 'done'),
        task('b', '2026-11-15', 'done'),
        task('c', '2026-11-17', 'done'),
        task('d', '2026-11-19', 'pending'),
        task('e', '2026-11-20', 'pending'),
        // Due before the window: invisible either way.
        task('old', '2026-10-20', 'done'),
        task('old2', '2026-10-25', 'done')
      ]),
      now: () => NOW
    });

    // Planning for 2026-11-20 while "now" is 2026-11-01: the window is
    // [2026-11-14, 2026-11-20] — 60% keeps the fact line only.
    await planner.plan({ workspaceId: 'ws-exam', date: '2026-11-20' });

    expect(joinPrompt(client)).toContain('过去 7 天：安排 5 项，完成 3 项（60%）。');
    expect(joinPrompt(client)).not.toContain('完成率偏低');
  });

  test('the template path never sees the completion data', async () => {
    const withTasks = await createWorkspacePlanner({
      modelClient: null,
      workspaceService: serviceWithTasks([
        task('a', dated(-4), 'done'),
        task('b', dated(-4), 'done'),
        task('c', dated(-3), 'pending'),
        task('d', dated(-2), 'pending'),
        task('e', dated(-1), 'pending')
      ]),
      now: () => NOW
    }).plan({ workspaceId: 'ws-exam', date: '2026-11-01', availableMinutes: 90 });
    const withoutTasks = await createWorkspacePlanner({
      modelClient: null,
      workspaceService: makeWorkspaceService(),
      now: () => NOW
    }).plan({ workspaceId: 'ws-exam', date: '2026-11-01', availableMinutes: 90 });

    expect(withTasks.generatedBy).toBe('template');
    expect(withTasks).toEqual(withoutTasks);
  });
});
