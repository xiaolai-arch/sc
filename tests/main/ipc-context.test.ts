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

test('bootstrap and api key status work end to end', async () => {
  const dir = await tempDir();
  const context = await contextAt(dir);

  expect(await context.api.getBootstrap()).toEqual({
    needsOnboarding: true,
    today: '2026-10-31',
    hasApiKey: true
  });

  await context.api.setApiKey('sk-test-context');
  expect((await context.api.getBootstrap()).hasApiKey).toBe(true);
  expect(JSON.stringify(await context.api.getSettings())).not.toContain('sk-test-context');
});

test('persists workspace tasks in the vault across a context restart', async () => {
  const dir = await tempDir();
  const first = await createAppContext({
    userDataPath: dir,
    defaultVaultPath: join(dir, 'vault'),
    secretStore: new InMemorySecretStore(),
    now: () => new Date(2026, 9, 31, 9, 0, 0)
  });
  await first.api.completeWorkspaceOnboarding({
    name: '持久化',
    kind: 'study',
    goal: 'g',
    description: 'd'
  });
  const workspace = (await first.api.listWorkspaces()).find((entry) => entry.name === '持久化');
  expect(workspace).toBeDefined();

  const task = await first.api.createTask({
    workspaceId: workspace!.id,
    title: '整理错题',
    subject: '数学',
    durationMin: 30,
    acceptance: '五道'
  });
  const updated = await first.api.updateWorkspaceTask({
    taskId: task.id,
    status: 'done',
    actualMin: 20
  });
  expect(updated).toMatchObject({ status: 'done', actualMin: 20 });
  await first.dispose();

  const second = await createAppContext({
    userDataPath: dir,
    defaultVaultPath: join(dir, 'vault'),
    secretStore: new InMemorySecretStore(),
    now: () => new Date(2026, 9, 31, 9, 0, 0)
  });
  expect((await second.api.getBootstrap()).needsOnboarding).toBe(false);
  const snapshot = await second.api.getWorkspaceSnapshot(workspace!.id);
  expect(snapshot.tasks.find((entry) => entry.id === task.id)).toMatchObject({
    status: 'done',
    actualMin: 20
  });
  await second.dispose();
});

test('settings updates are persisted and validated', async () => {
  const dir = await tempDir();
  const first = await contextAt(dir);
  const defaults = await first.api.getSettings();
  expect(defaults.vaultPath).toBe(join(dir, 'vault'));

  const updated = await first.api.updateSettings({
    budget: { proactiveSessionsPerDay: 2, dailyTokens: 50000 },
    notifications: {
      enabled: false,
      morning: '09:10',
      evening: '21:30',
      weekly: '20:00',
      weeklyEnabled: true,
      dndStart: '23:00',
      dndEnd: '07:30'
    },
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
