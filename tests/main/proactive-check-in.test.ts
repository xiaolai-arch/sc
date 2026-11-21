import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { ProactiveCheckInService } from '../../src/main/check-ins/proactive-check-in-service';
import { ConversationStore } from '../../src/main/conversations/conversation-store';
import { Scheduler, type SchedulerNotification } from '../../src/main/scheduler/scheduler';
import { createDefaultSettings } from '../../src/main/settings/defaults';
import type { AppSettings } from '../../src/shared/types';
import type { PracticeMistake, PracticeService } from '../../src/shared/practice';
import type {
  Workspace,
  WorkspaceService,
  WorkspaceSnapshot
} from '../../src/shared/workspace';

const NOW = new Date('2026-11-01T08:00:00.000Z');

const workspace: Workspace = {
  id: 'ws-exam',
  name: '考研',
  kind: 'exam',
  color: '#ef4444',
  goal: '2027 上岸',
  description: ''
};

const snapshot: WorkspaceSnapshot = {
  workspace,
  tasks: [
    {
      id: 't1',
      workspaceId: 'ws-exam',
      title: '极限基础',
      subject: '数学',
      durationMin: 45,
      acceptance: '完成 10 题',
      status: 'pending'
    }
  ],
  notes: [],
  memory: [],
  reminders: []
};

const workspaceService = {
  listWorkspaces: async () => [workspace],
  getWorkspaceSnapshot: async () => snapshot,
  getMemory: async () => [],
  createWorkspace: async () => workspace,
  createTask: async () => snapshot.tasks[0]!,
  createNote: async () => {
    throw new Error('not used');
  },
  updateWorkspaceTask: async () => snapshot.tasks[0]!,
  getReminders: async () => [],
  submitReview: async () => undefined
} as unknown as WorkspaceService;

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  const base = createDefaultSettings('/tmp/vault');
  return {
    ...base,
    ...overrides,
    notifications: { ...base.notifications, ...(overrides.notifications ?? {}) },
    budget: { ...base.budget, ...(overrides.budget ?? {}) }
  };
}

async function store(): Promise<{ dir: string; value: ConversationStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-check-in-'));
  return { dir, value: new ConversationStore(dir, { now: () => NOW }) };
}

function workspaceServiceFor(snapshots: WorkspaceSnapshot[]): WorkspaceService {
  return {
    listWorkspaces: async () => snapshots.map((entry) => entry.workspace),
    getWorkspaceSnapshot: async (id: string) => {
      const found = snapshots.find((entry) => entry.workspace.id === id);
      if (!found) throw new Error(`Workspace not found: ${id}`);
      return found;
    },
    getMemory: async () => [],
    createWorkspace: async () => snapshots[0]!.workspace,
    createTask: async () => snapshots[0]!.tasks[0]!,
    createNote: async () => {
      throw new Error('not used');
    },
    updateWorkspaceTask: async () => snapshots[0]!.tasks[0]!,
    getReminders: async () => [],
    submitReview: async () => undefined
  } as unknown as WorkspaceService;
}

