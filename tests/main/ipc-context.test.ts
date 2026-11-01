import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ButlerService, Workspace, WorkspaceService } from '../../src/shared/workspace';
import { createAppContext } from '../../src/main/context';
import { InMemorySecretStore } from '../../src/main/settings/secret-store';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function services(): { workspace: WorkspaceService; butler: ButlerService } {
  const workspaces: Workspace[] = [];
  return {
    workspace: {
      listWorkspaces: async () => workspaces,
      createWorkspace: async (input) => {
        const workspace: Workspace = {
          id: `ws-${workspaces.length + 1}`,
          name: input.name,
          kind: input.kind,
          color: '#0071e3',
          goal: input.goal,
          description: input.description
        };
        workspaces.push(workspace);
        return workspace;
      },
      getWorkspaceSnapshot: async () => {
        throw new Error('unused');
      },
      createTask: async () => {
        throw new Error('unused');
      },
      updateWorkspaceTask: async () => {
        throw new Error('unused');
      },
      createNote: async () => {
        throw new Error('unused');
      },
      updateNote: async () => {
        throw new Error('unused');
      },
      getMemory: async () => [],
      getReminders: async () => [],
      submitReview: async () => undefined
    },
    butler: {
      send: async () => ({ text: 'ok' }),
      stream: async () => ({ text: 'ok' })
    }
  };
}

async function contextAt(dir: string) {
  const { workspace, butler } = services();
  return createAppContext({
    userDataPath: dir,
    defaultVaultPath: join(dir, 'vault'),
    workspaceService: workspace,
    butlerService: butler,
    secretStore: new InMemorySecretStore(),
    now: () => new Date(2026, 9, 31, 9, 0, 0)
  });
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-context-'));
  dirs.push(dir);
  return dir;
}

test('bootstrap, onboarding and api key status work end to end', async () => {
  const dir = await tempDir();
  const context = await contextAt(dir);

  expect(await context.api.getBootstrap()).toEqual({
    needsOnboarding: true,
    today: '2026-10-31',
    hasApiKey: true
  });

  await expect(
    context.api.completeOnboarding({ examDate: 'bad', subjects: [], dailyMinutes: 10, currentLevel: '' })
  ).rejects.toThrow();

  await context.api.completeOnboarding({
    examDate: '2027-12-18',
    targetSchool: '示例大学',
    targetMajor: '计算机',
    subjects: [{ name: '数学' }, { name: '英语' }],
    dailyMinutes: 120,
    currentLevel: '基础一般'
  });
  expect((await context.api.getBootstrap()).needsOnboarding).toBe(false);

  await context.api.setApiKey('sk-test-context');
  expect((await context.api.getBootstrap()).hasApiKey).toBe(true);
  expect(JSON.stringify(await context.api.getSettings())).not.toContain('sk-test-context');
});

test('generates a template plan, updates a task and reloads it after restart', async () => {
  const dir = await tempDir();
  const first = await contextAt(dir);
  expect(await first.api.getTodayPlan()).toBeNull();
  await expect(first.api.updateTask({ taskId: 'missing', status: 'done' })).rejects.toThrow(
    '今天还没有计划。'
  );

  await first.api.completeOnboarding({
    examDate: '2027-12-18',
    subjects: [{ name: '数学' }, { name: '英语' }],
    dailyMinutes: 120,
    currentLevel: '基础一般'
  });
  const plan = await first.api.generateTodayPlan();
  expect(plan.date).toBe('2026-10-31');
  expect(plan.generatedBy).toBe('template');
  expect(plan.tasks.map((task) => task.subject)).toEqual(['数学', '英语']);
  expect(plan.tasks.every((task) => task.durationMin === 60)).toBe(true);

  const updated = await first.api.updateTask({
    taskId: plan.tasks[0].id,
    status: 'done',
    actualMin: 45
  });
  expect(updated.tasks[0]).toMatchObject({ status: 'done', actualMin: 45 });

  const second = await contextAt(dir);
  expect(await second.api.getTodayPlan()).toEqual(updated);
  expect((await second.api.getBootstrap()).needsOnboarding).toBe(false);
});

test('settings updates are persisted and validated', async () => {
  const dir = await tempDir();
  const first = await contextAt(dir);
  const defaults = await first.api.getSettings();
  expect(defaults.vaultPath).toBe(join(dir, 'vault'));

  const updated = await first.api.updateSettings({
    budget: { proactiveSessionsPerDay: 2, dailyTokens: 50000 },
    notifications: { enabled: false, morning: '09:10', evening: '21:30', dndStart: '23:00', dndEnd: '07:30' },
    launchAtLogin: true
  });
  expect(updated.budget).toEqual({ proactiveSessionsPerDay: 2, dailyTokens: 50000 });
  expect(updated.notifications.enabled).toBe(false);
  expect(updated.launchAtLogin).toBe(true);

  await expect(first.api.updateSettings({ provider: { kind: 'openai-compatible', baseURL: '', model: 'm' } })).rejects.toThrow(
    'Base URL不能为空。'
  );

  const second = await contextAt(dir);
  expect((await second.api.getSettings()).launchAtLogin).toBe(true);
});

test('workspace onboarding creates a workspace and selects the local CLI agent', async () => {
  const dir = await tempDir();
  const context = await contextAt(dir);
  expect((await context.api.getBootstrap()).needsOnboarding).toBe(true);

  await context.api.completeWorkspaceOnboarding({
    name: '我的学习',
    kind: 'study',
    goal: 'g',
    description: 'd'
  });

  expect((await context.api.getBootstrap()).needsOnboarding).toBe(false);
  expect((await context.api.getBootstrap()).hasApiKey).toBe(true);
  expect((await context.api.getSettings()).provider).toEqual({
    kind: 'local-cli',
    agent: 'codex',
    command: 'codex'
  });
  const workspaces = await context.api.listWorkspaces();
  expect(workspaces.some((workspace) => workspace.name === '我的学习')).toBe(true);
});
