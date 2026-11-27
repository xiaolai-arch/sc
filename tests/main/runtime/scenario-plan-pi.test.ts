import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ButlerServiceImpl } from '../../../src/main/butler/butler-service';
import type { ButlerToolContext } from '../../../src/main/butler/tools';
import { FakeModelClient } from '../../../src/main/agent/model-client';
import { createAvailabilityService } from '../../../src/main/availability/service';
import { createWorkspaceService } from '../../../src/main/workspace/create-workspace-service';
import { createWorkspacePlanner } from '../../../src/main/planning/workspace-planner';
import { LegacyEngine } from '../../../src/main/runtime/legacy-engine';
import { PiEngine, scriptedPiModel } from '../../../src/main/runtime/engine-pi';
import {
  assembleEngines,
  hasEngine
} from '../../../src/main/runtime/engine-selection';
import { registerButlerTools } from '../../../src/main/runtime/butler-bridge';
import { RunController } from '../../../src/main/runtime/run-controller';
import { RunJournal } from '../../../src/main/runtime/run-journal';
import { ToolGateway } from '../../../src/main/runtime/tool-gateway';
import type { RunEvent, RunRequest } from '../../../src/main/runtime/contracts';
import { BUSY_DAY_MINUTES } from '../../../src/shared/planning';
import type { WorkspacePlanner } from '../../../src/shared/planning';
import type { WorkspaceService } from '../../../src/shared/workspace';

/**
 * 场景一「安排今天的计划」切 Pi 引擎（spec P2，验收 12/13）：同 Fake 模型层
 * （脚本化假模型 / FakeModelClient 固定输出）、同临时 vault、Pi 走
 * plan_preview → commit_plan 网关路径，Legacy 走它唯一的 plan_workspace 路径；
 * 业务结果（最终计划任务）逐字段一致。另锁回滚路径：关 Pi（装配层不注册）后
 * Legacy 场景一结果与 P1 基线一致。
 */

const NOW = new Date(2026, 10, 27, 8, 0, 0); // 2026-11-27（周五）08:00 local
const now = (): Date => new Date(NOW);
const TODAY = '2026-11-27';
const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };

interface Fixture {
  root: string;
  service: WorkspaceService;
  workspaceId: string;
  availability: ReturnType<typeof createAvailabilityService>;
  dispose(): Promise<void>;
}

/** 临时 vault + 可选满日标记（同 P1 scenario-plan 的夹具口径）。 */
async function makeFixture(options: { busyToday?: boolean } = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'asaki-runtime-pi-scenario-'));
  const service = createWorkspaceService(root, { seed: false });
  const created = await service.createWorkspace({
    name: '英语',
    kind: 'study',
    goal: '流利读外刊',
    description: ''
  });
  const availability = createAvailabilityService({ root, now });
  if (options.busyToday !== false) {
    // 2026-11-23 是本周周一；把今天标为满日 → busyDayMinutes = BUSY_DAY_MINUTES。
    await availability.set({ weekStart: '2026-11-23', busyDates: [TODAY] });
  }
  return {
    root,
    service,
    workspaceId: created.id,
    availability,
    async dispose(): Promise<void> {
      await rm(root, { recursive: true, force: true });
    }
  };
}

function butlerContext(fixture: Fixture, planner: WorkspacePlanner): ButlerToolContext {
  return {
    workspace: fixture.service,
    workspaceId: fixture.workspaceId,
    planner,
    weekAvailability: fixture.availability,
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
    engineId: 'pi',
    now,
    ...overrides
  };
}

interface Harness {
  controller: RunController;
  gateway: ToolGateway;
  journal: RunJournal;
  dispose(): Promise<void>;
}

