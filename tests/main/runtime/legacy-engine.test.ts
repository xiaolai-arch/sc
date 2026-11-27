import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ButlerServiceImpl } from '../../../src/main/butler/butler-service';
import type { ButlerToolContext } from '../../../src/main/butler/tools';
import { FakeModelClient } from '../../../src/main/agent/model-client';
import type {
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  StreamingModelClient
} from '../../../src/main/agent/model-client';
import { LegacyEngine } from '../../../src/main/runtime/legacy-engine';
import { registerButlerTools } from '../../../src/main/runtime/butler-bridge';
import { RunController } from '../../../src/main/runtime/run-controller';
import { RunJournal } from '../../../src/main/runtime/run-journal';
import { ToolGateway } from '../../../src/main/runtime/tool-gateway';
import type { RunEvent, RunRequest } from '../../../src/main/runtime/contracts';
import type { ButlerStreamEvent } from '../../../src/shared/butler-stream';
import type { WorkspacePlanner } from '../../../src/shared/planning';
import type {
  Workspace,
  WorkspaceService,
  WorkspaceSnapshot
} from '../../../src/shared/workspace';

const NOW = new Date(2026, 10, 27, 8, 0, 0); // 2026-11-27 08:00 local
const now = (): Date => new Date(NOW);
const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };

/**
 * Scripted streaming client（与 butler-service-stream.test 同形）：每轮回放
 * ModelStreamEvent 并返回固定 ModelResponse——Legacy 路径的「模型模拟层固定
 * 输出」（验收 10 的 determinism 基础）。
 */
class ScriptedStreamingClient implements StreamingModelClient {
  readonly calls: ModelRequest[] = [];

  constructor(
    private readonly script: Array<{ events: ModelStreamEvent[]; response: ModelResponse }>
  ) {}

  async complete(): Promise<ModelResponse> {
    throw new Error('complete should not be called');
  }

  async stream(
    request: ModelRequest,
    onEvent: (event: ModelStreamEvent) => void
  ): Promise<ModelResponse> {
    this.calls.push(request);
    const next = this.script.shift();
    if (!next) throw new Error('no scripted round');
    for (const event of next.events) onEvent(event);
    return next.response;
  }
}

class ThrowingStreamingClient implements StreamingModelClient {
  readonly calls: ModelRequest[] = [];

  async complete(): Promise<ModelResponse> {
    throw new Error('complete should not be called');
  }

  async stream(request: ModelRequest): Promise<ModelResponse> {
    this.calls.push(request);
    throw new Error('model exploded');
  }
}

const workspace: Workspace = {
  id: 'ws-exam',
  name: '英语',
  kind: 'study',
  color: '#22c55e',
  goal: '流利读外刊',
  description: ''
};

const snapshot: WorkspaceSnapshot = {
  workspace,
  tasks: [],
  notes: [],
  memory: [],
  reminders: []
};

interface StubWorkspaceOptions {
  /** Parks every createTask until released（取消竞态注入点）。 */
  gate?: Promise<void>;
  /** Minimum per-createTask duration（串行约束的可观测化）。 */
  delayMs?: number;
}

/**
 * Minimal WorkspaceService stub: createTask 记录入参并暴露并发度计数，
 * 供缝②（全程串行工具调用）断言。
 */
function stubWorkspace(options: StubWorkspaceOptions = {}): {
  service: WorkspaceService;
  created: Array<Record<string, unknown>>;
  maxActive(): number;
} {
  const created: Array<Record<string, unknown>> = [];
  let active = 0;
  let maxActive = 0;
  const service = {
    listWorkspaces: async () => [workspace],
    getWorkspaceSnapshot: async () => snapshot,
    getMemory: async () => [],
    createTask: async (input: {
      workspaceId: string;
      title: string;
      subject: string;
      durationMin: number;
      acceptance: string;
      due?: string;
    }) => {
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
    tasks: [
      { title: '读一篇外刊', subject: '英语', durationMin: 20, acceptance: '读完并摘 5 句' }
    ],
    availableMinutes: 120,
    availableMinutesSource: 'default'
  })
};

const failingPlanner: WorkspacePlanner = {
  plan: async () => {
    throw new Error('planner 炸了');
  }
};

