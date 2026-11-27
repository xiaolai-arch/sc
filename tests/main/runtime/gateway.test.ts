import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ToolGateway,
  type GatewayRunSession,
  type GatewayToolEntry,
  type GatewayToolDefinitionView
} from '../../../src/main/runtime/tool-gateway';
import { BUTLER_TOOL_LEVELS, registerButlerTools } from '../../../src/main/runtime/butler-bridge';
import { createButlerTools, type ButlerToolContext } from '../../../src/main/butler/tools';
import { createWorkspaceService } from '../../../src/main/workspace/create-workspace-service';
import type { EngineEvent, RunEvent } from '../../../src/main/runtime/contracts';
import type {
  AvailableMinutesSource,
  PlanWorkspaceInput,
  WorkspacePlan,
  WorkspacePlanner
} from '../../../src/shared/planning';
import type { WorkspaceService } from '../../../src/shared/workspace';

const NOW = new Date(2026, 10, 27, 8, 0, 0); // 2026-11-27 08:00 local
const now = (): Date => new Date(NOW);

function butlerStub(overrides: Partial<ButlerToolContext> = {}): ButlerToolContext {
  return { workspace: {} as ButlerToolContext['workspace'], now, ...overrides };
}

interface SessionBox {
  session: GatewayRunSession;
  events: EngineEvent[];
}

function makeSession(gateway: ToolGateway, runId = 'run-1', butler?: ButlerToolContext): SessionBox {
  const events: EngineEvent[] = [];
  const session = gateway.createSession({
    runId,
    butler: butler ?? butlerStub(),
    emit: (event) => events.push(event)
  });
  return { session, events };
}

function spyEntry(
  name: string,
  options: {
    level?: GatewayToolEntry['level'];
    calls?: unknown[];
    failWith?: Error;
    impl?: (input: Record<string, unknown>) => Promise<unknown> | unknown;
  } = {}
): GatewayToolEntry {
  const calls = options.calls ?? [];
  return {
    name,
    level: options.level ?? 'confirm',
    description: `测试工具 ${name}`,
    parameters: { type: 'object', properties: {} },
    async execute(input) {
      calls.push(input);
      if (options.failWith) throw options.failWith;
      if (options.impl) return options.impl(input);
      return { echo: input, name };
    }
  };
}

test('验收 4a：未注册工具被网关拒绝，模型收到 tool.failed 错误回执而非静默', async () => {
  const gateway = new ToolGateway();
  const { session, events } = makeSession(gateway);
  const outcome = await session.invoke('nope', { a: 1 });
  expect(outcome.ok).toBe(false);
  expect(outcome.reason).toBe('unknown-tool');
  expect(outcome.error).toBe('未知工具：nope');
  expect(events).toEqual([
    {
      type: 'tool.failed',
      invocationId: outcome.invocationId,
      tool: 'nope',
      reason: 'unknown-tool',
      error: '未知工具：nope'
    }
  ]);
});

test('验收 4b：未声明行为级的工具在注册时被拒，运行期兜底同样返回 tool.failed', async () => {
  const gateway = new ToolGateway();
  expect(() =>
    gateway.register({ ...spyEntry('x'), level: undefined as unknown as 'query' })
  ).toThrow('未声明合法行为级');

  // 兜底路径：即便坏条目混进注册表（如运行期被改坏），调用仍被拒绝。
  const entries = (gateway as unknown as { entries: Map<string, GatewayToolEntry> }).entries;
  entries.set('bad', { ...spyEntry('bad'), level: undefined as unknown as 'query' });
  const { session, events } = makeSession(gateway);
  const outcome = await session.invoke('bad');
  expect(outcome).toMatchObject({ ok: false, reason: 'undeclared-level' });
  expect(events[0]).toMatchObject({ type: 'tool.failed', tool: 'bad', reason: 'undeclared-level' });
});

test('注册表：重名与空名是编程错误，直接抛错', () => {
  const gateway = new ToolGateway();
  gateway.register(spyEntry('dup'));
  expect(() => gateway.register(spyEntry('dup'))).toThrow('工具已注册');
  expect(() => gateway.register({ ...spyEntry(''), name: '' })).toThrow('缺少 name');
  expect(gateway.names()).toEqual(['dup']);
});

