import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ButlerToolContext } from '../../../src/main/butler/tools';
import { registerButlerTools } from '../../../src/main/runtime/butler-bridge';
import type { EnginePort, RunEvent, RunRequest } from '../../../src/main/runtime/contracts';
import {
  PiEngine,
  loadPiAgentCore
} from '../../../src/main/runtime/engine-pi';
import { scriptedPiModel } from '../../../src/main/runtime/engine-pi';
import { RunController } from '../../../src/main/runtime/run-controller';
import { RunJournal } from '../../../src/main/runtime/run-journal';
import { ToolGateway } from '../../../src/main/runtime/tool-gateway';
import type { WorkspacePlanner } from '../../../src/shared/planning';
import type { WorkspaceService } from '../../../src/shared/workspace';

const NOW = new Date(2026, 10, 27, 8, 0, 0); // 2026-11-27 08:00 local
const now = (): Date => new Date(NOW);

/**
 * PiEngine 单测（spec 测试表 P2 行）：模型传输层注入脚本化假模型
 * （`scriptedPiModel`），驱动**真实的 pi-agent-core 循环**——工具执行、事件
 * 映射、审批、取消、串行约束都是上游 1.6.1 的代码在跑，只有模型是假的。
 */

interface StubWorkspaceOptions {
  /** Parks every createTask until released（取消竞态注入点）。 */
  gate?: Promise<void>;
  /** Minimum per-createTask duration（串行约束的可观测化）。 */
  delayMs?: number;
}

function stubWorkspace(options: StubWorkspaceOptions = {}): {
  service: WorkspaceService;
  created: Array<Record<string, unknown>>;
  maxActive(): number;
} {
  const created: Array<Record<string, unknown>> = [];
  let active = 0;
  let maxActive = 0;
  const service = {
    listWorkspaces: async () => [],
    getWorkspaceSnapshot: async () => ({
      workspace: { id: 'ws-exam', name: '英语', kind: 'study', color: '#22c55e', goal: '', description: '' },
      tasks: [],
      notes: [],
      memory: [],
      reminders: []
    }),
    getMemory: async () => [],
    createTask: async (input: Record<string, unknown>) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (options.gate) await options.gate;
        if (options.delayMs) {
          await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        }
        const task = { id: `t-${created.length + 1}`, status: 'pending', ...input };
        created.push(task);
        return task;
      } finally {
        active -= 1;
      }
    }
  } as unknown as WorkspaceService;
  return { service, created, maxActive: () => maxActive };
}

const planner: WorkspacePlanner = {
  plan: async (input) => ({
    workspaceId: input.workspaceId,
    date: input.date ?? '2026-11-27',
    generatedBy: 'template',
    tasks: [{ title: '读一篇外刊', subject: '英语', durationMin: 20, acceptance: '读完并摘 5 句' }],
    availableMinutes: 120,
    availableMinutesSource: 'default'
  })
};

const failingPlanner: WorkspacePlanner = {
  plan: async () => {
    throw new Error('planner 炸了');
  }
};

function butlerContext(service: WorkspaceService, overrides: Partial<ButlerToolContext> = {}): ButlerToolContext {
  return {
    workspace: service,
    workspaceId: 'ws-exam',
    planner,
    now,
    ...overrides
  };
}

function makeRequest(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    runId: 'run-1',
    sessionId: 'conv-1',
    origin: 'chat',
    workspaceIds: ['ws-exam'],
    userInput: '帮我安排今天的计划',
    engineId: 'pi',
    now,
    ...overrides
  };
}

interface Harness {
  controller: RunController;
  gateway: ToolGateway;
  journal: RunJournal;
  dir: string;
  dispose(): Promise<void>;
}