function butlerContext(overrides: Partial<ButlerToolContext> = {}): ButlerToolContext {
  return { workspace: {} as ButlerToolContext['workspace'], now, ...overrides };
}

function makeRequest(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    runId: 'run-1',
    sessionId: 'conv-1',
    origin: 'chat',
    workspaceIds: ['ws-exam'],
    userInput: '帮我安排今天的计划',
    engineId: 'legacy',
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

async function makeHarness(engines: LegacyEngine[]): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-runtime-legacy-'));
  const journal = new RunJournal({ dirPath: join(dir, 'runtime-runs'), now });
  const gateway = new ToolGateway();
  // 装配契约：Legacy 路径的工具不经网关执行，但控制器的 confirm 判定读网关
  // 注册表（缝①完成规则），所以管家工具标级必须注册进同一张表。
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

/** Collects every event of a run from the moment of subscription. */
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

test('事件映射：text→text.delta、tool-result(ok)→committed+回执、reasoning/tool-start/done 不映射，终态 completed', async () => {
  const scripted = new ScriptedStreamingClient([
    {
      events: [
        { type: 'reasoning', text: '想想今天怎么排' },
        { type: 'text', text: '我先看看项目。' }
      ],
      response: {
        text: '',
        usage: ZERO_USAGE,
        toolCalls: [{ id: 'call-1', name: 'plan_workspace', arguments: { date: '2026-11-27' } }]
      }
    },
    {
      events: [{ type: 'text', text: '今天的计划已生成。' }],
      response: { text: '今天的计划已生成。', usage: ZERO_USAGE }
    }
  ]);
  const stub = stubWorkspace();
  const butler = new ButlerServiceImpl({
    workspaceService: stub.service,
    modelClient: scripted,
    planner,
    now,
    maxToolSteps: 4
  });
  const engine = new LegacyEngine({ butler });
  const { controller, journal, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext() });
    expect(await handle.done).toBe('completed');

    // 缝②：Legacy 全程串行——映射表主链路的完整事件序列。
    expect(collector.events.map((event) => event.type)).toEqual([
      'run.started',
      'text.delta', // text → text.delta（reasoning 被丢弃）
      'tool.committed', // tool-result(ok)（tool-start 被丢弃）
      'service.receipt', // 缝①：确认级 plan_workspace 服务成功 → 回执
      'text.delta', // 第二轮的最终回答
      'run.finished' // done 不映射；由控制器合成
    ]);
    const textDeltas = collector.events.filter((event) => event.type === 'text.delta');
    expect(textDeltas.map((event) => (event as { text: string }).text)).toEqual([
      '我先看看项目。',
      '今天的计划已生成。'
    ]);
    const committed = collector.events.find((event) => event.type === 'tool.committed');
    expect(committed).toMatchObject({ tool: 'plan_workspace', invocationId: 'call-1' });
    const receipt = collector.events.find((event) => event.type === 'service.receipt');
    expect(receipt).toMatchObject({ detail: '生成计划 成功' });
    // Legacy 无审批概念：全程没有 approval.requested。
    expect(collector.events.some((event) => event.type === 'approval.requested')).toBe(false);
    // 缝①：提交之后有回执 → 终态 completed（不是 pending-verification）。
    expect(collector.events.at(-1)).toMatchObject({ type: 'run.finished', state: 'completed' });
    expect(controller.getRun('run-1')?.state).toBe('completed');
    // run.finished 与落盘一致：计划任务已写入。
    expect(stub.created).toHaveLength(1);
    expect(stub.created[0]).toMatchObject({ title: '读一篇外刊', due: '2026-11-27' });
    const journaled = await journal.readRun('run-1');
    expect(journaled.map((event) => event.type)).toEqual(collector.events.map((e) => e.type));
  } finally {
    await dispose();
  }
});