test('creates a morning check-in and returns a generic notification', async () => {
  const { dir, value } = await store();
  try {
    const client = new FakeModelClient(['早上好。今天先做极限基础，做完告诉我。']);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: client,
      getSettings: async () => settings(),
      now: () => NOW
    });

    const notification = await service.check('morning', '2026-11-01');

    expect(notification).toMatchObject({
      kind: 'morning-plan',
      title: '阿咲想和你聊聊今天的进度',
      body: '今天还有 1 个任务没完成，点开看看。',
      conversationId: expect.any(String)
    });
    expect(client.calls[0]?.messages[0]?.content).toContain('极限基础');

    const summaries = await value.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      kind: 'check-in',
      title: '今天的检查 · 11-01'
    });
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages).toHaveLength(1);
    expect(conversation?.messages[0]).toMatchObject({
      role: 'assistant',
      text: '早上好。今天先做极限基础，做完告诉我。',
      source: 'check-in',
      trigger: 'morning'
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deduplicates the same trigger and respects the proactive budget', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () =>
        settings({ budget: { proactiveSessionsPerDay: 1, dailyTokens: 1000 } }),
      now: () => NOW
    });

    const morning = await service.check('morning', '2026-11-01');
    expect(morning).not.toBeNull();
    expect(await service.check('morning', '2026-11-01')).toBeNull();
    expect(await service.check('evening', '2026-11-01')).toBeNull();

    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages).toHaveLength(1);
    expect(conversation?.messages[0]?.trigger).toBe('morning');
    expect(conversation?.messages[0]?.text).toContain('早上好');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stops proactive checks once the daily token budget is used', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => settings({ budget: { proactiveSessionsPerDay: 4, dailyTokens: 1000 } }),
      getDailyTokensUsed: async () => 1000,
      now: () => NOW
    });

    expect(await service.check('morning', '2026-11-01')).toBeNull();
    expect(await value.list()).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a zero token limit pauses proactive checks', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => settings({ budget: { proactiveSessionsPerDay: 4, dailyTokens: 0 } }),
      getDailyTokensUsed: async () => 0,
      now: () => NOW
    });

    expect(await service.check('morning', '2026-11-01')).toBeNull();
    expect(await value.list()).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('does not block check-ins when the usage read fails', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => settings({ budget: { proactiveSessionsPerDay: 4, dailyTokens: 1000 } }),
      getDailyTokensUsed: async () => {
        throw new Error('unreadable');
      },
      now: () => NOW
    });

    expect(await service.check('morning', '2026-11-01')).not.toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('creates a weekly review conversation with its own title and notification', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => settings(),
      now: () => NOW
    });

    const notification = await service.check('weekly', '2026-11-01');

    expect(notification).toMatchObject({
      kind: 'weekly-review',
      scheduledTime: '20:00',
      conversationId: expect.any(String)
    });
    expect(notification?.body).not.toContain('极限基础');

    const summaries = await value.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ kind: 'check-in', title: '每周复盘 · 11-01' });
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages).toHaveLength(1);
    expect(conversation?.messages[0]).toMatchObject({
      role: 'assistant',
      source: 'check-in',
      trigger: 'weekly'
    });
    expect(conversation?.messages[0]?.text).toContain('下周');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('counts the daily cap across check-in conversations', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () =>
        settings({ budget: { proactiveSessionsPerDay: 1, dailyTokens: 1000 } }),
      now: () => NOW
    });

    expect(await service.check('morning', '2026-11-01')).not.toBeNull();
    // The weekly review gets its own conversation, but the daily allowance is
    // shared, so it must not slip past the cap after the morning check-in.
    expect(await service.check('weekly', '2026-11-01')).toBeNull();

    const summaries = await value.list();
    expect(summaries.map((summary) => summary.title)).toEqual(['今天的检查 · 11-01']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('keeps weekly reviews in their own conversation and deduplicates them', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () =>
        settings({ budget: { proactiveSessionsPerDay: 4, dailyTokens: 1000 } }),
      now: () => NOW
    });

    expect(await service.check('morning', '2026-11-01')).not.toBeNull();
    expect(await service.check('weekly', '2026-11-01')).not.toBeNull();
    expect(await service.check('weekly', '2026-11-01')).toBeNull();

    const summaries = await value.list();
    expect(summaries.map((summary) => summary.title).sort()).toEqual([
      '今天的检查 · 11-01',
      '每周复盘 · 11-01'
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('skips weekly reviews when notifications are disabled', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () =>
        settings({ notifications: { ...settings().notifications, enabled: false } }),
      now: () => NOW
    });

    expect(await service.check('weekly', '2026-11-01')).toBeNull();
    expect(await value.list()).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a Sunday 20:00 tick creates the weekly review conversation', async () => {
  const { dir, value } = await store();
  try {
    const weeklySettings = settings({
      notifications: {
        ...settings().notifications,
        morning: '23:50',
        evening: '23:55',
        weekly: '20:00'
      }
    });
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => weeklySettings,
      now: () => new Date(2026, 10, 1, 20, 0, 0)
    });
    const delivered: SchedulerNotification[] = [];
    const scheduler = new Scheduler({
      now: () => new Date(2026, 10, 1, 20, 0, 0),
      getSettings: async () => weeklySettings,
      notify: (notification) => {
        delivered.push(notification);
      },
      onCheckIn: (kind, date) => service.check(kind, date)
    });

    const result = await scheduler.tick();

    expect(result.delivered.map((notification) => notification.kind)).toEqual([
      'weekly-review'
    ]);
    expect(delivered[0]).toMatchObject({ kind: 'weekly-review', scheduledTime: '20:00' });
    const summaries = await value.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.title).toBe('每周复盘 · 11-01');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('excludes projects with check-in off from the prompt and notification', async () => {
  const { dir, value } = await store();
  try {
    const active = { ...workspace, id: 'ws-active', name: '考研', checkIn: 'daily' as const };
    const off = { ...workspace, id: 'ws-off', name: '英语', checkIn: 'off' as const };
    const snapshots: WorkspaceSnapshot[] = [
      {
        workspace: active,
        tasks: [{ ...snapshot.tasks[0]!, workspaceId: 'ws-active' }],
        notes: [],
        memory: [],
        reminders: []
      },
      {
        workspace: off,
        tasks: [
          { ...snapshot.tasks[0]!, id: 't2', workspaceId: 'ws-off', title: '外刊精读' }
        ],
        notes: [],
        memory: [
          { id: 'm2', workspaceId: 'ws-off', text: '英语记忆', source: 'review:2026-10-31' }
        ],
        reminders: []
      }
    ];
    const client = new FakeModelClient(['早上好，先做极限基础。']);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService: workspaceServiceFor(snapshots),
      modelClient: client,
      getSettings: async () => settings(),
      now: () => NOW
    });

    const notification = await service.check('morning', '2026-11-01');

    expect(notification?.body).toBe('今天还有 1 个任务没完成，点开看看。');
    const prompt = client.calls[0]?.messages[0]?.content ?? '';
    expect(prompt).toContain('极限基础');
    expect(prompt).not.toContain('外刊精读');
    expect(prompt).not.toContain('英语记忆');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('skips check-ins when every project is off', async () => {
  const { dir, value } = await store();
  try {
    const offA = { ...workspace, id: 'ws-a', name: '考研', checkIn: 'off' as const };
    const offB = { ...workspace, id: 'ws-b', name: '英语', checkIn: 'off' as const };
    const snapshots: WorkspaceSnapshot[] = [
      { workspace: offA, tasks: [], notes: [], memory: [], reminders: [] },
      { workspace: offB, tasks: [], notes: [], memory: [], reminders: [] }
    ];
    const client = new FakeModelClient(['should not be used']);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService: workspaceServiceFor(snapshots),
      modelClient: client,
      getSettings: async () => settings(),
      now: () => NOW
    });

    expect(await service.check('morning', '2026-11-01')).toBeNull();
    expect(client.calls).toHaveLength(0);
    expect(await value.list()).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('still creates a check-in when no projects exist', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService: workspaceServiceFor([]),
      modelClient: null,
      getSettings: async () => settings(),
      now: () => NOW
    });

    const notification = await service.check('morning', '2026-11-01');

    expect(notification).not.toBeNull();
    expect(notification?.body).toBe('点开看看今天的进度。');
    const summaries = await value.list();
    expect(summaries).toHaveLength(1);
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toContain('今天还没有安排任务');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('skips check-ins for the snoozed day and resumes the next day', async () => {
  const { dir, value } = await store();
  try {
    const snoozed = settings({
      notifications: { ...settings().notifications, snoozedUntil: '2026-11-01' }
    });
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => snoozed,
      now: () => NOW
    });

    expect(await service.check('morning', '2026-11-01')).toBeNull();
    expect(await service.check('weekly', '2026-11-01')).toBeNull();
    expect(await value.list()).toEqual([]);

    const nextDay = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => snoozed,
      now: () => new Date('2026-11-02T08:00:00.000Z')
    });
    expect(await nextDay.check('morning', '2026-11-02')).not.toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('skips check-ins when notifications are disabled', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () =>
        settings({ notifications: { ...settings().notifications, enabled: false } }),
      now: () => NOW
    });

    expect(await service.check('morning', '2026-11-01')).toBeNull();
    expect(await value.list()).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function mistake(workspaceId: string, due: string): PracticeMistake {
  return {
    id: `m-${workspaceId}-${due}`,
    workspaceId,
    setId: 'ps-1',
    questionId: `q-${due}`,
    prompt: '题目',
    options: ['A', 'B'],
    answer: 0,
    explanation: '',
    wrongCount: 1,
    correctStreak: 0,
    priority: 1,
    intervalDays: 1,
    due,
    status: 'active',
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-10-30T08:00:00.000Z',
    lastAnsweredAt: '2026-10-30T08:00:00.000Z'
  };
}

