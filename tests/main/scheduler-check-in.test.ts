import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppSettings } from '../../src/shared/types';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { ProactiveCheckInService } from '../../src/main/check-ins/proactive-check-in-service';
import { ConversationStore } from '../../src/main/conversations/conversation-store';
import { Scheduler } from '../../src/main/scheduler/scheduler';
import { createDefaultSettings } from '../../src/main/settings/defaults';
import { formatLocalDate } from '../../src/shared/date';
import { isReviewFreshStart, type DatedReview } from '../../src/shared/review-stats';
import type { Workspace, WorkspaceService, WorkspaceSnapshot } from '../../src/shared/workspace';

function settings(): AppSettings {
  const base = createDefaultSettings('/tmp/vault');
  return {
    ...base,
    notifications: { ...base.notifications, morning: '08:00', evening: '21:30' }
  };
}

function at(hour: number, minute: number): Date {
  return new Date(2026, 9, 31, hour, minute, 0);
}

test('uses the proactive check-in notification and does not retry it', async () => {
  let now = at(8, 0);
  const calls: string[] = [];
  const notified: Array<{ title: string; conversationId?: string }> = [];
  const scheduler = new Scheduler({
    now: () => now,
    getSettings: async () => settings(),
    notify: (notification) => {
      notified.push({
        title: notification.title,
        ...(notification.conversationId ? { conversationId: notification.conversationId } : {})
      });
    },
    onCheckIn: (kind, date) => {
      calls.push(`${kind}:${date}`);
      return {
        key: `${date}:check-in:${kind}`,
        kind: 'morning-plan',
        date,
        scheduledTime: '08:00',
        title: '阿咲想和你聊聊今天的进度',
        body: '今天还有 1 个任务没完成，点开看看。',
        conversationId: 'check-in-1'
      };
    }
  });

  const first = await scheduler.tick();
  expect(first.delivered).toHaveLength(1);
  expect(notified).toEqual([
    { title: '阿咲想和你聊聊今天的进度', conversationId: 'check-in-1' }
  ]);
  expect(calls).toEqual(['morning:2026-10-31']);

  now = at(8, 1);
  expect((await scheduler.tick()).delivered).toHaveLength(0);
  expect(notified).toHaveLength(1);
});

test('a null check-in consumes the trigger without a notification', async () => {
  const now = at(8, 0);
  const notified: string[] = [];
  let calls = 0;
  const scheduler = new Scheduler({
    now: () => now,
    getSettings: async () => settings(),
    notify: (notification) => {
      notified.push(notification.title);
    },
    onCheckIn: () => {
      calls += 1;
      return null;
    }
  });

  expect((await scheduler.tick()).delivered).toHaveLength(0);
  expect(notified).toEqual([]);
  expect(calls).toBe(1);

  expect((await scheduler.tick()).delivered).toHaveLength(0);
  expect(calls).toBe(1);
});

// --- the review fresh-start line (morning after a missed day) ------------------

const MORNING_NOW = new Date(2026, 9, 31, 8, 0, 0);
const CHECK_DATE = '2026-10-31';
const MORNING_BASE =
  '早上好。今天有 1 个任务，先做「极限基础」怎么样？做完告诉我一声。';
const FRESH_START_LINE = '昨天没有复盘，新的一天从一件小事开始就行。';

const checkInWorkspace: Workspace = {
  id: 'ws-exam',
  name: '考研',
  kind: 'exam',
  color: '#ef4444',
  goal: '2027 上岸',
  description: ''
};

