import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { ProactiveCheckInService } from '../../src/main/check-ins/proactive-check-in-service';
import { ConversationStore } from '../../src/main/conversations/conversation-store';
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
      title: '管家想和你聊聊今天的进度',
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
