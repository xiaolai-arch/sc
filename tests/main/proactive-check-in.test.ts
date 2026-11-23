import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { ProactiveCheckInService } from '../../src/main/check-ins/proactive-check-in-service';
import type { ResumeFacts } from '../../src/main/check-ins/prompt';
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

test('skips check-ins through the snoozed date and resumes the next day', async () => {
  const { dir, value } = await store();
  try {
    const snoozed = settings({
      notifications: { ...settings().notifications, snoozedUntil: '2026-11-03' }
    });
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => snoozed,
      now: () => NOW
    });

    // Every day up to and including the stored date is muted.
    expect(await service.check('morning', '2026-11-01')).toBeNull();
    expect(await service.check('weekly', '2026-11-01')).toBeNull();
    expect(await service.check('morning', '2026-11-02')).toBeNull();
    expect(await service.check('evening', '2026-11-03')).toBeNull();
    expect(await value.list()).toEqual([]);

    // The day after the stored date the checks resume.
    const nextDay = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => snoozed,
      now: () => new Date('2026-11-04T08:00:00.000Z')
    });
    expect(await nextDay.check('morning', '2026-11-04')).not.toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an empty or past snooze date mutes nothing', async () => {
  const { dir, value } = await store();
  try {
    const empty = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () =>
        settings({ notifications: { ...settings().notifications, snoozedUntil: '' } }),
      now: () => NOW
    });
    expect(await empty.check('morning', '2026-11-01')).not.toBeNull();
    expect((await value.list()).length).toBeGreaterThan(0);

    const past = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () =>
        settings({ notifications: { ...settings().notifications, snoozedUntil: '2026-10-20' } }),
      now: () => NOW
    });
    expect(await past.check('evening', '2026-11-01')).not.toBeNull();
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

// --- the mute-resume sentence -------------------------------------------------

/**
 * The same peek/consume pair `createAppContext` wires up: peek reports the
 * pending resume (a manual `resumedFrom` first, then an expired
 * `snoozedUntil`), consume spends it in the settings object. An early manual
 * resume carries the cut-short mute's last day as `muteEnd`, exactly as the
 * real peek does when `resumedFromMuteEnd` is present.
 */
function resumePair(notifications: AppSettings['notifications'], today: () => string) {
  let consumed = 0;
  return {
    consumed: () => consumed,
    getResume: async (): Promise<ResumeFacts | null> => {
      const day = today();
      if (notifications.resumedFrom && notifications.resumedFrom <= day) {
        const muteEnd = notifications.resumedFromMuteEnd;
        if (muteEnd && muteEnd > notifications.resumedFrom) {
          return { day: notifications.resumedFrom, muteEnd };
        }
        return { day: notifications.resumedFrom };
      }
      if (notifications.snoozedUntil && notifications.snoozedUntil < day) {
        return { day: notifications.snoozedUntil };
      }
      return null;
    },
    consumeResume: async (): Promise<void> => {
      consumed += 1;
      if (notifications.resumedFrom) delete notifications.resumedFrom;
      else if (notifications.snoozedUntil) notifications.snoozedUntil = '';
      if (notifications.resumedFromMuteEnd) delete notifications.resumedFromMuteEnd;
    }
  };
}

