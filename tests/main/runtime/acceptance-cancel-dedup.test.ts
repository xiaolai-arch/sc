import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelClient } from '../../../src/main/agent/model-client';
import type {
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  StreamingModelClient
} from '../../../src/main/agent/model-client';
import { createWorkspacePlanner } from '../../../src/main/planning/workspace-planner';
import { createWorkspaceService } from '../../../src/main/workspace/create-workspace-service';
import { assembleRuntime } from '../../../src/main/runtime/assembly';
import type { RunEvent, RunRequest, TerminalRunState } from '../../../src/main/runtime/contracts';
import { FakeEngine } from '../../../src/main/runtime/fake-engine';
import { LegacyEngine } from '../../../src/main/runtime/legacy-engine';
import { PiEngine, scriptedPiModel } from '../../../src/main/runtime/engine-pi';
import { registerButlerTools } from '../../../src/main/runtime/butler-bridge';
import type { EngineAssembly } from '../../../src/main/runtime/engine-selection';
import { RunJournal } from '../../../src/main/runtime/run-journal';
import { ToolGateway } from '../../../src/main/runtime/tool-gateway';
import type { RunController } from '../../../src/main/runtime/run-controller';
import { ButlerServiceImpl } from '../../../src/main/butler/butler-service';
import type { ButlerToolContext } from '../../../src/main/butler/tools';
import type { WorkspacePlanner } from '../../../src/shared/planning';
import type { WorkspaceService } from '../../../src/shared/workspace';

/**
 * 跨批验收 · 取消与重复写（spec 验收 3/5），任务书第 3 条：
 * 「取消后不再执行任何工具；提交后同参重复调用被拒，失败后同参重试放行。」
 *
 * - 验收 3（取消）：Pi 走「提交确认弹窗时取消」（等待审批中 cancel），
 *   Legacy 走「工具执行中取消」（真实 vault + createTask 闸门）——两条都是
 *   用户真实会遇到的中断点，断言终态 cancelled、取消后无任何后续工具与写入。
 * - 验收 5（去重）：走**真实 commit_plan**（Fake 引擎驱动，经 assembleRuntime
 *   真装配）：已提交的同参调用第二次被网关以 duplicate 拒、不产生第二次审批、
 *   不双写；失败的同参重试放行、需要**新的一次审批**（审批绑定这一次调用，
 *   无批准缓存）、最终恰好落盘一条。
 *
 * 已知边界（sc-lead 2026-11-28 裁定：接受为 Legacy 边界，不改码；写进用户文档
 * 与对照期说明归 sc-build）：Legacy 不走网关（legacy-engine.ts:20-26 自证
 * 「产品取舍点」），确认级工具直执行。因此**本文件的审批与去重语义只对
 * Fake/Pi 路径成立**——Legacy 下确认级工具无审批、无去重、`maxToolCalls`
 * 不生效、只取第一个项目。Legacy 是对照与回滚引擎，统一治理由 Pi 在网关上
 * 兑现；长期跑 Legacy 不接受，切引擎那次设复审门。别让后来的人以为 Legacy
 * 也受这些约束。
 */

const NOW = new Date(2026, 10, 28, 8, 0, 0); // 2026-11-28（周六）08:00 local —— 假时钟
const now = (): Date => new Date(NOW);
const TODAY = '2026-11-28';
const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };

const COMMIT_ARGS = (workspaceId: string): Record<string, unknown> => ({
  workspaceId,
  date: TODAY,
  tasks: [{ title: '读一篇外刊', subject: '英语', durationMin: 10, acceptance: '读完' }]
});

interface Fixture {
  root: string;
  service: WorkspaceService;
  workspaceId: string;
  dispose(): Promise<void>;
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'asaki-runtime-accept-cancel-'));
  const service = createWorkspaceService(root, { seed: false });
  const created = await service.createWorkspace({
    name: '英语',
    kind: 'study',
    goal: '流利读外刊',
    description: ''
  });
  return {
    root,
    service,
    workspaceId: created.id,
    async dispose(): Promise<void> {
      await rm(root, { recursive: true, force: true });
    }
  };
}

function butlerContext(
  fixture: Fixture,
  planner: WorkspacePlanner,
  workspace: WorkspaceService = fixture.service
): ButlerToolContext {
  return {
    workspace,
    workspaceId: fixture.workspaceId,
    planner,
    now
  };
}