test('查询级工具成功只发 tool.committed，不发服务回执', async () => {
  const scripted = new ScriptedStreamingClient([
    {
      events: [],
      response: {
        text: '',
        usage: ZERO_USAGE,
        toolCalls: [{ id: 'q1', name: 'get_today_plan', arguments: {} }]
      }
    },
    { events: [{ type: 'text', text: '今天还没有安排。' }], response: { text: '今天还没有安排。', usage: ZERO_USAGE } }
  ]);
  const butler = new ButlerServiceImpl({
    workspaceService: stubWorkspace().service,
    modelClient: scripted,
    now,
    maxToolSteps: 4
  });
  const engine = new LegacyEngine({ butler });
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext() });
    expect(await handle.done).toBe('completed');
    expect(collector.events.map((event) => event.type)).toEqual([
      'run.started',
      'tool.committed',
      'text.delta',
      'run.finished'
    ]);
    expect(collector.events.some((event) => event.type === 'service.receipt')).toBe(false);
  } finally {
    await dispose();
  }
});

test('取消：工具执行中 cancel → cancelled，取消后不再执行工具（第二轮模型调用不发生）', async () => {
  let releaseTask!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseTask = resolve;
  });
  const scripted = new ScriptedStreamingClient([
    {
      events: [],
      response: {
        text: '',
        usage: ZERO_USAGE,
        toolCalls: [{ id: 'c1', name: 'create_task', arguments: { title: '任务A', durationMin: 5 } }]
      }
    },
    {
      events: [],
      response: {
        text: '',
        usage: ZERO_USAGE,
        toolCalls: [{ id: 'c2', name: 'create_task', arguments: { title: '任务B', durationMin: 5 } }]
      }
    },
    { events: [], response: { text: '两条都建好了。', usage: ZERO_USAGE } }
  ]);
  const stub = stubWorkspace({ gate });
  const butler = new ButlerServiceImpl({
    workspaceService: stub.service,
    modelClient: scripted,
    now,
    maxToolSteps: 4
  });
  const engine = new LegacyEngine({ butler });
  const { controller, journal, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext() });
    // 等到任务A停在 gate 上（tool-start 已发、createTask 已进入）。
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await controller.cancel('run-1')).toBe(true);
    releaseTask();
    expect(await handle.done).toBe('cancelled');
    expect(controller.getRun('run-1')?.state).toBe('cancelled');
    // 取消后不得再执行工具：第二轮模型调用从未发生，任务B从未创建。
    expect(scripted.calls).toHaveLength(1);
    expect(stub.created.map((task) => task['title'])).toEqual(['任务A']);
    // 无任何提交（落盘数据与终态一致）。
    expect(collector.events.some((event) => event.type === 'tool.committed')).toBe(false);
    expect(collector.events.some((event) => event.type === 'service.receipt')).toBe(false);
    expect(collector.events.at(-1)).toMatchObject({ type: 'run.finished', state: 'cancelled' });
    const journaled = await journal.readRun('run-1');
    expect(journaled.at(-1)).toMatchObject({ type: 'run.finished', state: 'cancelled' });
  } finally {
    await dispose();
  }
});

test('缝②串行约束：同一轮两个工具调用逐个执行（maxActive=1，顺序与入参一致）', async () => {
  const scripted = new FakeModelClient([
    {
      text: '',
      usage: ZERO_USAGE,
      toolCalls: [
        { id: 's1', name: 'create_task', arguments: { title: '任务A', durationMin: 5 } },
        { id: 's2', name: 'create_task', arguments: { title: '任务B', durationMin: 5 } }
      ]
    },
    { text: '两条都建好了。', usage: ZERO_USAGE }
  ]);
  const stub = stubWorkspace({ delayMs: 15 });
  const butler = new ButlerServiceImpl({
    workspaceService: stub.service,
    modelClient: scripted,
    now,
    maxToolSteps: 4
  });
  const engine = new LegacyEngine({ butler });
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext() });
    expect(await handle.done).toBe('completed');
    // 全程最大并发 = 1：LegacyEngine 不引入并行工具调用。
    expect(stub.maxActive()).toBe(1);
    expect(stub.created.map((task) => task['title'])).toEqual(['任务A', '任务B']);
    expect(collector.events.filter((event) => event.type === 'tool.committed')).toHaveLength(2);
  } finally {
    await dispose();
  }
});