function practiceWith(due: PracticeMistake[]): PracticeService {
  return {
    listSets: async () => [],
    getSet: async () => null,
    createSet: async () => {
      throw new Error('not used');
    },
    submitAnswer: async () => {
      throw new Error('not used');
    },
    getMistakes: async () => due,
    getDue: async () => due,
    listAttempts: async () => []
  } as unknown as PracticeService;
}

test('appends one deterministic due-mistake line to the morning message', async () => {
  const { dir, value } = await store();
  try {
    const client = new FakeModelClient(['早上好。今天先做极限基础，做完告诉我。']);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: client,
      practiceService: practiceWith([mistake('ws-exam', '2026-11-01')]),
      getSettings: async () => settings(),
      now: () => NOW
    });

    const notification = await service.check('morning', '2026-11-01');

    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    const text = conversation?.messages[0]?.text ?? '';
    expect(text).toBe('早上好。今天先做极限基础，做完告诉我。\n今天有 1 道到期错题，抽 10 分钟过一遍。');
    // The surfaced body carries the same line so the OS banner matches.
    expect(notification?.body).toContain('今天有 1 道到期错题，抽 10 分钟过一遍。');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('leaves the morning message byte-identical when no mistake is due', async () => {
  const { dir, value } = await store();
  try {
    const client = new FakeModelClient(['早上好。今天先做极限基础，做完告诉我。']);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: client,
      practiceService: practiceWith([]),
      getSettings: async () => settings(),
      now: () => NOW
    });

    const notification = await service.check('morning', '2026-11-01');

    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe('早上好。今天先做极限基础，做完告诉我。');
    expect(notification?.body).toBe('今天还有 1 个任务没完成，点开看看。');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an unreadable practice service does not change the morning message', async () => {
  const { dir, value } = await store();
  try {
    const client = new FakeModelClient(['早上好。今天先做极限基础，做完告诉我。']);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: client,
      practiceService: {
        ...practiceWith([]),
        getDue: async () => {
          throw new Error('practice unreadable');
        }
      } as unknown as PracticeService,
      getSettings: async () => settings(),
      now: () => NOW
    });

    await service.check('morning', '2026-11-01');

    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe('早上好。今天先做极限基础，做完告诉我。');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the evening message never carries the due-mistake digest', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      practiceService: practiceWith([mistake('ws-exam', '2026-11-01')]),
      getSettings: async () => settings(),
      now: () => at(21, 30)
    });

    await service.check('evening', '2026-11-01');

    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text ?? '').not.toContain('到期错题');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function at(hour: number, minute: number): Date {
  return new Date(2026, 9, 31, hour, minute, 0);
}

