import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderConfig } from '../../src/shared/types';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { createAppContext } from '../../src/main/context';
import { createButlerService } from '../../src/main/butler/create-butler-service';
import { InMemorySecretStore } from '../../src/main/settings/secret-store';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';
import { createContextScheduler } from '../../src/main/scheduler/app-scheduler';
import { parseWeekAvailabilityFile, serializeWeekAvailabilityFile } from '../../src/main/availability/records';
import { BUSY_DAY_MINUTES } from '../../src/main/planning';

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

  test('plans a stored busy day as one small task without overriding an explicit budget', async () => {
    const dir = await tempDir();
    const model = new FakeModelClient([
      JSON.stringify({
        tasks: [
          { title: '极限 10 题', subject: '数学', durationMin: 10, acceptance: '正确率 80%' }
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

    // The Sunday answer: next week's Tuesday is packed (fixedNow = 2026-10-31,
    // so the coming Monday is 2026-11-02).
    await writeFile(
      join(dir, 'vault', 'week-availability.md'),
      serializeWeekAvailabilityFile([
        {
          id: 'wa-1',
          weekStart: '2026-11-02',
          busyDates: ['2026-11-03'],
          createdAt: '2026-10-31T09:00:00.000Z'
        }
      ]),
      'utf8'
    );

    const busy = await context.api.planWorkspace({
      workspaceId: workspace!.id,
      date: '2026-11-03'
    });
    expect(busy.availableMinutes).toBe(BUSY_DAY_MINUTES);
    expect(busy.availableMinutesSource).toBe('week');
    const busyPrompt = model.calls[0]?.messages.at(-1)?.content ?? '';
    expect(busyPrompt).toContain('今日可用时间：约 10 分钟（来自你说的一周安排）');
    expect(busyPrompt).toContain(
      '这天用户说特别满：只安排 1 个不超过 10 分钟的小任务，不要凑满时间。'
    );

    // Another day of the same week keeps the default budget and prompt.
    const normal = await context.api.planWorkspace({
      workspaceId: workspace!.id,
      date: '2026-11-04'
    });
    expect(normal.availableMinutes).toBe(120);
    expect(normal.availableMinutesSource).toBe('default');
    expect(model.calls[1]?.messages.at(-1)?.content ?? '').not.toContain('这天用户说特别满');
    expect(model.calls[1]?.messages.at(-1)?.content ?? '').toContain('120 分钟');

    // An explicit budget wins over the stored busy day.
    const explicit = await context.api.planWorkspace({
      workspaceId: workspace!.id,
      date: '2026-11-03',
      availableMinutes: 30
    });
    expect(explicit.availableMinutes).toBe(30);
    expect(explicit.availableMinutesSource).toBe('input');
    expect(model.calls[2]?.messages.at(-1)?.content ?? '').not.toContain(
      '这天用户说特别满'
    );

    // Clearing the week removes the busy-day rule at the same read path the
    // planner uses: the same Tuesday plans with the default budget again, and
    // the vault file holds no record for that week any more.
    await context.api.clearWeekAvailability({ weekStart: '2026-11-02' });
    const afterClear = await context.api.planWorkspace({
      workspaceId: workspace!.id,
      date: '2026-11-03'
    });
    expect(afterClear.availableMinutes).toBe(120);
    expect(afterClear.availableMinutesSource).toBe('default');
    expect(model.calls[3]?.messages.at(-1)?.content ?? '').not.toContain('这天用户说特别满');
    const vaultRoot = (await context.api.getSettings()).vaultPath;
    const remaining = parseWeekAvailabilityFile(
      await readFile(join(vaultRoot, 'week-availability.md'), 'utf8')
    );
    expect(remaining).toEqual([]);
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

  test('keeps history, model and permissions when the CLI agent switches', async () => {
    const dir = await tempDir();
    const context = await createAppContext({
      userDataPath: join(dir, 'user-data'),
      defaultVaultPath: join(dir, 'vault'),
      secretStore: new InMemorySecretStore(),
      now: fixedNow
    });

    const created = await context.api.createConversation({
      title: '极限练习',
      permissions: { web: true, write: false, shell: false }
    });
    await context.api.appendConversationMessage(created.id, {
      id: 'm1',
      role: 'user',
      text: '帮我找极限的题目',
      createdAt: '2026-11-21T09:00:00.000Z'
    });
    await context.api.appendConversationMessage(created.id, {
      id: 'm2',
      role: 'assistant',
      text: '先做这 10 道，做完我帮你复盘。',
      createdAt: '2026-11-21T09:01:00.000Z'
    });
    // Both overrides live on the conversation, not on the global provider.
    await context.api.setConversationModel(created.id, 'codex/gpt-6.1-mini');
    await context.api.setConversationPermissions(created.id, {
      web: false,
      write: true,
      shell: false
    });

    const before = await context.api.getConversation(created.id);
    const beforeList = await context.api.listConversations();
    expect(before?.messages).toHaveLength(2);
    expect(before?.model).toBe('codex/gpt-6.1-mini');
    expect(before?.permissions).toEqual({ web: false, write: true, shell: false });
    expect((await context.api.getSettings()).provider).toEqual({
      kind: 'local-cli',
      agent: 'codex',
      command: 'codex'
    });

    // The same path the settings page uses: codex CLI -> claude CLI.
    await context.api.updateSettings({
      provider: { kind: 'local-cli', agent: 'claude', command: 'claude' }
    });

    // Guards against a vacuous pass: the provider really did switch.
    expect((await context.api.getSettings()).provider).toEqual({
      kind: 'local-cli',
      agent: 'claude',
      command: 'claude'
    });

    const after = await context.api.getConversation(created.id);
    expect(after).toEqual(before);
    // Byte-for-byte: a re-read from disk must be identical to the pre-switch copy.
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(after?.messages.map((message) => message.text)).toEqual([
      '帮我找极限的题目',
      '先做这 10 道，做完我帮你复盘。'
    ]);
    expect(after?.model).toBe('codex/gpt-6.1-mini');
    expect(after?.permissions).toEqual({ web: false, write: true, shell: false });
    expect(await context.api.listConversations()).toEqual(beforeList);
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

test('skips proactive check-ins once the daily token budget is spent', async () => {
  const dir = await tempDir();
  const model = new FakeModelClient(['不该被调用']);
  const context = await createAppContext({
    userDataPath: join(dir, 'user-data'),
    defaultVaultPath: join(dir, 'vault'),
    secretStore: new InMemorySecretStore(),
    modelClient: model,
    now: fixedNow
  });

  await context.usage.record({
    provider: 'local-cli',
    model: 'fake',
    inputTokens: 600,
    outputTokens: 500
  });
  const current = await context.api.getSettings();
  await context.api.updateSettings({
    budget: { ...current.budget, dailyTokens: 1000 }
  });

  expect(await context.checkIns.check('morning', '2026-10-31')).toBeNull();
  expect(model.calls).toHaveLength(0);
});

test('a butler-recorded promise comes back once on the next morning check-in', async () => {
  const dir = await tempDir();
  const model = new FakeModelClient([
    // 1) the chat turn records the promise
    {
      text: '',
      usage: { inputTokens: 0, outputTokens: 0 },
      toolCalls: [
        {
          id: 'c1',
          name: 'record_commitment',
          arguments: { text: '背 20 个单词', due: '2026-11-01' }
        }
      ]
    },
    { text: '记下了，明天见。', usage: { inputTokens: 0, outputTokens: 0 } },
    // 2) the morning check-in of the due day
    '早上好，今天先做极限基础。'
  ]);
  const context = await createAppContext({
    userDataPath: join(dir, 'user-data'),
    defaultVaultPath: join(dir, 'vault'),
    secretStore: new InMemorySecretStore(),
    modelClient: model,
    now: fixedNow
  });

  await context.butler.send({ message: '我明天背 20 个单词' });

  const notification = await context.checkIns.check('morning', '2026-11-01');
  expect(notification).not.toBeNull();
  const conversation = await context.conversationStore.get(notification!.conversationId!);
  expect(conversation?.messages[0]?.text).toBe(
    '早上好，今天先做极限基础。\n你说今天要做「背 20 个单词」，做了吗？'
  );

  // Recorded in the vault, readable and open.
  const raw = await readFile(join(dir, 'vault', 'commitments.md'), 'utf8');
  expect(raw).toContain('背 20 个单词');
  expect(raw).toContain("due: '2026-11-01'");
  expect(raw).toContain('status: open');
});

test('a promise follows the person: it is asked even when its project has check-in off', async () => {
  // M2: a promise recorded inside a check-in-disabled project was dropped by
  // `readDueCommitment`. The owner's semantics: a promise follows the person.
  const dir = await tempDir();
  const model = new FakeModelClient(['早上好。']);
  const context = await createAppContext({
    userDataPath: join(dir, 'user-data'),
    defaultVaultPath: join(dir, 'vault'),
    secretStore: new InMemorySecretStore(),
    modelClient: model,
    now: fixedNow
  });
  // One project stays on so the check itself is allowed to run; a second one is
  // opted out of check-ins and holds the promise.
  await context.api.createWorkspace({
    name: '数学',
    kind: 'study',
    goal: '基础',
    description: ''
  });
  const off = await context.api.createWorkspace({
    name: '外刊精读',
    kind: 'study',
    goal: '读懂外刊',
    description: ''
  });
  await context.api.updateWorkspace!({ workspaceId: off.id, checkIn: 'off' });
  // A promise recorded against that project, due today.
  await context.commitments.create({
    text: '背 20 个单词',
    due: '2026-10-31',
    workspaceId: off.id
  });

  // Tasks/memory/topics from that project stay filtered out, but the promise
  // is still asked, so the change is only about the promise.
  const notification = await context.checkIns.check('morning', '2026-10-31');
  expect(notification).not.toBeNull();
  const conversation = await context.conversationStore.get(notification!.conversationId!);
  expect(conversation?.messages[0]?.text).toContain(
    '你说今天要做「背 20 个单词」，做了吗？'
  );
  // The opted-out project is not named in the prompt the model saw.
  expect(model.calls.at(-1)?.messages[0]?.content).not.toContain(off.name);
});

test('a promise with no project is asked exactly as before', async () => {
  const dir = await tempDir();
  const context = await createAppContext({
    userDataPath: join(dir, 'user-data'),
    defaultVaultPath: join(dir, 'vault'),
    secretStore: new InMemorySecretStore(),
    modelClient: null,
    now: fixedNow
  });
  // No workspace opt-out anywhere; the promise has no workspaceId.
  await context.commitments.create({ text: '整理错题', due: '2026-10-31' });

  const notification = await context.checkIns.check('morning', '2026-10-31');
  expect(notification).not.toBeNull();
  const conversation = await context.conversationStore.get(notification!.conversationId!);
  expect(conversation?.messages[0]?.text).toContain(
    '你说今天要做「整理错题」，做了吗？'
  );
});

test('the accountability name reaches only the weekly clause, never a record', async () => {
  const dir = await tempDir();
  const model = new FakeModelClient([
    // 1) the promise is recorded in the chat turn
    {
      text: '',
      usage: { inputTokens: 0, outputTokens: 0 },
      toolCalls: [
        {
          id: 'c1',
          name: 'record_commitment',
          arguments: { text: '写完第三章', due: '2026-10-31' }
        }
      ]
    },
    { text: '记下了。', usage: { inputTokens: 0, outputTokens: 0 } },
    // 2) the promise is resolved as done, still in the past week
    {
      text: '',
      usage: { inputTokens: 0, outputTokens: 0 },
      toolCalls: [
        { id: 'c2', name: 'resolve_commitment', arguments: { text: '写完第三章', outcome: 'done' } }
      ]
    },
    { text: '做到了，很好。', usage: { inputTokens: 0, outputTokens: 0 } },
    // 3) the Sunday review reply
    '这一周稳中有进。'
  ]);
  const context = await createAppContext({
    userDataPath: join(dir, 'user-data'),
    defaultVaultPath: join(dir, 'vault'),
    secretStore: new InMemorySecretStore(),
    modelClient: model,
    now: fixedNow
  });
  await context.api.updateSettings({ accountabilityName: '小林' });

  await context.butler.send({ message: '我明天写完第三章' });
  await context.butler.send({ message: '写完了' });

  const notification = await context.checkIns.check('weekly', '2026-11-01');
  expect(notification).not.toBeNull();
  const conversation = await context.conversationStore.get(notification!.conversationId!);
  const text = conversation?.messages[0]?.text ?? '';
  const clause = '你说过要做「写完第三章」，你告诉过 小林 的时间是 2026-10-31';
  expect(text.split(clause)).toHaveLength(2);
  expect(text.endsWith(clause)).toBe(true);
  // The model never sees the sentence, so it cannot reword it.
  expect(model.calls.every((call) => !call.messages.some((message) => message.content.includes(clause)))).toBe(true);

  // The user-delivered weekly review is the only surface allowed to state the
  // name. Every record the app persists must not carry it: the vault (the
  // commitments file included), the chat turns, and any review/data file.
  for (const file of await readdir(join(dir, 'vault')).catch(() => [] as string[])) {
    if (!file.endsWith('.md')) continue;
    const raw = await readFile(join(dir, 'vault', file), 'utf8');
    expect(raw).not.toContain('小林');
  }
  expect(await readFile(join(dir, 'vault', 'commitments.md'), 'utf8')).not.toContain('小林');
  // Only the weekly check-in conversation holds the clause; the two chat turns
  // that recorded and resolved the promise never mention the name.
  const chatTexts: string[] = [];
  for (const summary of await context.conversationStore.list()) {
    const conversationRecord = await context.conversationStore.get(summary.id);
    for (const message of conversationRecord?.messages ?? []) {
      if (message.trigger === undefined) chatTexts.push(message.text);
    }
  }
  expect(chatTexts.join('\n')).not.toContain('小林');
  expect(await readFile(join(dir, 'user-data', 'state.json'), 'utf8')).toContain(
    '"accountabilityName": "小林"'
  );
});