test('失败不说成功：确认级工具报错 → 运行「失败」，无回执、无成功文案、落盘不变', async () => {
  const scripted = new ScriptedStreamingClient([
    {
      events: [],
      response: {
        text: '',
        usage: ZERO_USAGE,
        toolCalls: [{ id: 'f1', name: 'plan_workspace', arguments: { date: '2026-11-27' } }]
      }
    },
    {
      events: [{ type: 'text', text: '计划生成失败了，请稍后再试。' }],
      response: { text: '计划生成失败了，请稍后再试。', usage: ZERO_USAGE }
    }
  ]);
  const stub = stubWorkspace();
  const butler = new ButlerServiceImpl({
    workspaceService: stub.service,
    modelClient: scripted,
    planner: failingPlanner,
    now,
    maxToolSteps: 4
  });
  const engine = new LegacyEngine({ butler });
  const { controller, journal, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext() });
    expect(await handle.done).toBe('failed');
    expect(controller.getRun('run-1')).toMatchObject({ state: 'failed' });
    const failed = collector.events.find((event) => event.type === 'tool.failed');
    expect(failed).toMatchObject({ tool: 'plan_workspace', reason: 'failed' });
    expect((failed as { error?: string }).error).toContain('planner 炸了');
    expect(collector.events.some((event) => event.type === 'tool.committed')).toBe(false);
    expect(collector.events.some((event) => event.type === 'service.receipt')).toBe(false);
    // 事件层无成功文案。
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
    // 落盘一致：失败运行没有写任何任务。
    expect(stub.created).toHaveLength(0);
    const journaled = await journal.readRun('run-1');
    expect(journaled.at(-1)).toMatchObject({ type: 'run.finished', state: 'failed' });
  } finally {
    await dispose();
  }
});

test('模型 error 事件 → 运行「失败」，不把模板兜底文案当成功', async () => {
  const butler = new ButlerServiceImpl({
    workspaceService: stubWorkspace().service,
    modelClient: new ThrowingStreamingClient(),
    modelRetry: { attempts: 1, delayMs: 1 },
    now,
    maxToolSteps: 4
  });
  const engine = new LegacyEngine({ butler });
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext() });
    expect(await handle.done).toBe('failed');
    expect(controller.getRun('run-1')?.state).toBe('failed');
    expect(collector.events.at(-1)).toMatchObject({ type: 'run.finished', state: 'failed' });
    expect((collector.events.at(-1) as { error?: string }).error).toContain('模型调用失败');
    expect(collector.events.some((event) => event.type === 'service.receipt')).toBe(false);
    expect(collector.events.some((event) => event.type === 'tool.committed')).toBe(false);
  } finally {
    await dispose();
  }
});

test('权限门：Legacy 直执行的唯一闸门——write=false 时确认级工具被拒、运行失败', async () => {
  const scripted = new ScriptedStreamingClient([
    {
      events: [],
      response: {
        text: '',
        usage: ZERO_USAGE,
        toolCalls: [{ id: 'p1', name: 'create_task', arguments: { title: '任务X', durationMin: 5 } }]
      }
    },
    {
      events: [{ type: 'text', text: '当前权限不允许写入。' }],
      response: { text: '当前权限不允许写入。', usage: ZERO_USAGE }
    }
  ]);
  const stub = stubWorkspace();
  const butler = new ButlerServiceImpl({
    workspaceService: stub.service,
    modelClient: scripted,
    now,
    maxToolSteps: 4
  });
  const engine = new LegacyEngine({ butler });
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), {
      butler: butlerContext({ permissions: { web: true, write: false, shell: false } })
    });
    expect(await handle.done).toBe('failed');
    const failed = collector.events.find((event) => event.type === 'tool.failed');
    expect((failed as { error?: string }).error).toContain('仅可查看');
    expect(stub.created).toHaveLength(0);
    expect(collector.events.some((event) => event.type === 'service.receipt')).toBe(false);
  } finally {
    await dispose();
  }
});

test('Legacy 无审批概念：approve 在 Legacy 运行上没有可决策的 pending → false', async () => {
  let releaseTask!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseTask = resolve;
  });
  const scripted = new ScriptedStreamingClient([
    {
      events: [],
      response: {
        text: '',
        usage: ZERO_USAGE,
        toolCalls: [{ id: 'c1', name: 'create_task', arguments: { title: '任务A', durationMin: 5 } }]
      }
    },
    { events: [], response: { text: '建好了。', usage: ZERO_USAGE } }
  ]);
  const butler = new ButlerServiceImpl({
    workspaceService: stubWorkspace({ gate }).service,
    modelClient: scripted,
    now,
    maxToolSteps: 4
  });
  const engine = new LegacyEngine({ butler });
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const handle = controller.start(makeRequest(), { butler: butlerContext() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await controller.approve('run-1', 'approved')).toBe(false);
    expect(await controller.approve('run-1', 'rejected')).toBe(false);
    expect(await controller.cancel('run-1')).toBe(true);
    releaseTask();
    expect(await handle.done).toBe('cancelled');
  } finally {
    await dispose();
  }
});