const behindTask = (
  id: string,
  status: WorkspaceSnapshot['tasks'][0]['status']
): WorkspaceSnapshot['tasks'][0] => ({
  id,
  workspaceId: 'ws-exam',
  title: id === 't1' ? '数学真题' : '英语阅读',
  subject: '数学',
  durationMin: 45,
  acceptance: '',
  status,
  due: '2026-10-31'
});

function behindService(tasks: WorkspaceSnapshot['tasks']): WorkspaceService {
  const behind: WorkspaceSnapshot = { ...snapshot, tasks };
  return {
    ...workspaceServiceFor([behind]),
    listWorkspaces: async () => [behind.workspace],
    getWorkspaceSnapshot: async () => behind
  } as unknown as WorkspaceService;
}

test('creates a behind-schedule nudge naming the count and first task', async () => {
  const { dir, value } = await store();
  try {
    const tasks = [
      behindTask('t0', 'done'),
      { ...behindTask('t1', 'pending'), title: '数学真题' },
      behindTask('t2', 'pending')
    ];
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService: behindService(tasks),
      modelClient: null,
      getSettings: async () => settings(),
      now: () => at(20, 30)
    });

    const notification = await service.check('behind', '2026-10-31');

    expect(notification).toMatchObject({
      kind: 'behind-schedule',
      scheduledTime: '20:30',
      title: '今天有点落后，要调整一下吗？',
      body: '今天还有 2 个任务没完成，下一项是「数学真题」。要不要一起调整一下今天的安排？',
      conversationId: expect.any(String)
    });
    const summaries = await value.list();
    expect(summaries[0]).toMatchObject({ kind: 'check-in', title: '落后提醒 · 10-31' });
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe(
      '今天还有 2 个任务没完成，下一项是「数学真题」。要不要一起调整一下今天的安排？'
    );
    expect(conversation?.messages[0]?.trigger).toBe('behind');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the behind-schedule nudge is silent when the plan is on track or empty', async () => {
  const { dir, value } = await store();
  try {
    const onTrack = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService: behindService([
        behindTask('t0', 'done'),
        behindTask('t1', 'done'),
        behindTask('t2', 'pending')
      ]),
      modelClient: null,
      getSettings: async () => settings(),
      now: () => at(20, 30)
    });
    expect(await onTrack.check('behind', '2026-10-31')).toBeNull();

    const empty = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService: behindService([]),
      modelClient: null,
      getSettings: async () => settings(),
      now: () => at(20, 30)
    });
    expect(await empty.check('behind', '2026-10-31')).toBeNull();

    // A skipped nudge must not leave an empty "落后提醒" conversation behind.
    expect(await value.list()).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('respects snooze, disabled notifications and the daily cap for the behind nudge', async () => {
  const { dir, value } = await store();
  try {
    const tasks = [behindTask('t1', 'pending'), behindTask('t2', 'pending')];
    const snoozed = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService: behindService(tasks),
      modelClient: null,
      getSettings: async () =>
        settings({
          notifications: { ...settings().notifications, snoozedUntil: '2026-10-31' }
        }),
      now: () => at(20, 30)
    });
    expect(await snoozed.check('behind', '2026-10-31')).toBeNull();

    const disabled = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService: behindService(tasks),
      modelClient: null,
      getSettings: async () =>
        settings({ notifications: { ...settings().notifications, enabled: false } }),
      now: () => at(20, 30)
    });
    expect(await disabled.check('behind', '2026-10-31')).toBeNull();

    // The shared daily cap counts the behind nudge like any other check-in.
    const capped = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService: behindService(tasks),
      modelClient: null,
      getSettings: async () =>
        settings({ budget: { proactiveSessionsPerDay: 1, dailyTokens: 1000 } }),
      now: () => at(20, 30)
    });
    expect(await capped.check('behind', '2026-10-31')).not.toBeNull();
    expect(await capped.check('behind', '2026-10-31')).toBeNull();
    expect(await value.list()).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const WEEKLY_TEMPLATE =
  '周日好。花三分钟回顾一下这一周：完成了什么，卡在哪里，下周最重要的一件事是什么？说完我来帮你整理，并排下周的计划。';