async function makeHarness(engines: ReturnType<typeof assembleEngines>): Promise<Harness> {
  const journalDir = await mkdtemp(join(tmpdir(), 'asaki-runtime-pi-scenario-journal-'));
  const journal = new RunJournal({ dirPath: journalDir, now });
  const gateway = new ToolGateway();
  registerButlerTools(gateway);
  const controller = new RunController({ engines, gateway, journal });
  return {
    controller,
    gateway,
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

interface ScenarioResult {
  finishedState: string;
  eventTypes: string[];
  tasks: Array<Record<string, unknown>>;
  plannerInputs: Parameters<WorkspacePlanner['plan']>[0][];
}

/**
 * 场景一在 Pi 引擎上：真实 planner + 临时 vault + plan_preview/commit_plan
 * 网关路径。模型脚本的 commit_plan 一轮是惰性的——它读录制 planner 收到的
 * 输入，取同一输入的计划任务（同一 planner 同一输入 = 同一输出；与 P1
 * FakeEngine 的 custom 步骤同模式：模型只转述工具结果，不重算规则）。
 */
async function runPiScenario(runId: string, busyToday: boolean): Promise<ScenarioResult> {
  const fixture = await makeFixture({ busyToday });
  try {
    const realPlanner = createWorkspacePlanner({ workspaceService: fixture.service, now });
    const plannerInputs: Parameters<WorkspacePlanner['plan']>[0][] = [];
    const planner: WorkspacePlanner = {
      plan: async (input) => {
        plannerInputs.push(input);
        return realPlanner.plan(input);
      }
    };
    const gateway = new ToolGateway();
    registerButlerTools(gateway);
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
                arguments: {
                  workspaceId: input.workspaceId,
                  date: plan.date,
                  tasks: plan.tasks
                }
              }
            ]
          };
        },
        { finalText: '已生成今天的计划。' }
      ]),
      tools: gateway,
      systemPrompt: '你是学习管家。'
    });
    const { controller, journal, dispose } = await makeHarness(assembleEngines({ pi: engine }));
    try {
      const collector = collect(controller, runId);
      const handle = controller.start(
        makeRequest({ runId, workspaceIds: [fixture.workspaceId] }),
        { butler: butlerContext(fixture, planner) }
      );
      await collector.waitFor((event) => event.type === 'approval.requested');
      expect(await controller.approve(runId, 'approved')).toBe(true);
      const state = await handle.done;
      const journaled = await journal.readRun(runId);
      const snapshot = await fixture.service.getWorkspaceSnapshot(fixture.workspaceId);
      return {
        finishedState: state,
        eventTypes: (journaled.length > 0 ? journaled : collector.events).map((event) => event.type),
        tasks: snapshot.tasks.map((task) => ({
          title: task.title,
          subject: task.subject,
          durationMin: task.durationMin,
          acceptance: task.acceptance,
          due: task.due,
          status: task.status
        })),
        plannerInputs
      };
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
}