test('确认级工具失败后被后续成功写入覆盖：运行按最后一次写入判定', async () => {
  const scripted = new ScriptedStreamingClient([
    {
      events: [],
      response: {
        text: '',
        usage: ZERO_USAGE,
        toolCalls: [
          { id: 'r1', name: 'plan_workspace', arguments: { date: '2026-11-27' } },
          { id: 'r2', name: 'create_task', arguments: { title: '补救任务', durationMin: 10 } }
        ]
      }
    },
    { events: [{ type: 'text', text: '已按新计划建好任务。' }], response: { text: '已按新计划建好任务。', usage: ZERO_USAGE } }
  ]);
  let planCalls = 0;
  const flakyPlanner: WorkspacePlanner = {
    plan: async (input) => {
      planCalls += 1;
      if (planCalls === 1) throw new Error('第一次失败');
      return planner.plan(input);
    }
  };
  const stub = stubWorkspace();
  const butler = new ButlerServiceImpl({
    workspaceService: stub.service,
    modelClient: scripted,
    planner: flakyPlanner,
    now,
    maxToolSteps: 4
  });
  const engine = new LegacyEngine({ butler });
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext() });
    expect(await handle.done).toBe('completed');
    const types = collector.events.map((event) => event.type);
    // 失败 → 后续成功提交 + 回执 → completed（最后一次写入驱动完成规则）。
    expect(types).toEqual([
      'run.started',
      'tool.failed',
      'tool.committed',
      'service.receipt',
      'text.delta',
      'run.finished'
    ]);
    expect(collector.events.at(-1)).toMatchObject({ type: 'run.finished', state: 'completed' });
    expect(stub.created.map((task) => task['title'])).toEqual(['补救任务']);
  } finally {
    await dispose();
  }
});

test('映射健壮性：ButlerStreamEvent 全类型经 run() 有分支、不抛错（丢弃类型不产生 RunEvent）', async () => {
  const allEvents: ButlerStreamEvent[] = [
    { type: 'references', items: [] },
    { type: 'reasoning', text: 'r' },
    { type: 'narration', text: 'n' },
    { type: 'text', text: 't' },
    { type: 'tool-start', id: 'x', name: 'create_task', label: '创建任务' },
    { type: 'tool-result', id: 'x', name: 'create_task', ok: true, label: '创建任务' },
    {
      type: 'tool-result',
      id: 'y',
      name: 'plan_workspace',
      ok: false,
      label: '生成计划',
      detail: '炸了'
    },
    { type: 'retry', attempt: 1, message: '重试' },
    { type: 'error', message: '模型断开' },
    { type: 'done', text: '结束' }
  ];
  const butler = {
    stream: async (
      _input: unknown,
      onEvent: (event: ButlerStreamEvent) => void
    ): Promise<{ text: string }> => {
      for (const event of allEvents) onEvent(event);
      return { text: '结束' };
    }
  } as unknown as ButlerService;
  const engine = new LegacyEngine({ butler });
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest(), { butler: butlerContext() });
    // error 事件在收尾时抛出 → 失败；全类型事件都走完映射分支。
    expect(await handle.done).toBe('failed');
    expect(collector.events.map((event) => event.type)).toEqual([
      'run.started',
      'text.delta', // narration
      'text.delta', // text
      'tool.committed', // tool-result(ok) create_task
      'service.receipt', // create_task 是确认级 → 回执
      'tool.failed', // tool-result(!ok) plan_workspace
      'run.finished'
    ]);
    expect((collector.events.at(-1) as { error?: string }).error).toContain('模型断开');
    // references / reasoning / tool-start / retry / done 没有产生任何事件。
  } finally {
    await dispose();
  }
});