test('the first check after a mute ends says the sentence exactly once, template path', async () => {
  const { dir, value } = await store();
  try {
    const notifications = { ...settings().notifications, snoozedUntil: '2026-11-03' };
    let today = '2026-11-04';
    const pair = resumePair(notifications, () => today);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => settings({ notifications }),
      ...pair,
      now: () => NOW
    });

    // A still-muted day stays silent and never spends the resume.
    expect(await service.check('morning', '2026-11-03')).toBeNull();
    expect(pair.consumed()).toBe(0);

    // The first allowed day: the template message ends with the one sentence.
    const morning = await service.check('morning', '2026-11-04');
    expect(morning).not.toBeNull();
    const summaries = await value.list();
    expect(summaries).toHaveLength(1);
    const conversation = await value.get(summaries[0]!.id);
    const text = conversation!.messages[0]!.text;
    expect(text.endsWith('你之前暂停到 11月3日，今天是恢复的第一天。')).toBe(true);
    expect(text.split('今天是恢复的第一天')).toHaveLength(2);
    // The flag was spent only after the message landed.
    expect(pair.consumed()).toBe(1);
    expect(notifications.snoozedUntil).toBe('');

    // Morning and evening share one conversation per day (same title), so the
    // evening message is the second one in it.
    today = '2026-11-04';
    const evening = await service.check('evening', '2026-11-04');
    expect(evening).not.toBeNull();
    const eveningText = (await value.get(summaries[0]!.id))!.messages.find(
      (message) => message.trigger === 'evening'
    )!.text;
    expect(eveningText).not.toContain('恢复的第一天');
    expect(pair.consumed()).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a manual resume spends resumedFrom and keeps it off later messages', async () => {
  const { dir, value } = await store();
  try {
    const notifications = {
      ...settings().notifications,
      resumedFrom: '2026-11-05'
    };
    let today = '2026-11-06';
    const pair = resumePair(notifications, () => today);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => settings({ notifications }),
      ...pair,
      now: () => NOW
    });

    const morning = await service.check('morning', '2026-11-06');
    expect(morning).not.toBeNull();
    const text = (await value.get((await value.list())[0]!.id))!.messages[0]!.text;
    // A resume whose mute had already ended speaks the natural-expiry sentence.
    expect(text.endsWith('你之前暂停到 11月5日，今天是恢复的第一天。')).toBe(true);
    expect(notifications.resumedFrom).toBeUndefined();
    // The stored mute was never touched by a manual resume.
    expect(notifications.snoozedUntil).toBeUndefined();
    expect(pair.consumed()).toBe(1);

    // Later checks the same week carry no resume sentence.
    today = '2026-11-07';
    const next = await service.check('morning', '2026-11-07');
    expect(next).not.toBeNull();
    expect(
      (await value.get((await value.list()).find((entry) => entry.title.includes('11-07'))!.id))!
        .messages[0]!.text
    ).not.toContain('恢复的第一天');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resuming early into a 7-day mute speaks its sentence on the first allowed check', async () => {
  // The renderer, mid-mute, writes today's date as `resumedFrom` and the cut
  // short mute's last day as `resumedFromMuteEnd`. The very next check runs
  // today (the mute is cleared) and must say the 「原定」 sentence once.
  const { dir, value } = await store();
  try {
    const today = '2026-11-02';
    // 7-day mute set on 11-02 would have ended 11-09; the user resumes on the
    // second day, so `resumedFrom` is today and the original end is 11-09.
    const notifications = {
      ...settings().notifications,
      resumedFrom: today,
      resumedFromMuteEnd: '2026-11-09'
    };
    const pair = resumePair(notifications, () => today);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => settings({ notifications }),
      ...pair,
      now: () => NOW
    });

    const morning = await service.check('morning', today);
    expect(morning).not.toBeNull();
    const text = (await value.get((await value.list())[0]!.id))!.messages[0]!.text;
    // The sentence appears on the very first allowed check and says exactly
    // once that the pause was cut short, naming the day it would have ended.
    expect(text.endsWith('你提前恢复了提醒，原定暂停到 11月9日。')).toBe(true);
    expect(text.split('原定暂停到')).toHaveLength(2);
    // Both the resume day and its mute-end carrier are cleared together.
    expect(notifications.resumedFrom).toBeUndefined();
    expect(notifications.resumedFromMuteEnd).toBeUndefined();
    expect(pair.consumed()).toBe(1);

    // A later check carries no resume sentence at all.
    const next = await service.check('evening', today);
    expect(next).not.toBeNull();
    const evening = (await value.get((await value.list())[0]!.id))!.messages.find(
      (message) => message.trigger === 'evening'
    )!;
    expect(evening.text).not.toContain('原定暂停到');
    expect(evening.text).not.toContain('恢复');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a still-muted day says nothing and never spends an early resume', async () => {
  // Defense in depth: even if a `resumedFromMuteEnd` somehow rode along while
  // the mute is still in force (snoozedUntil covers today), the check is
  // skipped before peeking, so nothing is spoken or consumed.
  const { dir, value } = await store();
  try {
    const notifications = {
      ...settings().notifications,
      snoozedUntil: '2026-11-09',
      resumedFrom: '2026-11-02',
      resumedFromMuteEnd: '2026-11-09'
    };
    const pair = resumePair(notifications, () => '2026-11-02');
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => settings({ notifications }),
      ...pair,
      now: () => NOW
    });

    expect(await service.check('morning', '2026-11-02')).toBeNull();
    expect(await value.list()).toEqual([]);
    expect(pair.consumed()).toBe(0);
    expect(notifications.resumedFrom).toBe('2026-11-02');
    expect(notifications.resumedFromMuteEnd).toBe('2026-11-09');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the model path also carries the sentence once, and never in the prompt', async () => {
  const { dir, value } = await store();
  try {
    const notifications = { ...settings().notifications, snoozedUntil: '2026-11-05' };
    const pair = resumePair(notifications, () => '2026-11-06');
    const client = new FakeModelClient(['模型写的晨检，先做极限基础。']);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: client,
      getSettings: async () => settings({ notifications }),
      ...pair,
      now: () => NOW
    });

    const notification = await service.check('morning', '2026-11-06');
    expect(notification).not.toBeNull();
    const text = (await value.get((await value.list())[0]!.id))!.messages[0]!.text;
    expect(text).toBe('模型写的晨检，先做极限基础。\n你之前暂停到 11月5日，今天是恢复的第一天。');
    // The prompt the model saw says nothing about the pause: the sentence is
    // code-owned, so no reword or duplicate is possible.
    expect(client.calls[0]!.messages[0]!.content).not.toContain('恢复的第一天');
    expect(pair.consumed()).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('without a pending resume every check-in keeps its previous bytes', async () => {
  const hookedStore = await store();
  const plainStore = await store();
  try {
    const pair = resumePair(settings().notifications, () => '2026-10-31');
    const fixture = behindService([
      behindTask('t0', 'done'),
      behindTask('t1', 'pending'),
      behindTask('t2', 'pending')
    ]);
    const withHook = new ProactiveCheckInService({
      conversationStore: hookedStore.value,
      workspaceService: fixture,
      modelClient: null,
      getSettings: async () => settings(),
      ...pair,
      now: () => NOW
    });
    const withoutHook = new ProactiveCheckInService({
      conversationStore: plainStore.value,
      workspaceService: behindService([
        behindTask('t0', 'done'),
        behindTask('t1', 'pending'),
        behindTask('t2', 'pending')
      ]),
      modelClient: null,
      getSettings: async () => settings(),
      now: () => NOW
    });

    for (const trigger of ['morning', 'evening', 'weekly', 'behind'] as const) {
      const hooked = await withHook.check(trigger, '2026-10-31');
      const plain = await withoutHook.check(trigger, '2026-10-31');
      expect(hooked).not.toBeNull();
      expect(plain).not.toBeNull();
      // The four template texts are byte-identical with and without the
      // resume plumbing when nothing is pending.
      const hookedConversation = await hookedStore.value.get(hooked!.conversationId!);
      const plainConversation = await plainStore.value.get(plain!.conversationId!);
      expect(hookedConversation!.messages[0]!.text).toBe(
        plainConversation!.messages[0]!.text
      );
    }
    expect(pair.consumed()).toBe(0);
  } finally {
    await rm(hookedStore.dir, { recursive: true, force: true });
    await rm(plainStore.dir, { recursive: true, force: true });
  }
});

