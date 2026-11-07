import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { ProactiveCheckInService } from '../../src/main/check-ins/proactive-check-in-service';
import { ConversationStore } from '../../src/main/conversations/conversation-store';
import { Scheduler, type SchedulerNotification } from '../../src/main/scheduler/scheduler';
import { createDefaultSettings } from '../../src/main/settings/defaults';
import type { AppSettings } from '../../src/shared/types';
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

test('deduplicates weekly reviews and keeps them separate from daily check-ins', async () => {
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
