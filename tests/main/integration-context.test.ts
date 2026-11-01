import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderConfig } from '../../src/shared/types';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { createAppContext } from '../../src/main/context';
import { createButlerService } from '../../src/main/butler/create-butler-service';
import { InMemorySecretStore } from '../../src/main/settings/secret-store';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';
import { createContextScheduler } from '../../src/main/scheduler/app-scheduler';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-integration-'));
  dirs.push(dir);
  return dir;
}

function fixedNow(): Date {
  return new Date(2026, 9, 31, 9, 0, 0);
}

describe('context integration with real vault and butler factories', () => {
  test('creates the real workspace service and injects it into the butler', async () => {
    const dir = await tempDir();
    const vaultPath = join(dir, 'vault');
    const model = new FakeModelClient(['先做数学，再做英语。']);
    const context = await createAppContext({
      userDataPath: join(dir, 'user-data'),
      defaultVaultPath: vaultPath,
      secretStore: new InMemorySecretStore(),
      modelClient: model,
      now: fixedNow
    });

    const workspace = await context.api.createWorkspace({
      name: '数学冲刺',
      kind: 'study',
      goal: '2027 考研',
      description: '每天两小时'
    });
    const workspaces = await context.api.listWorkspaces();
    expect(workspaces.map((entry) => entry.name)).toContain('数学冲刺');
    await expect(stat(join(vaultPath, 'workspaces'))).resolves.toBeTruthy();

    const reply = await context.api.send({
      workspaceId: workspace.id,
      message: '今天学什么？'
    });
    expect(reply.text).toBe('先做数学，再做英语。');
    expect(model.calls).toHaveLength(1);
    const system = model.calls[0]?.messages.find((message) => message.role === 'system');
    expect(system?.content).toContain('数学冲刺');
    expect(system?.content).toContain('2027 考研');
  });

  test('uses the injected model client for workspace planning', async () => {
    const dir = await tempDir();
    const model = new FakeModelClient([
      JSON.stringify({
        tasks: [
          {
            title: '极限 10 题',
            subject: '数学',
            durationMin: 45,
            acceptance: '正确率 80%'
          },
          {
            title: '精读一篇',
            subject: '英语',
            durationMin: 30,
            acceptance: '整理 5 个表达'
          }
        ]
      })
    ]);
    const context = await createAppContext({
      userDataPath: join(dir, 'user-data'),
      defaultVaultPath: join(dir, 'vault'),
      secretStore: new InMemorySecretStore(),
      modelClient: model,
      now: fixedNow
    });

    await context.api.completeWorkspaceOnboarding({
      name: '数学冲刺',
      kind: 'study',
      goal: '考前冲刺',
      description: '每天两小时'
    });
    const workspace = (await context.api.listWorkspaces()).find(
      (entry) => entry.name === '数学冲刺'
    );
    expect(workspace).toBeDefined();

    const plan = await context.api.planWorkspace({
      workspaceId: workspace!.id,
      date: '2026-10-31',
      availableMinutes: 120
    });
    expect(plan.generatedBy).toBe('agent');
    expect(plan.date).toBe('2026-10-31');
    expect(plan.tasks.map((task) => task.subject)).toEqual(['数学', '英语']);

    const systemPrompt = model.calls[0]?.messages.find((message) => message.role === 'system');
    const userPrompt = model.calls[0]?.messages.at(-1);
    expect(systemPrompt?.content).toContain('只输出一个 JSON 对象');
    expect(userPrompt?.role).toBe('user');
    expect(userPrompt?.content).toContain('2026-10-31');
    expect(userPrompt?.content).toContain('考前冲刺');
    expect(userPrompt?.content).toContain('120 分钟');
  });

  test('rebuilds workspace and butler services when vault, key or provider changes', async () => {
    const dir = await tempDir();
    const vaultA = join(dir, 'vault-a');
    const vaultB = join(dir, 'vault-b');
    const workspaceCalls: string[] = [];
    const butlerCalls: { root: string; provider: ProviderConfig; apiKey: string | null }[] = [];
    const secrets = new InMemorySecretStore();

    const context = await createAppContext({
      userDataPath: join(dir, 'user-data'),
      defaultVaultPath: vaultA,
      secretStore: secrets,
      workspaceServiceFactory: (root) => {
        workspaceCalls.push(root);
        return createWorkspaceService(root);
      },
      butlerServiceFactory: (root, dependencies) => {
        butlerCalls.push({
          root,
          provider: dependencies.provider,
          apiKey: dependencies.apiKey
        });
        return createButlerService(root, {
          workspaceService: dependencies.workspaceService,
          provider: dependencies.provider,
          apiKey: dependencies.apiKey,
          modelClient: new FakeModelClient([`reply:${root}`])
        });
      },
      now: fixedNow
    });

    expect(workspaceCalls).toEqual([vaultA]);
    expect(butlerCalls.map((call) => call.root)).toEqual([vaultA]);

    await context.api.listWorkspaces();
    const custom = await context.api.createWorkspace({
      name: '只属于 A',
      kind: 'project',
      goal: '测试隔离',
      description: 'vault A'
    });
    expect(custom.id).toBeTruthy();

    await context.api.updateSettings({ vaultPath: vaultB });
    expect(workspaceCalls).toEqual([vaultA, vaultB]);
    expect(butlerCalls.map((call) => call.root)).toEqual([vaultA, vaultB]);
    expect(butlerCalls[1]?.apiKey).toBeNull();

    const vaultBWorkspaces = await context.api.listWorkspaces();
    expect(vaultBWorkspaces.length).toBeGreaterThan(0);
    expect(vaultBWorkspaces.some((workspace) => workspace.name === '只属于 A')).toBe(false);
    expect((await context.workspace.listWorkspaces()).some((workspace) => workspace.name === '只属于 A')).toBe(false);

    // An unchanged path must not recreate services.
    await context.api.updateSettings({ vaultPath: vaultB });
    expect(workspaceCalls).toHaveLength(2);
    expect(butlerCalls).toHaveLength(2);

    await context.api.setApiKey('sk-integration-secret');
    expect(butlerCalls).toHaveLength(3);
    expect(butlerCalls[2]?.apiKey).toBe('sk-integration-secret');
    expect(JSON.stringify(await context.api.getSettings())).not.toContain('sk-integration-secret');

    await context.api.updateSettings({
      provider: { kind: 'openai-compatible', baseURL: 'https://example.test/v1', model: 'test-model' }
    });
    expect(butlerCalls).toHaveLength(4);
    expect(butlerCalls[3]?.provider).toEqual({
      kind: 'openai-compatible',
      baseURL: 'https://example.test/v1',
      model: 'test-model'
    });
    expect(butlerCalls[3]?.apiKey).toBe('sk-integration-secret');

    const reply = await context.api.send({ message: '你好' });
    expect(reply.text).toBe(`reply:${vaultB}`);
  });

  test('refreshServices re-reads settings and rebuilds explicitly', async () => {
    const dir = await tempDir();
    const roots: string[] = [];
    const context = await createAppContext({
      userDataPath: join(dir, 'user-data'),
      defaultVaultPath: join(dir, 'vault-a'),
      secretStore: new InMemorySecretStore(),
      workspaceServiceFactory: (root) => {
        roots.push(root);
        return createWorkspaceService(root);
      },
      now: fixedNow
    });

    await context.api.updateSettings({ vaultPath: join(dir, 'vault-b') });
    await context.refreshServices();
    expect(roots).toEqual([
      join(dir, 'vault-a'),
      join(dir, 'vault-b'),
      join(dir, 'vault-b')
    ]);
  });
});

  test('context scheduler creates proactive check-ins without auto-planning tasks', async () => {
    const dir = await tempDir();
    const model = new FakeModelClient([
      '早上好，先做今天的任务。',
      '晚上好，今天感觉怎么样？'
    ]);
    let now = new Date(2026, 9, 31, 7, 59, 0);
    const context = await createAppContext({
      userDataPath: join(dir, 'user-data'),
      defaultVaultPath: join(dir, 'vault'),
      secretStore: new InMemorySecretStore(),
      modelClient: model,
      now: () => now
    });
    await context.api.completeWorkspaceOnboarding({
      name: '数学冲刺',
      kind: 'study',
      goal: '考前冲刺',
      description: '每天两小时'
    });
    const workspace = (await context.api.listWorkspaces()).find(
      (entry) => entry.name === '数学冲刺'
    );
    expect(workspace).toBeDefined();

    const notifications: string[] = [];
    const scheduler = createContextScheduler({
      context,
      now: () => now,
      notify: (notification) => {
        notifications.push(notification.kind);
      }
    });

    expect((await scheduler.tick()).delivered).toHaveLength(0);

    now = new Date(2026, 9, 31, 8, 0, 0);
    const morning = await scheduler.tick();
    expect(morning.delivered.map((entry) => entry.kind)).toEqual(['morning-plan']);
    expect(model.calls).toHaveLength(1);
    const conversations = await context.api.listConversations();
    expect(conversations.some((entry) => entry.kind === 'check-in')).toBe(true);
    expect((await context.api.getWorkspaceSnapshot(workspace!.id)).tasks).toHaveLength(0);

    now = new Date(2026, 9, 31, 8, 1, 0);
    expect((await scheduler.tick()).delivered).toHaveLength(0);
    expect(model.calls).toHaveLength(1);

    now = new Date(2026, 9, 31, 21, 30, 0);
    const evening = await scheduler.tick();
    expect(evening.delivered.map((entry) => entry.kind)).toEqual(['evening-review']);
    expect(model.calls).toHaveLength(2);
    expect(notifications).toEqual(['morning-plan', 'evening-review']);
  });