test('查询级自动执行：无需审批，直接 tool.committed', async () => {
  const gateway = new ToolGateway();
  const calls: unknown[] = [];
  gateway.register(spyEntry('get_today_plan', { level: 'query', calls }));
  const { session, events } = makeSession(gateway);
  const outcome = await session.invoke('get_today_plan', { workspaceId: 'ws-1' });
  expect(outcome.ok).toBe(true);
  expect(calls).toEqual([{ workspaceId: 'ws-1' }]);
  expect(events).toEqual([
    { type: 'tool.committed', invocationId: outcome.invocationId, tool: 'get_today_plan' }
  ]);
});

test('验收 5a（含审批）：提交 → 同参拒 → 换参新审批 → 放行', async () => {
  const gateway = new ToolGateway();
  const calls: unknown[] = [];
  gateway.register(spyEntry('commit_plan', { calls }));
  const { session, events } = makeSession(gateway);
  const args = { workspaceId: 'ws-1', date: '2026-11-27' };

  const firstPromise = session.invoke('commit_plan', args);
  expect(events.at(-1)).toMatchObject({
    type: 'approval.requested',
    tool: 'commit_plan',
    params: args
  });
  expect(session.decide('approved')).toBe(true);
  const first = await firstPromise;
  expect(first.ok).toBe(true);
  expect(calls).toEqual([args]);

  // 同参同范围 → 拒（验收 5a），不产生新审批、不再执行。
  const dupPromise = session.invoke('commit_plan', { ...args });
  const dup = await dupPromise;
  expect(dup).toMatchObject({ ok: false, reason: 'duplicate' });
  expect(calls).toEqual([args]);
  const dupFailed = events.at(-1) as Extract<EngineEvent, { type: 'tool.failed' }>;
  expect(dupFailed).toMatchObject({ type: 'tool.failed', reason: 'duplicate' });

  // 换参 → 全新审批（批准绑定这一次操作+项目+参数）。
  const changedArgs = { workspaceId: 'ws-2', date: '2026-11-27' };
  const secondPromise = session.invoke('commit_plan', changedArgs);
  expect(events.at(-1)).toMatchObject({ type: 'approval.requested', params: changedArgs });
  expect(session.decide('approved')).toBe(true);
  const second = await secondPromise;
  expect(second.ok).toBe(true);
  expect(calls).toEqual([args, changedArgs]);
});

test('验收 5b：tool.failed 后同参重试放行', async () => {
  const gateway = new ToolGateway();
  const calls: unknown[] = [];
  const failWith = new Error('vault 写入失败');
  let failNext = true;
  gateway.register({
    ...spyEntry('commit_plan', { calls }),
    async execute(input) {
      calls.push(input);
      if (failNext) {
        failNext = false;
        throw failWith;
      }
      return { committed: true };
    }
  });
  const { session } = makeSession(gateway);

  const args = { workspaceId: 'ws-1', date: '2026-11-27' };
  const firstPromise = session.invoke('commit_plan', args);
  expect(session.decide('approved')).toBe(true);
  const first = await firstPromise;
  expect(first).toMatchObject({ ok: false, reason: 'failed', error: 'vault 写入失败' });

  // 失败不进去重键：同参重试放行，这次成功提交。
  const retryPromise = session.invoke('commit_plan', { ...args });
  expect(session.decide('approved')).toBe(true);
  const retry = await retryPromise;
  expect(retry.ok).toBe(true);
  expect(calls).toEqual([args, args]);
});

test('拒绝路径：用户拒绝 → tool.failed（reason=rejected），模型收到回执', async () => {
  const gateway = new ToolGateway();
  const calls: unknown[] = [];
  gateway.register(spyEntry('update_task', { calls }));
  const { session, events } = makeSession(gateway);
  const promise = session.invoke('update_task', { taskId: 't1' });
  expect(session.decide('rejected')).toBe(true);
  const outcome = await promise;
  expect(outcome).toMatchObject({ ok: false, reason: 'rejected' });
  expect(calls).toEqual([]);
  expect(events.at(-1)).toMatchObject({ type: 'tool.failed', reason: 'rejected' });
});

