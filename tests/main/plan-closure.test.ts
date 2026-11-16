import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LongPlanService, UpdateLongPlanItemInput } from '../../src/shared/plans';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { createAppContext } from '../../src/main/context';
import { InMemorySecretStore } from '../../src/main/settings/secret-store';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-closure-'));
  dirs.push(dir);
  return dir;
}

async function makeContext(model: FakeModelClient | null, extra: Record<string, unknown> = {}) {
  const dir = await tempDir();
  return createAppContext({
    userDataPath: join(dir, 'user-data'),
    defaultVaultPath: join(dir, 'vault'),
    secretStore: new InMemorySecretStore(),
    modelClient: model,
    now: () => new Date(2026, 10, 15, 9, 0, 0),
    ...extra
  });
}

function planReply(titles: string[]): string {
  return JSON.stringify({
    tasks: titles.map((title) => ({
      title,
      subject: '数学',
      durationMin: 30,
      acceptance: '完成并订正'
    }))
  });
}

test('the next plan uses the newly saved daily available time and names its source', async () => {
  const model = new FakeModelClient([planReply(['极限 10 题']), planReply(['线代 10 题'])]);
  const context = await makeContext(model);
  const workspace = await context.api.createWorkspace({
    name: '考研',
    kind: 'exam',
    goal: '2027 上岸',
    description: ''
  });

  await context.api.updateWorkspace!({ workspaceId: workspace.id, availableMinutes: 60 });
  const first = await context.api.planWorkspace({ workspaceId: workspace.id });
  expect(first.availableMinutes).toBe(60);
  expect(first.availableMinutesSource).toBe('workspace');
  expect(model.calls[0]?.messages.at(-1)?.content).toContain('60 分钟');
  expect(model.calls[0]?.messages.at(-1)?.content).toContain('项目设置的每天可用时间');

  // The user changes their daily time; the next plan must use the new value.
  await context.api.updateWorkspace!({ workspaceId: workspace.id, availableMinutes: 45 });
  const second = await context.api.planWorkspace({ workspaceId: workspace.id });
  expect(second.availableMinutes).toBe(45);
  expect(second.availableMinutesSource).toBe('workspace');
  expect(model.calls[1]?.messages.at(-1)?.content).toContain('45 分钟');
  expect(model.calls[1]?.messages.at(-1)?.content).not.toContain('60 分钟');
});

test('adding the same plan day twice does not create duplicate tasks', async () => {
  const context = await makeContext(null);
  const workspace = await context.api.createWorkspace({
    name: '考研',
    kind: 'exam',
    goal: '2027 上岸',
    description: ''
  });
  const input = {
    workspaceId: workspace.id,
    title: '明确本周目标',
    subject: '考研',
    durationMin: 30,
    acceptance: '列出 3 个问题',
    due: '2026-11-15',
    planId: 'lp-1',
    planWeekId: 'w1',
    planItemId: 'w1d1'
  };

  const first = await context.api.createTask(input);
  const second = await context.api.createTask(input);
  expect(second.id).toBe(first.id);
  const snapshot = await context.api.getWorkspaceSnapshot(workspace.id);
  expect(snapshot.tasks.filter((task) => task.planItemId === 'w1d1')).toHaveLength(1);
});

test('completing a plan-linked task moves the long plan progress', async () => {
  const calls: UpdateLongPlanItemInput[] = [];
  const longPlanService = {
    setItemDone: async (input: UpdateLongPlanItemInput) => {
      calls.push(input);
      return null;
    }
  } as unknown as LongPlanService;
  const context = await makeContext(null, { longPlanService });
  const workspace = await context.api.createWorkspace({
    name: '考研',
    kind: 'exam',
    goal: '2027 上岸',
    description: ''
  });
  const task = await context.api.createTask({
    workspaceId: workspace.id,
    title: '明确本周目标',
    subject: '考研',
    durationMin: 30,
    acceptance: '列出 3 个问题',
    due: '2026-11-15',
    planId: 'lp-1',
    planWeekId: 'w1',
    planItemId: 'w1d1'
  });

  await context.api.updateWorkspaceTask({ taskId: task.id, status: 'done' });
  expect(calls).toEqual([
    { planId: 'lp-1', weekId: 'w1', itemId: 'w1d1', kind: 'day', done: true }
  ]);

  await context.api.updateWorkspaceTask({ taskId: task.id, status: 'pending' });
  expect(calls.at(-1)?.done).toBe(false);
});
