import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelClient } from '../../../src/main/agent/model-client';
import { createAvailabilityService } from '../../../src/main/availability/service';
import { ButlerServiceImpl } from '../../../src/main/butler/butler-service';
import type { ButlerToolContext } from '../../../src/main/butler/tools';
import { createWorkspacePlanner } from '../../../src/main/planning/workspace-planner';
import { createWorkspaceService } from '../../../src/main/workspace/create-workspace-service';
import { assembleRuntime } from '../../../src/main/runtime/assembly';
import type { RunEvent, RunRequest, TerminalRunState } from '../../../src/main/runtime/contracts';
import { LegacyEngine } from '../../../src/main/runtime/legacy-engine';
import { PiEngine, scriptedPiModel } from '../../../src/main/runtime/engine-pi';
import { registerButlerTools } from '../../../src/main/runtime/butler-bridge';
import type { EngineAssembly } from '../../../src/main/runtime/engine-selection';
import { RunJournal } from '../../../src/main/runtime/run-journal';
import { ToolGateway } from '../../../src/main/runtime/tool-gateway';
import type { RunController } from '../../../src/main/runtime/run-controller';
import { BUSY_DAY_MINUTES } from '../../../src/shared/planning';
import type { WorkspacePlanner } from '../../../src/shared/planning';
import type { WorkspaceService } from '../../../src/shared/workspace';

/**
 * 跨批验收 · 场景一的三条用户可见断言（spec 验收 7/8/9），经**真实装配入口
 * assembleRuntime** 在两个真引擎（Legacy/Pi）上逐条走：
 *
 * - 验收 7：满日项目生成计划 → 只排 1 件、时长 ≤ BUSY_DAY_MINUTES(10)，
 *   due=今天、落盘与事件一致；
 * - 验收 8：用户说「今天有 30 分钟」→ 计划按 30 分钟排，planner 收到
 *   `availableMinutes=30`，满日读数被显式输入压制（今天明明种了满日）；
 * - 验收 9：工具报错 → 运行终态「失败」，事件层不出现「已安排」，
 *   `run.finished` 与落盘一致（没有任何任务写入）。
 *
 * 与 P1/P2 既有测试的分工：scenario-plan.test.ts 锁的是 Fake 路径的这三个
 * 验收 + 手工装配；本文件的价值是**跨批**——三条在装配收口后的真实入口
 * （assembleRuntime）上、在两个真引擎上仍然成立。失败注入方式按引擎写真实
 * 路径：Pi 走 commit_plan 参数校验拒假日期，Legacy 走 planner 抛错（
 * plan_workspace 经 executeButlerTool 转 tool-result !ok）。
 */

const NOW = new Date(2026, 10, 28, 8, 0, 0); // 2026-11-28（周六）08:00 local —— 假时钟
const now = (): Date => new Date(NOW);
const TODAY = '2026-11-28';
const MONDAY = '2026-11-23';
const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };
const SUCCESS_WORDING = /已安排|安排好了/;

interface Fixture {
  root: string;
  service: WorkspaceService;
  workspaceId: string;
  availability: ReturnType<typeof createAvailabilityService>;
  dispose(): Promise<void>;
}

/** 今天（假时钟）默认种成满日：验收 7/8/9 的预算语义都要在满日背景上验证。 */
async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'asaki-runtime-accept-plan-'));
  const service = createWorkspaceService(root, { seed: false });
  const created = await service.createWorkspace({
    name: '英语',
    kind: 'study',
    goal: '流利读外刊',
    description: ''
  });
  const availability = createAvailabilityService({ root, now });
  await availability.set({ weekStart: MONDAY, busyDates: [TODAY] });
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
    engineId: 'legacy',
    now,
    ...overrides
  };
}