test('权限门：write=false 时确认级被拒、查询级放行（文案与旧执行器一致）', async () => {
  const gateway = new ToolGateway();
  const calls: unknown[] = [];
  gateway.register(spyEntry('create_task', { calls }));
  gateway.register(spyEntry('get_memory', { level: 'query', calls }));
  const { session } = makeSession(
    gateway,
    'run-1',
    butlerStub({ permissions: { web: true, write: false, shell: false } })
  );
  const writeOutcome = await session.invoke('create_task', { title: 'x' });
  expect(writeOutcome).toMatchObject({ ok: false, reason: 'permission' });
  expect(writeOutcome.error).toContain('仅可查看');
  const readOutcome = await session.invoke('get_memory');
  expect(readOutcome.ok).toBe(true);
  expect(calls).toEqual([{}]); // 只有查询级真正执行
});

test('模型参数容错：字符串 JSON 参数按旧执行器语义归一化', async () => {
  const gateway = new ToolGateway();
  const calls: unknown[] = [];
  gateway.register(spyEntry('get_today_plan', { level: 'query', calls }));
  const { session } = makeSession(gateway);
  const outcome = await session.invoke('get_today_plan', '{"workspaceId":"ws-1"}' as unknown as Record<string, unknown>);
  expect(outcome.ok).toBe(true);
  expect(calls).toEqual([{ workspaceId: 'ws-1' }]);
  expect(await session.invoke('get_today_plan', 'not-json' as unknown as Record<string, unknown>)).toMatchObject({
    ok: false,
    reason: 'failed'
  });
});

test('取消后的会话：invoke 一律拒绝（reason=cancelled），不执行、不进事件流', async () => {
  const gateway = new ToolGateway();
  const calls: unknown[] = [];
  gateway.register(spyEntry('get_memory', { level: 'query', calls }));
  const { session, events } = makeSession(gateway);
  session.abortPending();
  const outcome = await session.invoke('get_memory');
  expect(outcome).toMatchObject({ ok: false, reason: 'cancelled' });
  expect(calls).toEqual([]);
  expect(events).toEqual([]);
});

test('去重键含项目范围：不同 workspaceId 的同形参数不算重复', async () => {
  const gateway = new ToolGateway();
  const calls: unknown[] = [];
  gateway.register(spyEntry('commit_plan', { calls }));
  const { session } = makeSession(gateway);
  const first = session.invoke('commit_plan', { workspaceId: 'ws-a', date: '2026-11-27' });
  expect(session.decide('approved')).toBe(true);
  expect((await first).ok).toBe(true);
  const second = session.invoke('commit_plan', { workspaceId: 'ws-b', date: '2026-11-27' });
  expect(session.decide('approved')).toBe(true);
  expect((await second).ok).toBe(true);
  expect(calls).toHaveLength(2);
});

test('19 个管家工具全部经网关注册为薄包装，标级表与新增两个工具齐备', () => {
  const gateway = new ToolGateway();
  registerButlerTools(gateway);
  const legacy = createButlerTools();
  expect(legacy).toHaveLength(19);
  expect(gateway.names()).toHaveLength(21); // 19 旧 + plan_preview + commit_plan
  const definitions = new Map<string, GatewayToolDefinitionView>(
    gateway.definitions().map((definition) => [definition.name, definition])
  );
  const expectedLevels: Record<string, string> = {
    ...BUTLER_TOOL_LEVELS
  };
  for (const tool of legacy) {
    const definition = definitions.get(tool.name);
    expect(definition).toBeDefined();
    expect(definition?.level).toBe(expectedLevels[tool.name]);
    // 薄包装保留模型可见的 schema 与描述（逐字段一致）。
    expect(definition?.description).toBe(tool.description);
    expect(definition?.parameters).toEqual(tool.parameters);
  }
  expect(definitions.get('plan_preview')?.level).toBe('query');
  expect(definitions.get('commit_plan')?.level).toBe('confirm');
});