async function makeHarness(engines: EnginePort[]): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-runtime-pi-'));
  const journal = new RunJournal({ dirPath: join(dir, 'runtime-runs'), now });
  const gateway = new ToolGateway();
  registerButlerTools(gateway);
  const controller = new RunController({ engines, gateway, journal });
  return {
    controller,
    gateway,
    journal,
    dir,
    async dispose(): Promise<void> {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

function collect(controller: RunController, runId: string): {
  events: RunEvent[];
  waitFor(predicate: (event: RunEvent) => boolean): Promise<RunEvent>;
} {
  const events: RunEvent[] = [];
  const waiters: Array<{
    predicate: (event: RunEvent) => boolean;
    resolve: (event: RunEvent) => void;
  }> = [];
  controller.subscribe(runId, (event) => {
    events.push(event);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      if (waiters[index].predicate(event)) {
        waiters[index].resolve(event);
        waiters.splice(index, 1);
      }
    }
  });
  return {
    events,
    waitFor: (predicate) => {
      const found = events.find(predicate);
      if (found) return Promise.resolve(found);
      return new Promise((resolve) => {
        waiters.push({ predicate, resolve });
      });
    }
  };
}

function makeEngine(
  gateway: ToolGateway,
  rounds: Parameters<typeof scriptedPiModel>[0],
  overrides: Partial<ConstructorParameters<typeof PiEngine>[0]> = {}
): PiEngine {
  return new PiEngine({
    streamFn: scriptedPiModel(rounds),
    tools: gateway,
    systemPrompt: '你是学习管家。',
    ...overrides
  });
}

test('PiEngine 是 EnginePort（id=pi，结构兼容 P0 契约），动态加载器可用', async () => {
  const gateway = new ToolGateway();
  const engine = makeEngine(gateway, []);
  const port: EnginePort = engine;
  expect(port.id).toBe('pi');
  expect(typeof port.run).toBe('function');
  const module = await loadPiAgentCore();
  expect(typeof module.Agent).toBe('function');
  // 契约形状：run 接受 RunContext 并返回 void promise（编译期已校验，这里防手滑改签名）。
  expect(port.run.length).toBe(1);
});

test('事件映射：text_delta→text.delta、工具经网关 committed+回执、agent_end 不映射，终态 completed', async () => {
  const stub = stubWorkspace();
  const gateway = new ToolGateway();
  registerButlerTools(gateway);
  const engine = makeEngine(gateway, [
    { deltas: ['我先看看今天有什么安排。'], toolCalls: [{ id: 'q1', name: 'get_today_plan', arguments: {} }] },
    { deltas: ['需要建一个任务，我来创建。'], toolCalls: [{ id: 'c1', name: 'create_task', arguments: { title: '任务A', durationMin: 5 } }] },
    { finalText: '今天的安排好了。' }
  ]);
  const { controller, journal, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext(stub.service) });
    await collector.waitFor((event) => event.type === 'approval.requested');
    expect(await controller.approve('run-1', 'approved')).toBe(true);
    expect(await handle.done).toBe('completed');

    expect(collector.events.map((event) => event.type)).toEqual([
      'run.started',
      'text.delta', // 第一轮 text_delta → text.delta
      'tool.committed', // get_today_plan（query 级，网关直执行）
      'text.delta',
      'approval.requested', // create_task（confirm 级）→ 审批
      'tool.committed',
      'service.receipt', // 缝①：确认级服务成功 → 回执（与 Legacy 同缝）
      'text.delta', // 收尾文本
      'run.finished' // agent_end 不映射；控制器合成
    ]);
    const deltas = collector.events
      .filter((event) => event.type === 'text.delta')
      .map((event) => (event as { text: string }).text);
    expect(deltas).toEqual(['我先看看今天有什么安排。', '需要建一个任务，我来创建。', '今天的安排好了。']);
    const receipt = collector.events.find((event) => event.type === 'service.receipt');
    expect(receipt).toMatchObject({ detail: '创建任务 成功' });
    expect(collector.events.at(-1)).toMatchObject({ type: 'run.finished', state: 'completed' });
    expect(controller.getRun('run-1')?.state).toBe('completed');
    expect(stub.created).toHaveLength(1);
    const journaled = await journal.readRun('run-1');
    expect(journaled.map((event) => event.type)).toEqual(collector.events.map((event) => event.type));
  } finally {
    await dispose();
  }
});