async function makeHarness(assembly: EngineAssembly): Promise<{
  controller: RunController;
  dispose(): Promise<void>;
}> {
  const journalDir = await mkdtemp(join(tmpdir(), 'asaki-runtime-accept-plan-journal-'));
  const journal = new RunJournal({ dirPath: journalDir, now });
  const { controller } = assembleRuntime({ journal, engines: assembly });
  return {
    controller,
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

interface PlanRunResult {
  state: TerminalRunState;
  events: RunEvent[];
  /** 任务业务字段（剥 id/时间戳）。 */
  tasks: Array<Record<string, unknown>>;
  /** planner 实际收到的每次入参（验收 8 的断言对象）。 */
  plannerInputs: Parameters<WorkspacePlanner['plan']>[0][];
  /** 全部 text.delta 拼接（验收 9 的「无成功文案」断言对象）。 */
  text: string;
}

interface RunOptions {
  /** 模型给 plan 工具带的参数（验收 8 传 availableMinutes: 30）。 */
  planArgs?: Record<string, unknown>;
  /** 验收 9：注入失败（pi=commit_plan 假日期；legacy=planner 抛错）。 */
  fail?: boolean;
}

async function runPiPlan(runId: string, options: RunOptions = {}): Promise<PlanRunResult> {
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
        {
          deltas: ['我来为今天生成计划。'],
          toolCalls: [{ id: 'p1', name: 'plan_preview', arguments: options.planArgs ?? {} }]
        },
        options.fail === true
          ? {
              // 假日期：commit_plan 的 isLocalDate 校验拒绝（真工具报错路径）。
              toolCalls: [
                {
                  id: 'c1',
                  name: 'commit_plan',
                  arguments: {
                    workspaceId: fixture.workspaceId,
                    date: '2026-02-30',
                    tasks: [{ title: '读一篇外刊', subject: '英语', durationMin: 10, acceptance: '读完' }]
                  }
                }
              ]
            }
          : async () => {
              const input = plannerInputs[0];
              if (!input) throw new Error('脚本错误：plan_preview 还没有发生。');
              const plan = await planner.plan(input);
              return {
                toolCalls: [
                  {
                    id: 'c1',
                    name: 'commit_plan',
                    arguments: {
                      workspaceId: input['workspaceId'],
                      date: plan.date,
                      tasks: plan.tasks
                    }
                  }
                ]
              };
            },
        { finalText: options.fail === true ? '计划工具失败了，这次先不排。' : '已生成今天的计划。' }
      ]),
      tools: engineGateway,
      systemPrompt: '你是学习管家。'
    });
    const { controller, dispose } = await makeHarness({ pi: engine });
    try {
      const collector = collect(controller, runId);
      const handle = controller.start(
        makeRequest({ runId, workspaceIds: [fixture.workspaceId], engineId: 'pi' }),
        { butler: butlerContext(fixture, planner) }
      );
      await collector.waitFor((event) => event.type === 'approval.requested');
      expect(await controller.approve(runId, 'approved')).toBe(true);
      const state = await handle.done;
      const snapshot = await fixture.service.getWorkspaceSnapshot(fixture.workspaceId);
      return {
        state,
        events: collector.events,
        tasks: snapshot.tasks.map((task) => ({
          title: task.title,
          subject: task.subject,
          durationMin: task.durationMin,
          acceptance: task.acceptance,
          due: task.due,
          status: task.status
        })),
        plannerInputs,
        text: collector.events
          .filter((event) => event.type === 'text.delta')
          .map((event) => (event as { text: string }).text)
          .join('')
      };
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
}

