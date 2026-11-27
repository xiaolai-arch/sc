import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAvailabilityService } from '../../../src/main/availability/service';
import { ButlerServiceImpl } from '../../../src/main/butler/butler-service';
import type { ButlerToolContext } from '../../../src/main/butler/tools';
import { FakeModelClient } from '../../../src/main/agent/model-client';
import { createWorkspaceService } from '../../../src/main/workspace/create-workspace-service';
import { createWorkspacePlanner } from '../../../src/main/planning/workspace-planner';
import { LegacyEngine } from '../../../src/main/runtime/legacy-engine';
import { FakeEngine } from '../../../src/main/runtime/fake-engine';
import { registerButlerTools } from '../../../src/main/runtime/butler-bridge';
import { RunController } from '../../../src/main/runtime/run-controller';
import { RunJournal } from '../../../src/main/runtime/run-journal';
import { ToolGateway } from '../../../src/main/runtime/tool-gateway';
import type { RunEvent, RunRequest } from '../../../src/main/runtime/contracts';
import { BUSY_DAY_MINUTES } from '../../../src/shared/planning';
import type { WorkspacePlanner } from '../../../src/shared/planning';
import type { WorkspaceService } from '../../../src/shared/workspace';

/**
 * 场景一「安排今天的计划」（spec P1，验收 7–10）：Fake 路径走 P0 的
 * FakeEngine + 网关（plan_preview/commit_plan），Legacy 路径经 LegacyEngine
 * 跑真实 planner。取消、确认、失败不说成功都在这两条路径上端到端走通。
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

/** 临时 vault + 满日标记：今天（2026-11-27）被记为特别满的一天。 */
async function makeFixture(options: { busyToday?: boolean } = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'asaki-runtime-scenario-'));
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