test('薄包装委托同一实现函数：plan_workspace 别名条目调用旧执行体', async () => {
  const gateway = new ToolGateway();
  const legacy = createButlerTools();
  const calls: Array<Record<string, unknown>> = [];
  const wrapped = legacy.map((tool) =>
    tool.name === 'plan_workspace'
      ? {
          ...tool,
          execute: async (input: Record<string, unknown>) => {
            calls.push(input);
            return { delegated: true, input };
          }
        }
      : tool
  );
  registerButlerTools(gateway, { tools: wrapped, includePlanSplit: false });
  const { session } = makeSession(gateway);
  const args = { workspaceId: 'ws-1', date: '2026-11-27' };
  const promise = session.invoke('plan_workspace', args);
  expect(session.decide('approved')).toBe(true);
  const outcome = (await promise) as { ok: boolean; result?: { delegated: boolean } };
  expect(outcome.ok).toBe(true);
  expect(outcome.result).toMatchObject({ delegated: true });
  expect(calls).toEqual([args]);
});

test('标级防呆：query 级但未声明 requiresWrite:false 的工具注册即抛错', () => {
  const gateway = new ToolGateway();
  const legacy = createButlerTools();
  const poisoned = legacy.map((tool) =>
    tool.name === 'get_practice_overview' ? { ...tool, requiresWrite: true } : tool
  );
  expect(() => registerButlerTools(gateway, { tools: poisoned })).toThrow(
    'get_practice_overview 标为 query 但未声明 requiresWrite:false'
  );
});

test('标级防呆：新增工具缺标级表条目 → 注册即抛错', () => {
  const gateway = new ToolGateway();
  const legacy = createButlerTools();
  const extra = [
    ...legacy,
    {
      name: 'future_tool',
      description: '未来的工具',
      parameters: { type: 'object', properties: {} },
      execute: async () => null
    }
  ];
  expect(() => registerButlerTools(gateway, { tools: extra })).toThrow('future_tool 未在标级表');
});