/** 场景一在 Legacy 引擎上（P1 验收 10 的原脚本，逐字复用）。 */
async function runLegacyScenario(runId: string, busyToday: boolean): Promise<ScenarioResult> {
  const fixture = await makeFixture({ busyToday });
  try {
    const planner = createWorkspacePlanner({ workspaceService: fixture.service, now });
    const client = new FakeModelClient([
      {
        text: '',
        usage: ZERO_USAGE,
        toolCalls: [{ id: 'p1', name: 'plan_workspace', arguments: {} }]
      },
      { text: '已生成今天的计划。', usage: ZERO_USAGE }
    ]);
    const butler = new ButlerServiceImpl({
      workspaceService: fixture.service,
      modelClient: client,
      planner,
      now,
      maxToolSteps: 4
    });
    const engine = new LegacyEngine({ butler });
    const { controller, journal, dispose } = await makeHarness(assembleEngines({ legacy: engine }));
    try {
      const collector = collect(controller, runId);
      const handle = controller.start(
        makeRequest({ runId, workspaceIds: [fixture.workspaceId], engineId: 'legacy' }),
        { butler: butlerContext(fixture, planner) }
      );
      const state = await handle.done;
      const journaled = await journal.readRun(runId);
      const snapshot = await fixture.service.getWorkspaceSnapshot(fixture.workspaceId);
      return {
        finishedState: state,
        eventTypes: (journaled.length > 0 ? journaled : collector.events).map((event) => event.type),
        tasks: snapshot.tasks.map((task) => ({
          title: task.title,
          subject: task.subject,
          durationMin: task.durationMin,
          acceptance: task.acceptance,
          due: task.due,
          status: task.status
        })),
        plannerInputs: []
      };
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
}

test('验收 12：场景一切 Pi 引擎，业务结果与 Legacy 逐字段一致（同临时 vault、同 planner）', async () => {
  const [pi, legacy] = await Promise.all([
    runPiScenario('run-pi', false),
    runLegacyScenario('run-legacy', false)
  ]);
  expect(pi.finishedState).toBe('completed');
  expect(legacy.finishedState).toBe('completed');
  // Pi 走网关：预览（query）→ 提交（confirm，带审批与回执）。
  expect(pi.eventTypes).toEqual([
    'run.started',
    'text.delta',
    'tool.committed', // plan_preview（query 级，自动执行）
    'approval.requested', // commit_plan（confirm 级）
    'tool.committed',
    'service.receipt',
    'text.delta',
    'run.finished'
  ]);
  // 业务结果逐字段一致（id/时间戳除外）。
  expect(pi.tasks).toEqual(legacy.tasks);
  expect(pi.tasks).toHaveLength(1);
  expect(pi.tasks[0]).toMatchObject({ due: TODAY, status: 'pending' });
  // planner 收到的输入两边同形（无 availableMinutes 时的 week 读数一致地缺席）。
  expect(legacy.tasks[0]?.['durationMin']).toBe(pi.tasks[0]?.['durationMin']);
});

test('场景一（Pi，满日）：满日规则生效——planner 收 week 读数，只排 1 件 ≤10 分钟，审批+回执齐备', async () => {
  const result = await runPiScenario('run-busy', true);
  expect(result.finishedState).toBe('completed');
  // 两条输入：plan_preview 一次 + 惰性轮给脚本读任务清单一次（同形输入）。
  expect(result.plannerInputs).toHaveLength(2);
  expect(result.plannerInputs[0]).toEqual(result.plannerInputs[1]);
  expect(result.plannerInputs[0]).toEqual({
    workspaceId: expect.any(String),
    date: TODAY,
    weekAvailabilityMinutes: BUSY_DAY_MINUTES
  });
  expect(result.tasks).toHaveLength(1);
  expect(result.tasks[0]?.['durationMin']).toBeLessThanOrEqual(BUSY_DAY_MINUTES);
  expect(result.tasks[0]).toMatchObject({ due: TODAY, status: 'pending' });
  expect(result.eventTypes).toEqual([
    'run.started',
    'text.delta',
    'tool.committed',
    'approval.requested',
    'tool.committed',
    'service.receipt',
    'text.delta',
    'run.finished'
  ]);
});

test('验收 13（回滚）：关 Pi 后 Legacy 场景一与 P1 基线逐字段一致；engineId=pi 不可达', async () => {
  // 关 Pi = 装配层不注册 PiEngine（engine-selection 的开关语义）。
  const assembly = assembleEngines({ fake: null, pi: null });
  expect(assembly.map((engine) => engine.id)).not.toContain('pi');

  const fixture = await makeFixture({ busyToday: false });
  try {
    const planner = createWorkspacePlanner({ workspaceService: fixture.service, now });
    const client = new FakeModelClient([
      {
        text: '',
        usage: ZERO_USAGE,
        toolCalls: [{ id: 'p1', name: 'plan_workspace', arguments: {} }]
      },
      { text: '已生成今天的计划。', usage: ZERO_USAGE }
    ]);
    const butler = new ButlerServiceImpl({
      workspaceService: fixture.service,
      modelClient: client,
      planner,
      now,
      maxToolSteps: 4
    });
    const { controller, journal, dispose } = await makeHarness(assembleEngines({ legacy: new LegacyEngine({ butler }) }));
    try {
      // 开关语义：装配里没有 Pi 引擎。
      expect(hasEngine(assembleEngines({ fake: null, pi: null }), 'pi')).toBe(false);
      const collector = collect(controller, 'run-legacy-off');
      const handle = controller.start(
        makeRequest({ runId: 'run-legacy-off', workspaceIds: [fixture.workspaceId], engineId: 'legacy' }),
        { butler: butlerContext(fixture, planner) }
      );
      expect(await handle.done).toBe('completed');
      // P1 基线（scenario-plan.test.ts 验收 10 的事件序列与落盘结果）。
      const journaled = await journal.readRun('run-legacy-off');
      expect(journaled.map((event) => event.type)).toEqual(collector.events.map((event) => event.type));
      expect(collector.events.map((event) => event.type)).toEqual([
        'run.started',
        'tool.committed',
        'service.receipt',
        'text.delta',
        'run.finished'
      ]);
      const snapshot = await fixture.service.getWorkspaceSnapshot(fixture.workspaceId);
      expect(snapshot.tasks).toHaveLength(1);
      expect(snapshot.tasks[0]).toMatchObject({ due: TODAY, status: 'pending' });
      // Pi 关闭后：engineId 'pi' 的请求在 start 即拒绝（P0 未知引擎校验）。
      expect(() =>
        controller.start(
          makeRequest({ runId: 'run-pi-off', workspaceIds: [fixture.workspaceId], engineId: 'pi' }),
          { butler: butlerContext(fixture, planner) }
        )
      ).toThrow(/未知引擎/);
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});