async function runLegacyPlan(runId: string, options: RunOptions = {}): Promise<PlanRunResult> {
  const fixture = await makeFixture();
  try {
    const realPlanner = createWorkspacePlanner({ workspaceService: fixture.service, now });
    const plannerInputs: Parameters<WorkspacePlanner['plan']>[0][] = [];
    const planner: WorkspacePlanner = options.fail === true
      ? {
          plan: async () => {
            throw new Error('规划器被注入失败（验收 9）');
          }
        }
      : {
          plan: async (input) => {
            plannerInputs.push(input);
            return realPlanner.plan(input);
          }
        };
    const client = new FakeModelClient([
      {
        text: '',
        usage: ZERO_USAGE,
        toolCalls: [
          { id: 'p1', name: 'plan_workspace', arguments: options.planArgs ?? {} }
        ]
      },
      {
        text: options.fail === true ? '计划生成失败了，请稍后再试。' : '已生成今天的计划。',
        usage: ZERO_USAGE
      }
    ]);
    const butler = new ButlerServiceImpl({
      workspaceService: fixture.service,
      modelClient: client,
      planner,
      weekAvailabilityService: fixture.availability,
      now,
      maxToolSteps: 4
    });
    const { controller, dispose } = await makeHarness({ legacy: new LegacyEngine({ butler }) });
    try {
      const collector = collect(controller, runId);
      const handle = controller.start(
        makeRequest({ runId, workspaceIds: [fixture.workspaceId], engineId: 'legacy' }),
        { butler: butlerContext(fixture, planner) }
      );
      const state = await handle.done;
      const snapshot = await fixture.service.getWorkspaceSnapshot(fixture.workspaceId);
      return {
        state,
        events: collector.events,
        tasks: snapshot.tasks.map((task) => ({
          title: task.title,
          subject: task.subject,
          durationMin: task.durationMin,
          acceptance: task.acceptance,
          due: task.due,
          status: task.status
        })),
        plannerInputs,
        text: collector.events
          .filter((event) => event.type === 'text.delta')
          .map((event) => (event as { text: string }).text)
          .join('')
      };
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
}

test('验收 7（跨批，Legacy+Pi 经 assembleRuntime）：满日只排 1 件 ≤10 分钟，due=今天，落盘一致', async () => {
  const [legacy, pi] = await Promise.all([
    runLegacyPlan('run-a7-legacy'),
    runPiPlan('run-a7-pi')
  ]);
  expect(legacy.state).toBe('completed');
  expect(pi.state).toBe('completed');
  for (const result of [legacy, pi]) {
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({ due: TODAY, status: 'pending' });
    expect(result.tasks[0]?.['durationMin']).toBeLessThanOrEqual(BUSY_DAY_MINUTES);
    // 服务回执驱动完成（缝①）：确认级提交后必须有一条 service.receipt。
    expect(result.events.some((event) => event.type === 'service.receipt')).toBe(true);
    expect(result.events.at(-1)).toMatchObject({ type: 'run.finished', state: 'completed' });
  }
});

test('验收 8（跨批）：「今天有 30 分钟」→ planner 收到 availableMinutes=30，满日读数被压制，按 30 分钟排', async () => {
  // 夹具今天仍是满日：断言的重点正是显式输入压过满日读数。
  const [legacy, pi] = await Promise.all([
    runLegacyPlan('run-a8-legacy', { planArgs: { availableMinutes: 30 } }),
    runPiPlan('run-a8-pi', { planArgs: { availableMinutes: 30 } })
  ]);
  expect(legacy.state).toBe('completed');
  expect(pi.state).toBe('completed');

  // planner 收到的入参：availableMinutes=30、日期=今天；满日的 weekAvailabilityMinutes 键不存在。
  // Legacy 一次（plan_workspace），Pi 两次（plan_preview + 脚本轮按同输入取任务清单，同形）。
  expect(legacy.plannerInputs).toHaveLength(1);
  expect(pi.plannerInputs).toHaveLength(2);
  expect(pi.plannerInputs[0]).toEqual(pi.plannerInputs[1]);
  for (const input of [...legacy.plannerInputs, ...pi.plannerInputs]) {
    expect(input).toMatchObject({ availableMinutes: 30 });
    expect(input).not.toHaveProperty('weekAvailabilityMinutes');
  }

  // 用户可见结果：任务总时长 ≤ 30 分钟（按用户说的时间排）。
  for (const result of [legacy, pi]) {
    const total = result.tasks.reduce((sum, task) => sum + Number(task['durationMin'] ?? 0), 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(30);
    expect(result.tasks.every((task) => task['due'] === TODAY)).toBe(true);
  }
});

test('验收 9（跨批）：工具报错 → 运行「失败」，事件层无「已安排」，落盘零写入', async () => {
  const [legacy, pi] = await Promise.all([
    runLegacyPlan('run-a9-legacy', { fail: true }),
    runPiPlan('run-a9-pi', { fail: true })
  ]);
  for (const [label, result] of [
    ['legacy', legacy],
    ['pi', pi]
  ] as const) {
    // 终态失败（失败不说成功），getRun 与事件一致。
    expect(`${label}:${result.state}`).toBe(`${label}:failed`);
    const finished = result.events.at(-1);
    expect(finished).toMatchObject({ type: 'run.finished', state: 'failed' });
    // 工具失败事件在场，成功提交与回执不在场。
    const failed = result.events.find((event) => event.type === 'tool.failed');
    expect(failed).toBeDefined();
    expect(
      result.events.filter(
        (event) => event.type === 'tool.committed' && (event as { tool: string }).tool !== 'plan_preview'
      )
    ).toHaveLength(0);
    expect(result.events.some((event) => event.type === 'service.receipt')).toBe(false);
    // 用户可见文案不出现「已安排」。
    expect(result.text).not.toMatch(SUCCESS_WORDING);
    // 落盘一致：失败运行没有写入任何任务。
    expect(result.tasks).toHaveLength(0);
  }
  // Pi 侧的失败是 commit_plan 对假日期的校验拒绝（YYYY-MM-DD）。
  const piFailed = pi.events.find((event) => event.type === 'tool.failed') as { error?: string };
  expect(piFailed.error).toContain('YYYY-MM-DD');
  // Legacy 侧的失败是 plan_workspace 经 executeButlerTool 的真实失败回执。
  const legacyFailed = legacy.events.find((event) => event.type === 'tool.failed') as {
    tool?: string;
  };
  expect(legacyFailed.tool).toBe('plan_workspace');
});