const weeklyStats = {
  tasksDone: 3,
  tasksTotal: 5,
  focusMinutes: 135,
  answered: 6,
  correct: 5,
  reviewedDays: 4,
  dueMistakes: 2
};

test('grounds the weekly check-in prompt in the provided weekly numbers', async () => {
  const { dir, value } = await store();
  try {
    const client = new FakeModelClient(['这一周你完成了 3 个任务，专注 135 分钟。']);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: client,
      getWeeklyOverview: async (today) => {
        // The provider is keyed to the check-in's own date, not the wall clock.
        expect(today.getDate()).toBe(1);
        return weeklyStats;
      },
      getSettings: async () => settings(),
      now: () => NOW
    });

    const notification = await service.check('weekly', '2026-11-01');

    const prompt = client.calls[0]?.messages[0]?.content ?? '';
    expect(prompt).toContain('本周数据：');
    expect(prompt).toContain('- 任务完成：3/5 个');
    expect(prompt).toContain('- 专注：135 分钟');
    expect(prompt).toContain('- 练习：6 题，答对 5 题（正确率 83%）');
    expect(prompt).toContain('- 复盘：4 天');
    expect(prompt).toContain('- 到期错题：2 道');
    expect(prompt).toContain('用上面的本周数据具体肯定进展、点名薄弱处');
    // The weekly notification body itself is unchanged; only the message is recapped.
    expect(notification?.body).toBe('周日复盘时间到了，点开回顾本周并安排下周。');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('prepends the deterministic recap line to the weekly template', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getWeeklyOverview: async () => weeklyStats,
      getSettings: async () => settings(),
      now: () => NOW
    });

    await service.check('weekly', '2026-11-01');

    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe(
      `本周完成 3 个任务 · 专注 135 分钟 · 正确率 83%\n${WEEKLY_TEMPLATE}`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('keeps the weekly message byte-identical when the provider fails', async () => {
  const { dir, value } = await store();
  try {
    const client = new FakeModelClient(['周日好，回顾一下这一周。']);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: client,
      getWeeklyOverview: async () => {
        throw new Error('vault unreadable');
      },
      getSettings: async () => settings(),
      now: () => NOW
    });

    const notification = await service.check('weekly', '2026-11-01');

    expect(notification).not.toBeNull();
    // The model still runs, but with the pre-stats prompt.
    const prompt = client.calls[0]?.messages[0]?.content ?? '';
    expect(prompt).not.toContain('本周数据：');
    expect(prompt).toContain('先肯定这一周的投入，再请用户回顾本周末完成与卡点');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('keeps the weekly message byte-identical when no stats provider is wired', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => settings(),
      now: () => NOW
    });

    await service.check('weekly', '2026-11-01');

    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe(WEEKLY_TEMPLATE);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('keeps the weekly message unchanged for an all-zero week', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getWeeklyOverview: async () => ({
        tasksDone: 0,
        tasksTotal: 0,
        focusMinutes: 0,
        answered: 0,
        correct: 0,
        reviewedDays: 0,
        dueMistakes: 0
      }),
      getSettings: async () => settings(),
      now: () => NOW
    });

    await service.check('weekly', '2026-11-01');

    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe(WEEKLY_TEMPLATE);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the morning check-in never reads weekly stats', async () => {
  const { dir, value } = await store();
  try {
    let called = false;
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getWeeklyOverview: async () => {
        called = true;
        return weeklyStats;
      },
      getSettings: async () => settings(),
      now: () => NOW
    });

    await service.check('morning', '2026-11-01');

    expect(called).toBe(false);
    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe(
      '早上好。今天有 1 个任务，先做「极限基础」怎么样？做完告诉我一声。'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