test('缝②串行约束：同一轮两个工具调用逐个执行（maxActive=1，顺序与入参一致）', async () => {
  const stub = stubWorkspace({ delayMs: 15 });
  const gateway = new ToolGateway();
  registerButlerTools(gateway);
  const engine = makeEngine(gateway, [
    {
      toolCalls: [
        { id: 's1', name: 'create_task', arguments: { title: '任务A', durationMin: 5 } },
        { id: 's2', name: 'create_task', arguments: { title: '任务B', durationMin: 5 } }
      ]
    },
    { finalText: '两条都建好了。' }
  ]);
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext(stub.service) });
    const firstApproval = await collector.waitFor((event) => event.type === 'approval.requested');
    expect(await controller.approve('run-1', 'approved')).toBe(true);
    // 第二个审批槽：必须等到新事件（seq 更大），waitFor 对旧事件不会再命中。
    await collector.waitFor(
      (event) => event.type === 'approval.requested' && event.seq > firstApproval.seq
    );
    expect(await controller.approve('run-1', 'approved')).toBe(true);
    expect(await handle.done).toBe('completed');
    // 全程最大并发 = 1：PiEngine 不引入并行工具调用（toolExecution='sequential'）。
    expect(stub.maxActive()).toBe(1);
    expect(stub.created.map((task) => task['title'])).toEqual(['任务A', '任务B']);
  } finally {
    await dispose();
  }
});

test('取消（流中）：holdUntilAbort 的一轮在 cancel 后以 aborted 收束 → cancelled，无提交', async () => {
  const stub = stubWorkspace();
  const gateway = new ToolGateway();
  registerButlerTools(gateway);
  const engine = makeEngine(gateway, [
    { deltas: ['我来帮你看今天的安排。'], holdUntilAbort: true },
    { toolCalls: [{ id: 'never', name: 'create_task', arguments: { title: '不该建', durationMin: 5 } }] }
  ]);
  const { controller, journal, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext(stub.service) });
    await collector.waitFor((event) => event.type === 'text.delta');
    expect(await controller.cancel('run-1')).toBe(true);
    expect(await handle.done).toBe('cancelled');
    expect(controller.getRun('run-1')?.state).toBe('cancelled');
    // 取消后不再执行工具：第二轮的工具调用从未发生，没有审批、没有提交。
    expect(stub.created).toHaveLength(0);
    expect(collector.events.some((event) => event.type === 'approval.requested')).toBe(false);
    expect(collector.events.some((event) => event.type === 'tool.committed')).toBe(false);
    expect(collector.events.some((event) => event.type === 'service.receipt')).toBe(false);
    expect(collector.events.at(-1)).toMatchObject({ type: 'run.finished', state: 'cancelled' });
    const journaled = await journal.readRun('run-1');
    expect(journaled.at(-1)).toMatchObject({ type: 'run.finished', state: 'cancelled' });
  } finally {
    await dispose();
  }
});

test('取消（工具后）：第一轮提交并回执后 cancel → cancelled，第二轮脚本不再产生内容', async () => {
  const stub = stubWorkspace();
  const gateway = new ToolGateway();
  registerButlerTools(gateway);
  const engine = makeEngine(gateway, [
    { toolCalls: [{ id: 'a1', name: 'create_task', arguments: { title: '任务A', durationMin: 5 } }] },
    { holdUntilAbort: true, toolCalls: [{ id: 'b1', name: 'create_task', arguments: { title: '任务B', durationMin: 5 } }] }
  ]);
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext(stub.service) });
    await collector.waitFor((event) => event.type === 'approval.requested');
    expect(await controller.approve('run-1', 'approved')).toBe(true);
    await collector.waitFor(
      (event) => event.type === 'tool.committed' && (event as { tool: string }).tool === 'create_task'
    );
    expect(await controller.cancel('run-1')).toBe(true);
    expect(await handle.done).toBe('cancelled');
    // 任务B 从未创建：取消后不再执行工具（脚本被 aborted 短路，不经网关）。
    expect(stub.created.map((task) => task['title'])).toEqual(['任务A']);
    expect(collector.events.at(-1)).toMatchObject({ type: 'run.finished', state: 'cancelled' });
  } finally {
    await dispose();
  }
});