const checkInSnapshot: WorkspaceSnapshot = {
  workspace: checkInWorkspace,
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

const checkInWorkspaceService = {
  listWorkspaces: async () => [checkInWorkspace],
  getWorkspaceSnapshot: async () => checkInSnapshot,
  getMemory: async () => [],
  createWorkspace: async () => checkInWorkspace,
  createTask: async () => checkInSnapshot.tasks[0]!,
  createNote: async () => {
    throw new Error('not used');
  },
  updateWorkspaceTask: async () => checkInSnapshot.tasks[0]!,
  getReminders: async () => [],
  submitReview: async () => undefined
} as unknown as WorkspaceService;

async function checkInStore(): Promise<{ dir: string; value: ConversationStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-fresh-start-'));
  return { dir, value: new ConversationStore(dir, { now: () => MORNING_NOW }) };
}

async function firstMessageText(value: ConversationStore): Promise<string> {
  const summaries = await value.list();
  const conversation = await value.get(summaries[0]!.id);
  return conversation!.messages[0]!.text;
}

/** The provider `createAppContext` wires: the predicate runs on live data. */
function recoveryProvider(reviews: DatedReview[]) {
  return async (today: Date) => ({
    freshStart: isReviewFreshStart(reviews, formatLocalDate(today))
  });
}

test('a missed yesterday with earlier history appends the fresh-start line (template path)', async () => {
  const { dir, value } = await checkInStore();
  try {
    const reviews: DatedReview[] = [{ date: '2026-10-28' }];
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService: checkInWorkspaceService,
      modelClient: null,
      getSettings: async () => settings(),
      getReviewRecovery: recoveryProvider(reviews),
      now: () => MORNING_NOW
    });

    const notification = await service.check('morning', CHECK_DATE);

    expect(notification).not.toBeNull();
    expect(await firstMessageText(value)).toBe(`${MORNING_BASE}\n${FRESH_START_LINE}`);
    // The surfaced banner keeps its generic line; only the message carries it.
    expect(notification?.body).toBe('今天还有 1 个任务没完成，点开看看。');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the model path carries the same fresh-start line once, and never in the prompt', async () => {
  const { dir, value } = await checkInStore();
  try {
    const reviews: DatedReview[] = [{ date: '2026-10-28' }];
    const client = new FakeModelClient(['早上好。今天先做极限基础，做完告诉我。']);
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService: checkInWorkspaceService,
      modelClient: client,
      getSettings: async () => settings(),
      getReviewRecovery: recoveryProvider(reviews),
      now: () => MORNING_NOW
    });

    await service.check('morning', CHECK_DATE);

    const text = await firstMessageText(value);
    expect(text).toBe(`早上好。今天先做极限基础，做完告诉我。\n${FRESH_START_LINE}`);
    expect(text.split(FRESH_START_LINE)).toHaveLength(2);
    // The model never saw the line, so it can neither swallow nor restate it.
    expect(client.calls[0]!.messages[0]!.content).not.toContain('昨天没有复盘');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a reviewed yesterday, empty history or failing provider keep the bytes', async () => {
  const cases: Array<{ name: string; reviews: DatedReview[]; fail?: boolean }> = [
    { name: 'yesterday reviewed', reviews: [{ date: '2026-10-30' }] },
    { name: 'no history', reviews: [] },
    { name: 'provider fails', reviews: [{ date: '2026-10-28' }], fail: true }
  ];
  for (const { name, reviews, fail } of cases) {
    const { dir, value } = await checkInStore();
    try {
      const service = new ProactiveCheckInService({
        conversationStore: value,
        workspaceService: checkInWorkspaceService,
        modelClient: null,
        getSettings: async () => settings(),
        getReviewRecovery: fail
          ? async () => {
              throw new Error('vault unreadable');
            }
          : recoveryProvider(reviews),
        now: () => MORNING_NOW
      });

      expect(await service.check('morning', CHECK_DATE)).not.toBeNull();
      expect(await firstMessageText(value), name).toBe(MORNING_BASE);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test('with both facts due the fresh-start line precedes the promise line, both paths', async () => {
  const templateStore = await checkInStore();
  const modelStore = await checkInStore();
  try {
    const reviews: DatedReview[] = [{ date: '2026-10-28' }];
    const commitment = async () => ({ text: '背 20 个单词', due: '2026-10-30' });
    const templateService = new ProactiveCheckInService({
      conversationStore: templateStore.value,
      workspaceService: checkInWorkspaceService,
      modelClient: null,
      getSettings: async () => settings(),
      getDueCommitment: commitment,
      getReviewRecovery: recoveryProvider(reviews),
      now: () => MORNING_NOW
    });
    expect(await templateService.check('morning', CHECK_DATE)).not.toBeNull();
    const templateText = await firstMessageText(templateStore.value);
    expect(templateText).toBe(
      [
        MORNING_BASE,
        FRESH_START_LINE,
        '昨天你说要做「背 20 个单词」，做了吗？没做的话，挪到今天还是先放一放？'
      ].join('\n')
    );

    const client = new FakeModelClient(['早上好。今天先做极限基础。']);
    const modelService = new ProactiveCheckInService({
      conversationStore: modelStore.value,
      workspaceService: checkInWorkspaceService,
      modelClient: client,
      getSettings: async () => settings(),
      getDueCommitment: commitment,
      getReviewRecovery: recoveryProvider(reviews),
      now: () => MORNING_NOW
    });
    expect(await modelService.check('morning', CHECK_DATE)).not.toBeNull();
    const modelText = await firstMessageText(modelStore.value);
    expect(modelText).toBe(
      [
        '早上好。今天先做极限基础。',
        FRESH_START_LINE,
        '昨天你说要做「背 20 个单词」，做了吗？没做的话，挪到今天还是先放一放？'
      ].join('\n')
    );
  } finally {
    await rm(templateStore.dir, { recursive: true, force: true });
    await rm(modelStore.dir, { recursive: true, force: true });
  }
});

test('backfilling yesterday removes the fresh-start line on the same day (live, no cache)', async () => {
  const { dir, value } = await checkInStore();
  try {
    const reviews: DatedReview[] = [{ date: '2026-10-28' }];
    let tokensUsed = 1000;
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService: checkInWorkspaceService,
      modelClient: null,
      getSettings: async () => ({
        ...settings(),
        budget: { proactiveSessionsPerDay: 4, dailyTokens: 1000 }
      }),
      getDailyTokensUsed: async () => tokensUsed,
      getReviewRecovery: recoveryProvider(reviews),
      now: () => MORNING_NOW
    });

    // The first trigger of the day is blocked by the token budget: nothing is
    // composed, nothing cached, no conversation exists.
    expect(await service.check('morning', CHECK_DATE)).toBeNull();
    expect(await value.list()).toEqual([]);

    // The user backfills yesterday's review before the next allowed check.
    reviews.push({ date: '2026-10-30' });
    tokensUsed = 0;

    expect(await service.check('morning', CHECK_DATE)).not.toBeNull();
    expect(await firstMessageText(value)).toBe(MORNING_BASE);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the evening check-in never reads the review recovery provider', async () => {
  const { dir, value } = await checkInStore();
  try {
    const getReviewRecovery = vi.fn(async () => ({ freshStart: true }));
    const service = new ProactiveCheckInService({
      conversationStore: value,
      workspaceService: checkInWorkspaceService,
      modelClient: null,
      getSettings: async () => settings(),
      getReviewRecovery,
      now: () => MORNING_NOW
    });

    expect(await service.check('evening', CHECK_DATE)).not.toBeNull();
    expect(getReviewRecovery).not.toHaveBeenCalled();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