function makeRequest(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    runId: 'run-1',
    sessionId: 'conv-1',
    origin: 'chat',
    workspaceIds: ['ws'],
    userInput: '帮我安排今天的计划',
    engineId: 'fake',
    now,
    ...overrides
  };
}

async function makeHarness(assembly: EngineAssembly): Promise<{
  controller: RunController;
  journal: RunJournal;
  dispose(): Promise<void>;
}> {
  const journalDir = await mkdtemp(join(tmpdir(), 'asaki-runtime-accept-cancel-journal-'));
  const journal = new RunJournal({ dirPath: journalDir, now });
  const { controller } = assembleRuntime({ journal, engines: assembly });
  return {
    controller,
    journal,
    async dispose(): Promise<void> {
      await rm(journalDir, { recursive: true, force: true });
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

const APPROVALS = (events: RunEvent[]): RunEvent[] =>
  events.filter((event) => event.type === 'approval.requested');
const COMMIT_TOOL = (events: RunEvent[], tool: string): RunEvent[] =>
  events.filter(
    (event) => event.type === 'tool.committed' && (event as { tool: string }).tool === tool
  );

/** Scripted streaming client（与 legacy-engine.test.ts 同形）：Legacy 的模型模拟层。 */
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

test('验收 3（Pi）：等待提交确认时取消 → cancelled，不再执行任何工具，vault 零写入', async () => {
  const fixture = await makeFixture();
  try {
    const realPlanner = createWorkspacePlanner({ workspaceService: fixture.service, now });
    const plannerInputs: Parameters<WorkspacePlanner['plan']>[0][] = [];
    const planner: WorkspacePlanner = {
      plan: async (input) => {
        plannerInputs.push(input);
        return realPlanner.plan(input);
      }
    };
    const engineGateway = new ToolGateway();
    registerButlerTools(engineGateway);
    const engine = new PiEngine({
      streamFn: scriptedPiModel([
        { deltas: ['我来为今天生成计划。'], toolCalls: [{ id: 'p1', name: 'plan_preview', arguments: {} }] },
        async () => {
          const input = plannerInputs[0];
          if (!input) throw new Error('脚本错误：plan_preview 还没有发生。');
          const plan = await planner.plan(input);
          return {
            toolCalls: [
              {
                id: 'c1',
                name: 'commit_plan',
                arguments: { workspaceId: input.workspaceId, date: plan.date, tasks: plan.tasks }
              }
            ]
          };
        },
        { finalText: '已生成今天的计划。' }
      ]),
      tools: engineGateway,
      systemPrompt: '你是学习管家。'
    });
    const { controller, journal, dispose } = await makeHarness({ pi: engine });
    try {
      const collector = collect(controller, 'run-cancel-pi');
      const handle = controller.start(
        makeRequest({
          runId: 'run-cancel-pi',
          workspaceIds: [fixture.workspaceId],
          engineId: 'pi'
        }),
        { butler: butlerContext(fixture, planner) }
      );
      // 走到提交确认（commit_plan 的 approval.requested），用户此时点取消。
      await collector.waitFor((event) => event.type === 'approval.requested');
      expect(await controller.cancel('run-cancel-pi')).toBe(true);
      expect(await handle.done).toBe('cancelled');
      expect(controller.getRun('run-cancel-pi')?.state).toBe('cancelled');
      // 取消后不再执行任何工具：pending 审批已被收掉，之后的 approve 无效。
      expect(await controller.approve('run-cancel-pi', 'approved')).toBe(false);
      // 没有任何写入：零任务落盘、无 commit_plan 提交、无服务回执。
      const snapshot = await fixture.service.getWorkspaceSnapshot(fixture.workspaceId);
      expect(snapshot.tasks).toHaveLength(0);
      expect(COMMIT_TOOL(collector.events, 'commit_plan')).toHaveLength(0);
      expect(collector.events.some((event) => event.type === 'service.receipt')).toBe(false);
      // plan_preview（查询级）照常提交过——取消只斩断其后的写入。
      expect(COMMIT_TOOL(collector.events, 'plan_preview')).toHaveLength(1);
      expect(collector.events.at(-1)).toMatchObject({ type: 'run.finished', state: 'cancelled' });
      const journaled = await journal.readRun('run-cancel-pi');
      expect(journaled.at(-1)).toMatchObject({ type: 'run.finished', state: 'cancelled' });
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

test('验收 3（Legacy）：工具执行中取消 → cancelled，后续模型轮与后续工具不再发生', async () => {
  const fixture = await makeFixture();
  try {
    let releaseTask!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });
    const base = fixture.service;
    let createCalls = 0;
    // 真实 vault + createTask 闸门：第一个工具停在执行中，取消在此时落地。
    const gated: WorkspaceService = {
      ...base,
      createTask: async (input) => {
        createCalls += 1;
        await gate;
        return base.createTask(input);
      }
    };
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
    const planner = createWorkspacePlanner({ workspaceService: fixture.service, now });
    const butler = new ButlerServiceImpl({
      workspaceService: gated,
      modelClient: scripted,
      planner,
      now,
      maxToolSteps: 4
    });
    const { controller, journal, dispose } = await makeHarness({
      legacy: new LegacyEngine({ butler })
    });
    try {
      const collector = collect(controller, 'run-cancel-legacy');
      const handle = controller.start(
        makeRequest({
          runId: 'run-cancel-legacy',
          workspaceIds: [fixture.workspaceId],
          engineId: 'legacy'
        }),
        { butler: butlerContext(fixture, planner, gated) }
      );
      // 等任务A停在闸门上（工具已在执行中），然后取消。
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(createCalls).toBe(1);
      expect(await controller.cancel('run-cancel-legacy')).toBe(true);
      releaseTask();
      expect(await handle.done).toBe('cancelled');
      // 取消即刻定终态；在途写入（任务A）在取消后自行收尾落盘——等它落完再读盘。
      for (let settle = 0; settle < 50; settle += 1) {
        const probe = await fixture.service.getWorkspaceSnapshot(fixture.workspaceId);
        if (probe.tasks.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      // ── 待补占位（sc-lead 2026-11-28 裁决 + 补充；等 sc-build 状态机合入后由 sc-qa 改断言）──
      // 现状（下面按现状断言）：取消时已在途的 createTask 在取消之后完成落盘
      // （vault 多出「任务A」），而终态/journal 都是 cancelled、事件层零提交——
      // 状态说谎：取消 ≠ 什么都没发生。
      // 依据（sc-build 提示）：contracts.ts:27 已有 pending-verification 态，
      // run-controller.ts:195 现在只有「确认级写入无回执」一条路落进去——修复是
      // 在取消分支加**同款判定**，不是新造状态。届时断言的不是「状态名出现了」，
      // 而是同一条「写入无回执」判定在取消路径上也被触发（更能防退化）。
      // 三种时序各一条（证明判定按「有没有在途」分流）：
      //   1) 取消时无在途工具 → 仍 `cancelled`；
      //   2) 取消时在途未提交（本用例的时序）→ `pending-verification` + 事件含
      //      「有一笔写入可能在取消后落盘」的待核实提示 + vault 可能多一条；
      //   3) 工具已提交之后才取消 → 仍 `cancelled`（取消晚了一步，已无在途）。
      // Pi 路径严格零写入，不受影响（上面 Pi 用例已经是零写入断言）。
      expect(controller.getRun('run-cancel-legacy')?.state).toBe('cancelled');
      // 取消后不再执行任何工具：第二轮模型调用从未发生，任务B从未创建。
      expect(scripted.calls).toHaveLength(1);
      expect(createCalls).toBe(1);
      const snapshot = await fixture.service.getWorkspaceSnapshot(fixture.workspaceId);
      expect(snapshot.tasks.map((task) => task.title)).toEqual(['任务A']);
      // 被取消的在途调用不产生提交，更没有回执；终态与 journal 一致。
      expect(collector.events.some((event) => event.type === 'tool.committed')).toBe(false);
      expect(collector.events.some((event) => event.type === 'service.receipt')).toBe(false);
      expect(collector.events.at(-1)).toMatchObject({ type: 'run.finished', state: 'cancelled' });
      const journaled = await journal.readRun('run-cancel-legacy');
      expect(journaled.at(-1)).toMatchObject({ type: 'run.finished', state: 'cancelled' });
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

test('验收 5a（经真装配）：提交后同参重复 → 网关 duplicate 拒，不产生第二次审批，不双写', async () => {
  const fixture = await makeFixture();
  try {
    const planner = createWorkspacePlanner({ workspaceService: fixture.service, now });
    const args = COMMIT_ARGS(fixture.workspaceId);
    const engine = new FakeEngine({
      steps: [
        { type: 'tool', name: 'commit_plan', args },
        { type: 'tool', name: 'commit_plan', args },
        { type: 'receipt', detail: 'commit_plan 成功' }
      ]
    });
    const { controller, dispose } = await makeHarness({ fake: engine });
    try {
      const collector = collect(controller, 'run-dup');
      const handle = controller.start(
        makeRequest({ runId: 'run-dup', workspaceIds: [fixture.workspaceId] }),
        { butler: butlerContext(fixture, planner) }
      );
      await collector.waitFor((event) => event.type === 'approval.requested');
      expect(await controller.approve('run-dup', 'approved')).toBe(true);
      expect(await handle.done).toBe('completed');

      // 第一次提交成功；第二次同参在网关被拒，reason=duplicate。
      expect(engine.invocations).toHaveLength(2);
      expect(engine.invocations[0]?.outcome.ok).toBe(true);
      expect(engine.invocations[1]?.outcome.ok).toBe(false);
      expect(engine.invocations[1]?.outcome.reason).toBe('duplicate');
      // 只有一次审批（重复调用在审批之前就被去重拦下）、一次提交、一条落盘。
      expect(APPROVALS(collector.events)).toHaveLength(1);
      expect(COMMIT_TOOL(collector.events, 'commit_plan')).toHaveLength(1);
      const snapshot = await fixture.service.getWorkspaceSnapshot(fixture.workspaceId);
      expect(snapshot.tasks).toHaveLength(1);
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

test('验收 5b（经真装配）：失败后同参重试放行，但需要新的一次审批（审批绑定这一次调用）', async () => {
  const fixture = await makeFixture();
  try {
    const planner = createWorkspacePlanner({ workspaceService: fixture.service, now });
    // 真实 commit_plan + 第一次 createTask 注入失败：同参第二次执行成功。
    const base = fixture.service;
    let createCalls = 0;
    const flaky: WorkspaceService = {
      ...base,
      createTask: async (input) => {
        createCalls += 1;
        if (createCalls === 1) {
          throw new Error('注入的首次写入失败（验收 5b）');
        }
        return base.createTask(input);
      }
    };
    const args = COMMIT_ARGS(fixture.workspaceId);
    const engine = new FakeEngine({
      steps: [
        { type: 'tool', name: 'commit_plan', args },
        { type: 'tool', name: 'commit_plan', args },
        { type: 'receipt', detail: 'commit_plan 成功' }
      ]
    });
    const { controller, dispose } = await makeHarness({ fake: engine });
    try {
      const collector = collect(controller, 'run-retry');
      const handle = controller.start(
        makeRequest({ runId: 'run-retry', workspaceIds: [fixture.workspaceId] }),
        { butler: butlerContext(fixture, planner, flaky) }
      );
      // 第一次审批 → 执行失败（注入）；重试要来**新的一次审批**才放行。
      const firstApproval = (await collector.waitFor(
        (event) => event.type === 'approval.requested'
      )) as { invocationId: string };
      expect(await controller.approve('run-retry', 'approved')).toBe(true);
      const secondApproval = (await collector.waitFor(
        (event) =>
          event.type === 'approval.requested' &&
          (event as { invocationId: string }).invocationId !== firstApproval.invocationId
      )) as { params: Record<string, unknown> };
      expect(await controller.approve('run-retry', 'approved')).toBe(true);
      expect(await handle.done).toBe('completed');

      // 失败回执与成功提交都在场：失败没进去重键，同参重试放行。
      expect(engine.invocations).toHaveLength(2);
      expect(engine.invocations[0]?.outcome.ok).toBe(false);
      expect(engine.invocations[0]?.outcome.reason).toBe('failed');
      expect(engine.invocations[1]?.outcome.ok).toBe(true);
      // 新审批的参数与第一次完全一致（同参重试），但它是独立的一次审批。
      expect(secondApproval.params).toEqual(
        (APPROVALS(collector.events)[0] as { params: Record<string, unknown> }).params
      );
      expect(APPROVALS(collector.events)).toHaveLength(2);
      expect(COMMIT_TOOL(collector.events, 'commit_plan')).toHaveLength(1);
      const snapshot = await fixture.service.getWorkspaceSnapshot(fixture.workspaceId);
      expect(snapshot.tasks).toHaveLength(1);
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});