test('失败不说成功：确认级工具报错 → 运行「失败」，无回执、无成功文案、落盘不变', async () => {
  const stub = stubWorkspace();
  const gateway = new ToolGateway();
  registerButlerTools(gateway);
  const engine = makeEngine(
    gateway,
    [
      { deltas: ['我来生成计划。'], toolCalls: [{ id: 'p1', name: 'plan_workspace', arguments: { date: '2026-11-27' } }] },
      { finalText: '计划生成失败了，请稍后再试。' }
    ],
    { }
  );
  const { controller, journal, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), {
      butler: butlerContext(stub.service, { planner: failingPlanner })
    });
    await collector.waitFor((event) => event.type === 'approval.requested');
    expect(await controller.approve('run-1', 'approved')).toBe(true);
    expect(await handle.done).toBe('failed');
    expect(controller.getRun('run-1')).toMatchObject({ state: 'failed' });
    const failed = collector.events.find((event) => event.type === 'tool.failed');
    expect(failed).toMatchObject({ tool: 'plan_workspace', reason: 'failed' });
    expect((failed as { error?: string }).error).toContain('planner 炸了');
    expect(collector.events.some((event) => event.type === 'tool.committed')).toBe(false);
    expect(collector.events.some((event) => event.type === 'service.receipt')).toBe(false);
    for (const event of collector.events) {
      if (event.type === 'text.delta') {
        expect((event as { text: string }).text).not.toMatch(/已安排|安排好了|已生成/);
      }
    }
    expect(collector.events.at(-1)).toMatchObject({
      type: 'run.finished',
      state: 'failed',
      error: expect.stringContaining('plan_workspace 调用失败')
    });
    expect(stub.created).toHaveLength(0);
    const journaled = await journal.readRun('run-1');
    expect(journaled.at(-1)).toMatchObject({ type: 'run.finished', state: 'failed' });
  } finally {
    await dispose();
  }
});

test('模型 error（stopReason=error）→ 运行「失败」，不把文本当成功', async () => {
  const stub = stubWorkspace();
  const gateway = new ToolGateway();
  registerButlerTools(gateway);
  const engine = makeEngine(gateway, [{ deltas: ['正在连接模型。'], error: '模型断开' }]);
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext(stub.service) });
    expect(await handle.done).toBe('failed');
    expect((collector.events.at(-1) as { error?: string }).error).toContain('模型断开');
    expect(collector.events.some((event) => event.type === 'service.receipt')).toBe(false);
    expect(collector.events.some((event) => event.type === 'tool.committed')).toBe(false);
  } finally {
    await dispose();
  }
});

test('未注册工具：pi 侧拦截 → tool.failed（reason=unknown-tool），模型收到错误回执，运行继续', async () => {
  const stub = stubWorkspace();
  const gateway = new ToolGateway();
  registerButlerTools(gateway);
  const engine = makeEngine(gateway, [
    { toolCalls: [{ id: 'u1', name: 'not_a_tool', arguments: { x: 1 } }] },
    { finalText: '好的，我换个方式。' }
  ]);
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext(stub.service) });
    expect(await handle.done).toBe('completed');
    const failed = collector.events.find((event) => event.type === 'tool.failed');
    expect(failed).toMatchObject({ tool: 'not_a_tool', reason: 'unknown-tool' });
    expect((failed as { error?: string }).error).toContain('not_a_tool');
    expect(stub.created).toHaveLength(0);
  } finally {
    await dispose();
  }
});

test('参数校验失败（additionalProperties）→ tool.failed（reason=failed），网关从未收到调用', async () => {
  const stub = stubWorkspace();
  const gateway = new ToolGateway();
  registerButlerTools(gateway);
  const engine = makeEngine(gateway, [
    {
      toolCalls: [
        { id: 'v1', name: 'create_task', arguments: { title: '任务X', durationMin: 5, extra: 1 } }
      ]
    },
    { finalText: '参数有问题，已停止。' }
  ]);
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext(stub.service) });
    expect(await handle.done).toBe('completed');
    const failed = collector.events.find((event) => event.type === 'tool.failed');
    expect(failed).toMatchObject({ tool: 'create_task', reason: 'failed' });
    expect((failed as { error?: string }).error).toContain('Validation failed');
    expect(stub.created).toHaveLength(0);
    expect(collector.events.some((event) => event.type === 'tool.committed')).toBe(false);
  } finally {
    await dispose();
  }
});