test('验收 6：plan_preview 零写盘；commit_plan 才写入且 due=plan.date', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-runtime-plan-split-'));
  try {
    const service = createWorkspaceService(dir, { seed: false });
    const workspace = await service.createWorkspace({
      name: '考研',
      kind: 'exam',
      goal: '上岸',
      description: ''
    });

    const plannerInputs: PlanWorkspaceInput[] = [];
    const planDate = '2026-11-30'; // ≠ 今天：due 必须跟 plan.date，不是 now
    const planner: WorkspacePlanner = {
      plan: async (input: PlanWorkspaceInput): Promise<WorkspacePlan> => {
        plannerInputs.push(input);
        const availableMinutesSource: AvailableMinutesSource =
          input.availableMinutes !== undefined ? 'input' : 'default';
        return {
          workspaceId: input.workspaceId,
          date: planDate,
          generatedBy: 'template',
          tasks: [
            { title: '极简复盘', subject: '数学', durationMin: 10, acceptance: '完成一套真题' }
          ],
          availableMinutes: input.availableMinutes ?? 120,
          availableMinutesSource
        };
      }
    };
    const butler = butlerStub({
      workspace: service as WorkspaceService,
      workspaceId: workspace.id,
      planner
    } as Partial<ButlerToolContext>);

    const gateway = new ToolGateway();
    registerButlerTools(gateway, { includePlanSplit: true });
    const { session, events } = makeSession(gateway, 'run-1', butler);

    const snapshot = await snapshotVault(dir);
    const preview = (await session.invoke('plan_preview', {})) as {
      ok: boolean;
      result?: WorkspacePlan & { workspaceId: string };
    };
    expect(preview.ok).toBe(true);
    expect(preview.result).toMatchObject({
      workspaceId: workspace.id,
      date: planDate,
      generatedBy: 'template'
    });
    // 省略 date：预览把统一时钟的「今天」交给 planner；planner 返回的
    // plan.date（2026-11-30）才是写入用的 due。
    expect(plannerInputs).toEqual([{ workspaceId: workspace.id, date: '2026-11-27' }]);
    // 零写盘探针：预览前后 vault 逐文件一致。
    expect(await snapshotVault(dir)).toEqual(snapshot);
    expect(events.every((event) => event.type !== 'approval.requested')).toBe(true);

    // 提交：按预览建任务，due=plan.date。
    const tasks = preview.result?.tasks ?? [];
    const commitPromise = session.invoke('commit_plan', {
      workspaceId: workspace.id,
      date: preview.result?.date,
      tasks
    });
    expect(events.at(-1)).toMatchObject({ type: 'approval.requested', tool: 'commit_plan' });
    expect(session.decide('approved')).toBe(true);
    const commit = (await commitPromise) as { ok: boolean };
    expect(commit.ok).toBe(true);

    const afterCommit = await service.getWorkspaceSnapshot(workspace.id);
    expect(afterCommit.tasks).toHaveLength(1);
    expect(afterCommit.tasks[0]).toMatchObject({
      title: '极简复盘',
      subject: '数学',
      durationMin: 10,
      acceptance: '完成一套真题',
      due: planDate
    });
    expect(await snapshotVault(dir)).not.toEqual(snapshot);

    // 无效日期：服务拒绝、不写盘。
    const snapshotBeforeInvalid = await snapshotVault(dir);
    const invalidPromise = session.invoke('commit_plan', {
      workspaceId: workspace.id,
      date: '2026-02-30',
      tasks
    });
    expect(session.decide('approved')).toBe(true);
    const invalid = await invalidPromise;
    expect(invalid).toMatchObject({ ok: false, reason: 'failed' });
    expect(invalid.error).toContain('YYYY-MM-DD');
    expect(await snapshotVault(dir)).toEqual(snapshotBeforeInvalid);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** 递归快照：相对路径 → 内容，用作临时 vault 的零写盘探针。 */
async function snapshotVault(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(relative: string): Promise<void> {
    const absolute = join(root, relative);
    const entries = await readdir(absolute, { withFileTypes: true });
    for (const entry of entries) {
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(child);
      } else {
        files.set(child, await readFile(join(root, child), 'utf8'));
      }
    }
  }
  await walk('');
  return files;
}

test('验收 6 对照：旧 plan_workspace（别名）在网关下仍一体生成+写入', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-runtime-plan-alias-'));
  try {
    const service = createWorkspaceService(dir, { seed: false });
    const workspace = await service.createWorkspace({
      name: '英语',
      kind: 'study',
      goal: '流利读外刊',
      description: ''
    });
    const planner: WorkspacePlanner = {
      plan: async (input: PlanWorkspaceInput): Promise<WorkspacePlan> => ({
        workspaceId: input.workspaceId,
        date: input.date ?? '2026-11-27',
        generatedBy: 'template',
        tasks: [{ title: '读一篇外刊', subject: '英语', durationMin: 20, acceptance: '读完并摘 5 句' }],
        availableMinutes: 120,
        availableMinutesSource: 'default'
      })
    };
    const butler = butlerStub({
      workspace: service as WorkspaceService,
      workspaceId: workspace.id,
      planner
    } as Partial<ButlerToolContext>);
    const gateway = new ToolGateway();
    registerButlerTools(gateway, { includePlanSplit: false });
    const { session } = makeSession(gateway, 'run-1', butler);
    const promise = session.invoke('plan_workspace', { date: '2026-11-27' });
    expect(session.decide('approved')).toBe(true);
    const outcome = (await promise) as { ok: boolean };
    expect(outcome.ok).toBe(true);
    const snapshot = await service.getWorkspaceSnapshot(workspace.id);
    expect(snapshot.tasks).toHaveLength(1); // 别名条目仍是旧的「生成+写入」一体语义
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('RunEvent 工具回执可还原为 RunEvent 形状（事件载荷字段齐备）', async () => {
  const gateway = new ToolGateway();
  gateway.register(spyEntry('commit_plan', {}));
  const { session, events } = makeSession(gateway, 'run-x');
  const promise = session.invoke('commit_plan', { workspaceId: 'ws-1' });
  const requested = events.at(-1) as Extract<EngineEvent, { type: 'approval.requested' }>;
  expect(requested).toMatchObject({
    type: 'approval.requested',
    tool: 'commit_plan',
    params: { workspaceId: 'ws-1' }
  });
  expect(typeof requested.invocationId).toBe('string');
  expect(session.decide('approved')).toBe(true);
  await promise;
  const committed = events.at(-1) as Extract<EngineEvent, { type: 'tool.committed' }>;
  expect(committed).toMatchObject({
    type: 'tool.committed',
    tool: 'commit_plan',
    invocationId: requested.invocationId
  });
  const asRunEvent = committed as unknown as Partial<RunEvent>;
  expect(asRunEvent.seq).toBeUndefined(); // 引擎事件不带序号；序号由 RunController 盖章
});