test('a check that is skipped for budget never speaks or spends the resume', async () => {
  const { dir, value } = await store();
  try {
    const notifications = { ...settings().notifications, snoozedUntil: '2026-11-05' };
    const pair = resumePair(notifications, () => '2026-11-06');
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => settings({ notifications }),
      getDailyTokensUsed: async () => settings().budget.dailyTokens,
      ...pair,
      now: () => NOW
    });

    // The daily token budget is used up: the check is skipped, so the resume
    // stays pending for the first check that is actually allowed to run.
    expect(await service.check('morning', '2026-11-06')).toBeNull();
    expect(await value.list()).toEqual([]);
    expect(pair.consumed()).toBe(0);
    expect(notifications.snoozedUntil).toBe('2026-11-05');
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

const AVAILABILITY_QUESTION =
  '下周哪几天会特别满？回我一句就行，那几天我只给你排一件小事。';

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
      `本周完成 3 个任务 · 专注 135 分钟 · 正确率 83%\n${WEEKLY_TEMPLATE}\n${AVAILABILITY_QUESTION}`
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
    expect(conversation?.messages[0]?.text).toBe(
      `${WEEKLY_TEMPLATE}\n${AVAILABILITY_QUESTION}`
    );
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
    expect(conversation?.messages[0]?.text).toBe(
      `${WEEKLY_TEMPLATE}\n${AVAILABILITY_QUESTION}`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the weekly review skips the availability question without projects', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService: workspaceServiceFor([]),
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

const HONEST = {
  calibration: '有把握但错 2 道 · 没把握但对 1 道',
  nextStep: '下周先练「三角函数」的到期错题（3 道）'
};

const HONEST_LINES = [
  '有把握但错 2 道 · 没把握但对 1 道',
  '下一步：下周先练「三角函数」的到期错题（3 道）'
].join('\n');

test('appends the honest calibration and next step to the weekly message', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getWeeklyOverview: async () => weeklyStats,
      getWeeklyHonest: async (today) => {
        // Keyed to the check-in's own date, not the wall clock.
        expect(today.getDate()).toBe(1);
        return HONEST;
      },
      getSettings: async () => settings(),
      now: () => NOW
    });

    const notification = await service.check('weekly', '2026-11-01');

    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe(
      `本周完成 3 个任务 · 专注 135 分钟 · 正确率 83%\n${WEEKLY_TEMPLATE}\n${HONEST_LINES}\n${AVAILABILITY_QUESTION}`
    );
    // The surfaced banner stays generic; only the review message carries it.
    expect(notification?.body).toBe('周日复盘时间到了，点开回顾本周并安排下周。');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the honest lines still end a model-written weekly review', async () => {
  const { dir, value } = await store();
  try {
    const client = new FakeModelClient(['这一周你完成了 3 个任务，稳中有进。']);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: client,
      getWeeklyOverview: async () => weeklyStats,
      getWeeklyHonest: async () => HONEST,
      getSettings: async () => settings(),
      now: () => NOW
    });

    await service.check('weekly', '2026-11-01');

    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe(
      `这一周你完成了 3 个任务，稳中有进。\n${HONEST_LINES}\n${AVAILABILITY_QUESTION}`
    );
    const prompt = client.calls[0]?.messages[0]?.content ?? '';
    expect(prompt).toContain('本周诚实数据：');
    expect(prompt).toContain('- 有把握但错 2 道 · 没把握但对 1 道');
    // The availability question is delivered, never composed by the model.
    expect(prompt).not.toContain(AVAILABILITY_QUESTION);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('only the non-null honest line is appended', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getWeeklyHonest: async () => ({ calibration: null, nextStep: HONEST.nextStep }),
      getSettings: async () => settings(),
      now: () => NOW
    });

    await service.check('weekly', '2026-11-01');

    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe(
      `${WEEKLY_TEMPLATE}\n下一步：${HONEST.nextStep}\n${AVAILABILITY_QUESTION}`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the weekly message stays byte-identical when there is no honest provider', async () => {
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
      `本周完成 3 个任务 · 专注 135 分钟 · 正确率 83%\n${WEEKLY_TEMPLATE}\n${AVAILABILITY_QUESTION}`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failing honest provider leaves the weekly message unchanged', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getWeeklyOverview: async () => weeklyStats,
      getWeeklyHonest: async () => {
        throw new Error('practice unreadable');
      },
      getSettings: async () => settings(),
      now: () => NOW
    });

    const notification = await service.check('weekly', '2026-11-01');

    expect(notification).not.toBeNull();
    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe(
      `本周完成 3 个任务 · 专注 135 分钟 · 正确率 83%\n${WEEKLY_TEMPLATE}\n${AVAILABILITY_QUESTION}`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the morning check-in never reads the honest provider', async () => {  const { dir, value } = await store();
  try {
    let called = false;
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getWeeklyHonest: async () => {
        called = true;
        return HONEST;
      },
      getSettings: async () => settings(),
      now: () => NOW
    });

    await service.check('morning', '2026-11-01');

    expect(called).toBe(false);
    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).not.toContain('有把握但错');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the weekly message carries the accountability clause once, and the prompt does not', async () => {
  const { dir, value } = await store();
  try {
    const clause = '你说过要做「写完第三章」，你告诉过 小林 的时间是 2026-11-20';
    const client = new FakeModelClient(['这一周你完成了 3 个任务，稳中有进。']);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: client,
      getWeeklyOverview: async () => weeklyStats,
      getWeeklyHonest: async () => ({ ...HONEST, accountability: clause }),
      getSettings: async () => settings(),
      now: () => NOW
    });

    await service.check('weekly', '2026-11-01');

    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    const text = conversation?.messages[0]?.text ?? '';
    expect(text).toBe(
      `这一周你完成了 3 个任务，稳中有进。\n${HONEST_LINES}\n${clause}\n${AVAILABILITY_QUESTION}`
    );
    // Exactly once, and never inside the model's prompt.
    expect(text.split(clause)).toHaveLength(2);
    expect(text.split(AVAILABILITY_QUESTION)).toHaveLength(2);
    expect(client.calls[0]?.messages[0]?.content ?? '').not.toContain(clause);
    expect(client.calls[0]?.messages[0]?.content ?? '').not.toContain(
      AVAILABILITY_QUESTION
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- the backup age line (weekly, opt-in) ------------------------------------

const BACKUP_AGE_LINE = '上次导出备份是 3 天前（10月29日）。';

test('the weekly message carries the opt-in backup age line once', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () =>
        settings({
          backup: { ageLineEnabled: true, lastBackupAt: '2026-10-29T14:00:00' }
        }),
      now: () => NOW
    });

    await service.check('weekly', '2026-11-01');

    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    const text = conversation?.messages[0]?.text ?? '';
    expect(text).toBe(`${WEEKLY_TEMPLATE}\n${BACKUP_AGE_LINE}\n${AVAILABILITY_QUESTION}`);
    expect(text.split('上次导出备份')).toHaveLength(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the age line switch off keeps the weekly message byte-identical', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () =>
        settings({ backup: { ageLineEnabled: false, lastBackupAt: '2026-10-29T14:00:00' } }),
      now: () => NOW
    });
    const baseline = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => settings(),
      now: () => NOW
    });

    await service.check('weekly', '2026-11-01');
    await baseline.check('weekly', '2026-11-02');

    const [withFlag, without] = await value.list();
    const withFlagText = (await value.get(withFlag!.id))!.messages[0]!.text;
    const baselineText = (await value.get(without!.id))!.messages[0]!.text;
    // Only the date suffix in the titles differs; the bodies are identical.
    expect(withFlagText).toBe(baselineText);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a model text that already mentions the backup is not given the age line', async () => {
  const { dir, value } = await store();
  try {
    const backupSettings = settings({
      backup: { ageLineEnabled: true, lastBackupAt: '2026-10-29T14:00:00' }
    });
    const mentioning = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: new FakeModelClient(['这周很稳，上次备份也在。']),
      getSettings: async () => backupSettings,
      now: () => NOW
    });
    await mentioning.check('weekly', '2026-11-01');

    const quiet = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: new FakeModelClient(['这一周你完成了 3 个任务，稳中有进。']),
      getSettings: async () => backupSettings,
      now: () => NOW
    });
    await quiet.check('weekly', '2026-11-02');

    const mentioningText = (
      await value.get(
        (await value.list()).find((entry) => entry.title.includes('11-01'))!.id
      )
    )!.messages[0]!.text;
    const quietText = (
      await value.get(
        (await value.list()).find((entry) => entry.title.includes('11-02'))!.id
      )
    )!.messages[0]!.text;
    expect(mentioningText).toBe(`这周很稳，上次备份也在。\n${AVAILABILITY_QUESTION}`);
    expect(quietText).toBe(
      `这一周你完成了 3 个任务，稳中有进。\n上次导出备份是 4 天前（10月29日）。\n${AVAILABILITY_QUESTION}`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- the promise revisit (morning only) ------------------------------------
function dueCommitment(text: string, due: string) {
  return async () => ({ text, due });
}

test('the morning message appends the promise line for a yesterday-due promise', async () => {
  const { dir, value } = await store();
  try {
    const client = new FakeModelClient(['早上好。今天先做极限基础，做完告诉我。']);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: client,
      getDueCommitment: dueCommitment('背 20 个单词', '2026-10-31'),
      getSettings: async () => settings(),
      now: () => NOW
    });

    const notification = await service.check('morning', '2026-11-01');
    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);

    // 2026-10-31 is yesterday relative to the check-in date.
    expect(conversation?.messages[0]?.text).toBe(
      '早上好。今天先做极限基础，做完告诉我。\n昨天你说要做「背 20 个单词」，做了吗？没做的话，挪到今天还是先放一放？'
    );
    // No new notification surface: the banner keeps its generic line.
    expect(notification?.body).toBe('今天还有 1 个任务没完成，点开看看。');
    // The prompt the model saw carries the same ask once.
    expect(client.calls[0]?.messages[0]?.content).toContain(
      '承诺回访：昨天你说要做「背 20 个单词」'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the morning message asks once about a today-due promise', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getDueCommitment: dueCommitment('背 20 个单词', '2026-11-01'),
      getSettings: async () => settings(),
      now: () => NOW
    });

    await service.check('morning', '2026-11-01');
    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe(
      '早上好。今天有 1 个任务，先做「极限基础」怎么样？做完告诉我一声。\n你说今天要做「背 20 个单词」，做了吗？'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the model reply that already asks about the promise is not duplicated', async () => {
  const { dir, value } = await store();
  try {
    const client = new FakeModelClient([
      '早上好。昨天你说要做背 20 个单词，今天做吗？'
    ]);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: client,
      getDueCommitment: dueCommitment('背 20 个单词', '2026-10-31'),
      getSettings: async () => settings(),
      now: () => NOW
    });

    await service.check('morning', '2026-11-01');
    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe(
      '早上好。昨天你说要做背 20 个单词，今天做吗？'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('no due commitment leaves the morning message byte-identical', async () => {
  const { dir, value } = await store();
  try {
    const client = new FakeModelClient(['早上好。今天先做极限基础，做完告诉我。']);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: client,
      getDueCommitment: dueCommitment('背 20 个单词', '2026-11-05'),
      getSettings: async () => settings(),
      now: () => NOW
    });

    const notification = await service.check('morning', '2026-11-01');
    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe('早上好。今天先做极限基础，做完告诉我。');
    expect(notification?.body).toBe('今天还有 1 个任务没完成，点开看看。');
    expect(client.calls[0]?.messages[0]?.content).not.toContain('承诺回访');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failing commitment provider leaves the morning message unchanged', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getDueCommitment: async () => {
        throw new Error('vault unreadable');
      },
      getSettings: async () => settings(),
      now: () => NOW
    });

    await service.check('morning', '2026-11-01');
    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe(
      '早上好。今天有 1 个任务，先做「极限基础」怎么样？做完告诉我一声。'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the evening check-in never reads or asks about a promise', async () => {
  const { dir, value } = await store();
  try {
    const getDueCommitment = vi.fn(dueCommitment('背 20 个单词', '2026-10-31'));
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getDueCommitment,
      getSettings: async () => settings(),
      now: () => new Date('2026-11-01T13:30:00.000Z')
    });

    await service.check('evening', '2026-11-01');
    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe(
      '晚上好。今天还有 1 个任务没完成，最卡的是哪一步？'
    );
    expect(getDueCommitment).not.toHaveBeenCalled();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('without a commitment provider the morning check-in still works unchanged', async () => {
  const { dir, value } = await store();
  try {
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService,
      modelClient: null,
      getSettings: async () => settings(),
      now: () => NOW
    });

    const notification = await service.check('morning', '2026-11-01');
    expect(notification).not.toBeNull();
    const summaries = await value.list();
    const conversation = await value.get(summaries[0]!.id);
    expect(conversation?.messages[0]?.text).toBe(
      '早上好。今天有 1 个任务，先做「极限基础」怎么样？做完告诉我一声。'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