test('审批拒绝：rejected → tool.failed（reason=rejected）→ 运行失败（失败不说成功）', async () => {
  const stub = stubWorkspace();
  const gateway = new ToolGateway();
  registerButlerTools(gateway);
  const engine = makeEngine(gateway, [
    { toolCalls: [{ id: 'r1', name: 'create_task', arguments: { title: '任务R', durationMin: 5 } }] },
    { finalText: '好的，那我不建了。' }
  ]);
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext(stub.service) });
    await collector.waitFor((event) => event.type === 'approval.requested');
    expect(await controller.approve('run-1', 'rejected')).toBe(true);
    expect(await handle.done).toBe('failed');
    const failed = collector.events.find((event) => event.type === 'tool.failed');
    expect(failed).toMatchObject({ tool: 'create_task', reason: 'rejected' });
    expect(stub.created).toHaveLength(0);
    expect(collector.events.some((event) => event.type === 'service.receipt')).toBe(false);
  } finally {
    await dispose();
  }
});

test('缝①负例：确认级成功但关闭回执映射（writeTools 空）→ 终态 pending-verification', async () => {
  const stub = stubWorkspace();
  const gateway = new ToolGateway();
  registerButlerTools(gateway);
  const engine = makeEngine(
    gateway,
    [
      { toolCalls: [{ id: 'n1', name: 'create_task', arguments: { title: '任务N', durationMin: 5 } }] },
      { finalText: '建好了。' }
    ],
    { writeTools: new Set() }
  );
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext(stub.service) });
    await collector.waitFor((event) => event.type === 'approval.requested');
    expect(await controller.approve('run-1', 'approved')).toBe(true);
    expect(await handle.done).toBe('pending-verification');
    expect(collector.events.some((event) => event.type === 'service.receipt')).toBe(false);
    expect(collector.events.some((event) => event.type === 'tool.committed')).toBe(true);
    expect(stub.created).toHaveLength(1);
  } finally {
    await dispose();
  }
});

test('缝③：一次成段返回（done 消息独带全文、零 text_delta）→ 补发一条 text.delta，正文不丢', async () => {
  const stub = stubWorkspace();
  const gateway = new ToolGateway();
  registerButlerTools(gateway);
  // doneOnlyText：脚本化「不发任何增量的提供方」——全文只进 done 消息。
  const engine = makeEngine(gateway, [{ doneOnlyText: '一次成段的完整回复。' }]);
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext(stub.service) });
    expect(await handle.done).toBe('completed');
    expect(collector.events.map((event) => event.type)).toEqual([
      'run.started',
      'text.delta', // 缝③补发的一条全文
      'run.finished'
    ]);
    expect(collector.events[1]).toMatchObject({ type: 'text.delta', text: '一次成段的完整回复。' });
    expect(collector.events[1]?.seq).toBe(2);
  } finally {
    await dispose();
  }
});

test('缝③：已发过 delta → 终局消息的正文不补发不重复', async () => {
  const stub = stubWorkspace();
  const gateway = new ToolGateway();
  registerButlerTools(gateway);
  // 一轮两个增量（delta 已发）；终局 done 消息自带合并正文，但全程已发过
  // delta → 不再补发。
  const engine = makeEngine(gateway, [{ deltas: ['流式增量。'], finalText: '流式增量。（收尾）' }]);
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext(stub.service) });
    expect(await handle.done).toBe('completed');
    expect(collector.events.map((event) => event.type)).toEqual([
      'run.started',
      'text.delta',
      'text.delta', // 一轮两个增量，均走流式映射
      'run.finished'
    ]);
    const deltas = collector.events
      .filter((event) => event.type === 'text.delta')
      .map((event) => (event as { text: string }).text);
    expect(deltas).toEqual(['流式增量。', '流式增量。（收尾）']); // 恰为两轮增量，无补发
  } finally {
    await dispose();
  }
});