function butlerContext(
  fixture: Fixture,
  planner: WorkspacePlanner,
  overrides: Partial<ButlerToolContext> = {}
): ButlerToolContext {
  return {
    workspace: fixture.service,
    workspaceId: fixture.workspaceId,
    planner,
    weekAvailability: fixture.availability,
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

async function makeHarness(engines: Array<FakeEngine | LegacyEngine>): Promise<Harness> {
  const journalDir = await mkdtemp(join(tmpdir(), 'asaki-runtime-scenario-journal-'));
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

/** 包装真实 planner，只记录每次收到的入参（验收 8：planner 收到 availableMinutes=30）。 */
function recordingPlanner(real: WorkspacePlanner): {
  planner: WorkspacePlanner;
  inputs: Parameters<WorkspacePlanner['plan']>[0][];
} {
  const inputs: Parameters<WorkspacePlanner['plan']>[0][] = [];
  const planner: WorkspacePlanner = {
    plan: async (input) => {
      inputs.push(input);
      return real.plan(input);
    }
  };
  return { planner, inputs };
}

interface PlanPreviewResult {
  workspaceId: string;
  date: string;
  generatedBy: string;
  availableMinutes?: number;
  availableMinutesSource?: string;
  tasks: Array<{ title: string; subject: string; durationMin: number; acceptance: string }>;
}

test('验收 7（Fake）：满日生成计划只排 1 件 ≤10 分钟，与直接调用 planner 一致；确认提交后有回执 → 终态 completed', async () => {
  const fixture = await makeFixture();
  try {
    const realPlanner = createWorkspacePlanner({ workspaceService: fixture.service, now });
    const { planner, inputs } = recordingPlanner(realPlanner);

    const engine = new FakeEngine({
      steps: [
        { type: 'tool', name: 'plan_preview' },
        {
          type: 'custom',
          run: async (context) => {
            const preview = engine.invocations[0]?.outcome
              .result as unknown as PlanPreviewResult;
            await context.tools.invoke('commit_plan', {
              workspaceId: preview.workspaceId,
              date: preview.date,
              tasks: preview.tasks
            });
          }
        },
        { type: 'receipt', detail: 'commit_plan 成功' }
      ]
    });
    const { controller, journal, dispose } = await makeHarness([engine]);
    try {
      const collector = collect(controller, 'run-1');
      const handle = controller.start(makeRequest({ workspaceIds: [fixture.workspaceId] }), {
        butler: butlerContext(fixture, planner)
      });
      await collector.waitFor((event) => event.type === 'approval.requested');
      expect(await controller.approve('run-1', 'approved')).toBe(true);
      expect(await handle.done).toBe('completed');

      // planner 收到的是 busy-day 读数（10 分钟），由工具层传入——模型没有参与计算。
      expect(inputs).toEqual([
        {
          workspaceId: fixture.workspaceId,
          date: TODAY,
          weekAvailabilityMinutes: BUSY_DAY_MINUTES
        }
      ]);

      // 与直接调用 planner 结果一致（同一入参，逐字段相等）。
      const direct = await realPlanner.plan({
        workspaceId: fixture.workspaceId,
        date: TODAY,
        weekAvailabilityMinutes: BUSY_DAY_MINUTES
      });
      const previewEvent = engine.invocations[0];
      const preview = previewEvent?.outcome.result as unknown as PlanPreviewResult;
      expect(previewEvent?.outcome.ok).toBe(true);
      expect(preview.date).toBe(direct.date);
      expect(preview.generatedBy).toBe(direct.generatedBy);
      expect(preview.availableMinutes).toBe(direct.availableMinutes);
      expect(preview.availableMinutesSource).toBe(direct.availableMinutesSource);
      expect(preview.tasks).toEqual(direct.tasks);
      // 满日规则：只排 1 件、时长 ≤ BUSY_DAY_MINUTES。
      expect(direct.tasks).toHaveLength(1);
      expect(direct.tasks[0]?.durationMin).toBeLessThanOrEqual(BUSY_DAY_MINUTES);
      expect(direct.availableMinutes).toBe(BUSY_DAY_MINUTES);
      expect(direct.availableMinutesSource).toBe('week');

      // 确认 → 提交 → 服务回执 → 终态 completed（缝①：不是 pending-verification）。
      const types = collector.events.map((event) => event.type);
      expect(types).toEqual([
        'run.started',
        'tool.committed', // plan_preview：查询级自动执行
        'approval.requested', // commit_plan：确认级
        'tool.committed',
        'service.receipt',
        'run.finished'
      ]);
      expect(collector.events.at(-1)).toMatchObject({ type: 'run.finished', state: 'completed' });
      expect(controller.getRun('run-1')?.state).toBe('completed');

      // 落盘与事件一致：预览的任务按 plan.date 写入。
      const snapshot = await fixture.service.getWorkspaceSnapshot(fixture.workspaceId);
      expect(snapshot.tasks).toHaveLength(1);
      expect(snapshot.tasks[0]).toMatchObject({
        ...direct.tasks[0],
        due: direct.date
      });
      const journaled = await journal.readRun('run-1');
      expect(journaled.map((event) => event.type)).toEqual(types);
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

test('验收 8（Fake）：「今天有 30 分钟」按 30 分钟排，planner 收到 availableMinutes=30，预算不归模型重算', async () => {
  const fixture = await makeFixture();
  try {
    const realPlanner = createWorkspacePlanner({ workspaceService: fixture.service, now });
    const { planner, inputs } = recordingPlanner(realPlanner);
    const engine = new FakeEngine({
      steps: [{ type: 'tool', name: 'plan_preview', args: { availableMinutes: 30 } }]
    });
    const { controller, dispose } = await makeHarness([engine]);
    try {
      const collector = collect(controller, 'run-1');
      const handle = controller.start(
        makeRequest({
          workspaceIds: [fixture.workspaceId],
          userInput: '今天有 30 分钟，帮我安排计划'
        }),
        { butler: butlerContext(fixture, planner) }
      );
      expect(await handle.done).toBe('completed');

      // planner 收到 availableMinutes=30；满日读数被显式输入压制（不传 week 值）。
      expect(inputs).toEqual([{ workspaceId: fixture.workspaceId, date: TODAY, availableMinutes: 30 }]);
      const preview = engine.invocations[0]?.outcome.result as unknown as PlanPreviewResult;
      expect(preview.availableMinutes).toBe(30);
      expect(preview.availableMinutesSource).toBe('input');
      const total = preview.tasks.reduce((sum, task) => sum + task.durationMin, 0);
      expect(total).toBeLessThanOrEqual(30);
      // 尽管今天是满日，来源仍是 input——规则在服务层，不在模型嘴里。
      expect(collector.events.some((event) => event.type === 'approval.requested')).toBe(false);
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

test('验收 8（planner 提示词层）：预算是代码算好的事实，不是让模型重算的规则', async () => {
  const fixture = await makeFixture();
  try {
    const fakeModel = new FakeModelClient(['这不是 JSON']);
    const modelPlanner = createWorkspacePlanner({
      workspaceService: fixture.service,
      modelClient: fakeModel,
      now
    });
    await modelPlanner.plan({
      workspaceId: fixture.workspaceId,
      date: TODAY,
      availableMinutes: 30
    });
    const prompt = fakeModel.calls[0]?.messages.map((message) => message.content).join('\n') ?? '';
    // 可用时间以事实形式写进提示词（来源：用户本次说明）。
    expect(prompt).toContain('今日可用时间：约 30 分钟（用户本次说明）');
    // 显式输入压制了满日规则行：不存在任何让模型自行折算可用时间的话术。
    expect(prompt).not.toContain('这天用户说特别满');
  } finally {
    await fixture.dispose();
  }
});

test('验收 9（Fake）：提交工具报错 → 运行「失败」，事件层无成功文案，run.finished 与落盘一致', async () => {
  const fixture = await makeFixture();
  try {
    const planner = createWorkspacePlanner({ workspaceService: fixture.service, now });
    const engine = new FakeEngine({
      steps: [
        { type: 'emit', event: { type: 'text.delta', text: '我来为今天生成计划。' } },
        { type: 'tool', name: 'plan_preview' },
        // 无效日期：commit_plan 校验拒绝（工具报错）。
        {
          type: 'tool',
          name: 'commit_plan',
          args: {
            workspaceId: fixture.workspaceId,
            date: '2026-02-30',
            tasks: [{ title: '读一篇外刊', subject: '英语', durationMin: 10, acceptance: '读完' }]
          }
        },
        { type: 'fail', message: 'commit_plan 执行失败' }
      ]
    });
    const { controller, journal, dispose } = await makeHarness([engine]);
    try {
      const collector = collect(controller, 'run-1');
      const handle = controller.start(makeRequest({ workspaceIds: [fixture.workspaceId] }), {
        butler: butlerContext(fixture, planner)
      });
      await collector.waitFor((event) => event.type === 'approval.requested');
      expect(await controller.approve('run-1', 'approved')).toBe(true);
      expect(await handle.done).toBe('failed');

      const failed = collector.events.find((event) => event.type === 'tool.failed');
      expect(failed).toMatchObject({ tool: 'commit_plan' });
      expect((failed as { error?: string }).error).toContain('YYYY-MM-DD');
      // 无服务回执、无成功提交。
      expect(collector.events.some((event) => event.type === 'service.receipt')).toBe(false);
      expect(
        collector.events.filter(
          (event) => event.type === 'tool.committed' && (event as { tool: string }).tool === 'commit_plan'
        )
      ).toHaveLength(0);
      // 事件层不出现成功文案。
      for (const event of collector.events) {
        if (event.type === 'text.delta') {
          expect((event as { text: string }).text).not.toMatch(/已安排|安排好了/);
        }
      }
      // run.finished（失败）与 getRun、Journal、落盘全部一致。
      const finished = collector.events.at(-1);
      expect(finished).toMatchObject({
        type: 'run.finished',
        state: 'failed',
        error: 'commit_plan 执行失败'
      });
      expect(controller.getRun('run-1')).toMatchObject({ state: 'failed' });
      const journaled = await journal.readRun('run-1');
      expect(journaled.at(-1)).toEqual(finished);
      const snapshot = await fixture.service.getWorkspaceSnapshot(fixture.workspaceId);
      expect(snapshot.tasks).toHaveLength(0); // 失败运行没有写入任何任务
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

test('取消（Fake）：预览完成后取消 → cancelled，commit_plan 从未被发起，无写入', async () => {
  const fixture = await makeFixture();
  try {
    const planner = createWorkspacePlanner({ workspaceService: fixture.service, now });
    const engine = new FakeEngine({
      steps: [
        { type: 'tool', name: 'plan_preview' },
        { type: 'gate', name: 'before-commit' },
        { type: 'tool', name: 'commit_plan' },
        { type: 'receipt' }
      ]
    });
    const { controller, journal, dispose } = await makeHarness([engine]);
    try {
      const collector = collect(controller, 'run-1');
      const handle = controller.start(makeRequest({ workspaceIds: [fixture.workspaceId] }), {
        butler: butlerContext(fixture, planner)
      });
      await collector.waitFor(
        (event) => event.type === 'tool.committed' && (event as { tool: string }).tool === 'plan_preview'
      );
      expect(await controller.cancel('run-1')).toBe(true);
      expect(await handle.done).toBe('cancelled');
      expect(controller.getRun('run-1')?.state).toBe('cancelled');
      // 取消后不再执行工具：commit_plan 从未发起，也没有审批请求。
      expect(engine.invocations).toHaveLength(1);
      expect(collector.events.some((event) => event.type === 'approval.requested')).toBe(false);
      expect(collector.events.at(-1)).toMatchObject({ type: 'run.finished', state: 'cancelled' });
      const journaled = await journal.readRun('run-1');
      expect(journaled.at(-1)).toMatchObject({ type: 'run.finished', state: 'cancelled' });
      const snapshot = await fixture.service.getWorkspaceSnapshot(fixture.workspaceId);
      expect(snapshot.tasks).toHaveLength(0);
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

interface LegacyScenarioResult {
  eventTypes: string[];
  finishedState: string;
  tasks: Array<Record<string, unknown>>;
}

/** 同一输入在 Legacy 引擎上跑一遍场景一（真实 planner + 临时 vault）。 */
async function runLegacyScenario(runId: string): Promise<LegacyScenarioResult> {
  const fixture = await makeFixture({ busyToday: false });
  try {
    const planner = createWorkspacePlanner({ workspaceService: fixture.service, now });
    // 模型模拟层：Fake 固定输出（第一轮发起 plan_workspace，第二轮收尾文本）。
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
    const { controller, journal, dispose } = await makeHarness([engine]);
    try {
      const collector = collect(controller, runId);
      const handle = controller.start(
        makeRequest({ runId, workspaceIds: [fixture.workspaceId], engineId: 'legacy' }),
        {
          butler: {
            workspace: fixture.service,
            workspaceId: fixture.workspaceId,
            planner,
            weekAvailability: fixture.availability,
            now
          }
        }
      );
      const state = await handle.done;
      const journaled = await journal.readRun(runId);
      const snapshot = await fixture.service.getWorkspaceSnapshot(fixture.workspaceId);
      return {
        eventTypes: (journaled.length > 0 ? journaled : collector.events).map((event) => event.type),
        finishedState: state,
        tasks: snapshot.tasks.map((task) => ({
          title: task.title,
          subject: task.subject,
          durationMin: task.durationMin,
          acceptance: task.acceptance,
          due: task.due,
          status: task.status
        }))
      };
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
}

test('验收 10（Legacy）：同一输入跑两遍，事件序列与最终计划逐字段一致', async () => {
  const [first, second] = await Promise.all([
    runLegacyScenario('run-a'),
    runLegacyScenario('run-b')
  ]);
  expect(first.finishedState).toBe('completed');
  expect(second.finishedState).toBe('completed');
  expect(first.eventTypes).toEqual([
    'run.started',
    'tool.committed',
    'service.receipt',
    'text.delta',
    'run.finished'
  ]);
  expect(second.eventTypes).toEqual(first.eventTypes);
  // 最终计划逐字段一致（id/时间戳除外）。
  expect(second.tasks).toEqual(first.tasks);
  expect(first.tasks).toHaveLength(1);
  expect(first.tasks[0]).toMatchObject({ due: TODAY, status: 'pending' });
});
