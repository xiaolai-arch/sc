import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { FakeModelClient } from '../../../src/main/agent/model-client';
import { createAvailabilityService } from '../../../src/main/availability/service';
import { ButlerServiceImpl } from '../../../src/main/butler/butler-service';
import type { ButlerToolContext } from '../../../src/main/butler/tools';
import { serializeCommitmentsFile, type Commitment } from '../../../src/main/commitments/records';
import { createCommitmentService } from '../../../src/main/commitments/service';
import { createWorkspacePlanner } from '../../../src/main/planning/workspace-planner';
import { createWorkspaceService } from '../../../src/main/workspace/create-workspace-service';
import { commitmentsFile, tasksDir } from '../../../src/main/workspace/paths';
import { assembleRuntime } from '../../../src/main/runtime/assembly';
import type { RunEvent, RunRequest, TerminalRunState } from '../../../src/main/runtime/contracts';
import { LegacyEngine } from '../../../src/main/runtime/legacy-engine';
import { PiEngine, scriptedPiModel } from '../../../src/main/runtime/engine-pi';
import { registerButlerTools } from '../../../src/main/runtime/butler-bridge';
import { type EngineAssembly } from '../../../src/main/runtime/engine-selection';
import { RunJournal } from '../../../src/main/runtime/run-journal';
import { ToolGateway } from '../../../src/main/runtime/tool-gateway';
import type { RunController } from '../../../src/main/runtime/run-controller';
import { BUSY_DAY_MINUTES } from '../../../src/shared/planning';
import type { WorkspacePlanner } from '../../../src/shared/planning';
import type { WorkspaceService } from '../../../src/shared/workspace';

/**
 * 跨批验收 · 双引擎对拍（任务书第 1 条，最重要）
 *
 * 「三个场景（排计划 / 承诺改期 / 周总结）各写成一条测试，用 Fake 模型固定
 * 输出 + 临时 vault，分别在 LegacyEngine 和 PiEngine 上跑，断言**最终 vault
 * 内容逐字段一致**（不一致的地方就是真 bug，别绕过去）。」
 *
 * 做法：
 * - 同一场景在**两个独立临时 vault** 上各跑一次（Legacy 一份、Pi 一份）——
 *   引擎写的是真实盘，共用 vault 会互相污染；
 * - 断言**最终 vault 文件内容**，不是回复措辞：整个 vault 读成
 *   「相对路径 → 正文」，只归一化「每次必不同、与业务无关」的东西（时间戳、
 *   随机 id），归一化后逐字节比对——剩余任何差异测试即红，两边正文原样打出；
 * - 假时钟 NOW（相对今天固定，不吃 date-rot）。
 *
 * 场景覆盖与边界：
 * - 场景一 排计划：可对拍（Pi 走 plan_preview/commit_plan，Legacy 走
 *   plan_workspace）；取满日变体（非满日对拍已有 scenario-plan-pi.test.ts
 *   验收 12 锁着）。
 * - 场景二 承诺改期：P3 的 reschedule_commitment 未合入，先对拍**现有入口**
 *   resolve_commitment+newDue 的最终 vault 一致性；P3 合入后在此扩展（验收
 *   17/18/23 旁路负例，见文件尾待补清单）。
 * - 场景三 周总结：P4 未合入 → skip 占位（不装绿，门禁里可见）。
 */

const NOW = new Date(2026, 10, 28, 8, 0, 0); // 2026-11-28（周六）08:00 local —— 假时钟
const now = (): Date => new Date(NOW);
const TODAY = '2026-11-28';
const MONDAY = '2026-11-23'; // 本周周一（满日种数据用）
const TOMORROW = '2026-11-29';
const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };

interface Fixture {
  root: string;
  service: WorkspaceService;
  workspaceId: string;
  availability: ReturnType<typeof createAvailabilityService>;
  commitments: ReturnType<typeof createCommitmentService>;
  dispose(): Promise<void>;
}

async function makeFixture(options: { busyToday?: boolean } = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'asaki-runtime-accept-'));
  const service = createWorkspaceService(root, { seed: false });
  const created = await service.createWorkspace({
    name: '英语',
    kind: 'study',
    goal: '流利读外刊',
    description: ''
  });
  const availability = createAvailabilityService({ root, now });
  if (options.busyToday !== false) {
    await availability.set({ weekStart: MONDAY, busyDates: [TODAY] });
  }
  const commitments = createCommitmentService({ root, now });
  return {
    root,
    service,
    workspaceId: created.id,
    availability,
    commitments,
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
    commitments: fixture.commitments,
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

interface Harness {
  controller: RunController;
  dispose(): Promise<void>;
}

/** 装配走真实入口 assembleRuntime（工具注册 + 确认级一致性断言全走）。 */
async function makeHarness(assembly: EngineAssembly): Promise<Harness> {
  const journalDir = await mkdtemp(join(tmpdir(), 'asaki-runtime-accept-journal-'));
  const journal = new RunJournal({ dirPath: journalDir, now });
  // assembleRuntime 内部自己做 assembleEngines（含默认引擎禁令守卫）。
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

/**
 * 归一化一段 vault 文本：抹掉「每次必不同、与业务结果无关」的内容。
 * - ISO 时间戳（含毫秒，可带 Z）：任务/工作区的 created/updated 等；
 * - 随机 id：`<前缀>-<8位hex>`（ws-… / t-… / cm-… 等，randomUUID 前 8 位）。
 * 日期（YYYY-MM-DD，无时间部分）不是随机值——保留不动。
 */
function normalizeVaultText(raw: string): string {
  return raw
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, '<TS>')
    .replace(/\b[a-z]+-[0-9a-f]{8}\b/g, '$1-<ID>');
}

/** 读整个 vault 成「归一化相对路径 → 归一化正文」。journal（data/）不算 vault。 */
async function readVaultNormalized(fixture: Fixture): Promise<Record<string, string>> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.name === 'data' && dir === fixture.root) continue; // RunJournal 落盘
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  await walk(fixture.root);
  const out: Record<string, string> = {};
  for (const file of files) {
    const rel = normalizeVaultText(relative(fixture.root, file).replaceAll('\\', '/'));
    out[rel] = normalizeVaultText(await readFile(file, 'utf8'));
  }
  return out;
}

interface ScenarioResult {
  state: TerminalRunState;
  vault: Record<string, string>;
  /** 用户可见结果的解析读数（快照任务，业务字段；时间戳/id 已剥）。 */
  tasks: Array<Record<string, unknown>>;
  tasksDirFiles: string[];
}

/** 场景一（排计划）在 Pi 上：plan_preview → commit_plan（网关审批）。 */
async function runPiPlan(runId: string): Promise<ScenarioResult> {
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
    // PiEngine 的 definitions() 走自己的网关（只读清单；真正 invoke 走控制器
    // 那个网关——与 scenario-plan-pi.test.ts 同一装配形态）。
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
        vault: await readVaultNormalized(fixture),
        tasks: snapshot.tasks.map((task) => ({
          title: task.title,
          subject: task.subject,
          durationMin: task.durationMin,
          acceptance: task.acceptance,
          due: task.due,
          status: task.status
        })),
        tasksDirFiles: (await readdir(tasksDir(fixture.root, fixture.workspaceId))).sort()
      };
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
}

/** 场景一（排计划）在 Legacy 上：plan_workspace 一体化路径。 */
async function runLegacyPlan(runId: string): Promise<ScenarioResult> {
  const fixture = await makeFixture();
  try {
    const planner = createWorkspacePlanner({ workspaceService: fixture.service, now });
    const client = new FakeModelClient([
      { text: '', usage: ZERO_USAGE, toolCalls: [{ id: 'p1', name: 'plan_workspace', arguments: {} }] },
      { text: '已生成今天的计划。', usage: ZERO_USAGE }
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
      const handle = controller.start(
        makeRequest({ runId, workspaceIds: [fixture.workspaceId], engineId: 'legacy' }),
        { butler: butlerContext(fixture, planner) }
      );
      const state = await handle.done;
      const snapshot = await fixture.service.getWorkspaceSnapshot(fixture.workspaceId);
      return {
        state,
        vault: await readVaultNormalized(fixture),
        tasks: snapshot.tasks.map((task) => ({
          title: task.title,
          subject: task.subject,
          durationMin: task.durationMin,
          acceptance: task.acceptance,
          due: task.due,
          status: task.status
        })),
        tasksDirFiles: (await readdir(tasksDir(fixture.root, fixture.workspaceId))).sort()
      };
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
}

test('对拍·场景一（排计划·满日）：Legacy 与 Pi 的最终 vault 逐字段一致，且只排 1 件 ≤10 分钟', async () => {
  const [legacy, pi] = await Promise.all([
    runLegacyPlan('run-parity-legacy'),
    runPiPlan('run-parity-pi')
  ]);
  expect(legacy.state).toBe('completed');
  expect(pi.state).toBe('completed');
  // 最终 vault 内容逐字段一致。失败时 vitest 原样打印两边 map：
  // 任何多余文件、缺失文件、字段值差都看得见（「别绕过去」）。
  expect(pi.vault).toEqual(legacy.vault);
  // 落盘文件清单（tasks/<日期>.md）也一致——「写到哪天」是对拍的一部分。
  expect(pi.tasksDirFiles).toEqual(legacy.tasksDirFiles);
  // 满日规则的用户可见结果（对拍一致之外还要各自对）：只排 1 件、≤10 分钟、due=今天。
  expect(pi.tasks).toEqual(legacy.tasks);
  expect(pi.tasks).toHaveLength(1);
  expect(pi.tasks[0]).toMatchObject({ due: TODAY, status: 'pending' });
  expect(pi.tasks[0]?.['durationMin']).toBeLessThanOrEqual(BUSY_DAY_MINUTES);
});

interface RescheduleResult {
  state: TerminalRunState;
  vault: Record<string, string>;
  /** 承诺服务的解析读数（用户可见结果的权威形状）。 */
  commitments: Commitment[];
}

/** 场景二（承诺改期）：两种子 vault 种同一条承诺，Legacy/Pi 各改一次期。 */
async function seedCommitment(root: string): Promise<void> {
  await writeFile(
    commitmentsFile(root),
    serializeCommitmentsFile([
      {
        id: 'cm-seed',
        text: '周五前读完第一章',
        due: TODAY,
        status: 'open',
        createdAt: '2026-11-27T08:00:00.000Z'
      }
    ]),
    'utf8'
  );
}

async function runPiReschedule(runId: string): Promise<RescheduleResult> {
  const fixture = await makeFixture({ busyToday: false });
  try {
    await seedCommitment(fixture.root);
    const planner = createWorkspacePlanner({ workspaceService: fixture.service, now });
    const engineGateway = new ToolGateway();
    registerButlerTools(engineGateway);
    const engine = new PiEngine({
      streamFn: scriptedPiModel([
        {
          deltas: ['我看一下你的承诺。'],
          toolCalls: [
            { id: 'r1', name: 'resolve_commitment', arguments: { id: 'cm-seed', newDue: TOMORROW } }
          ]
        },
        { finalText: '已把承诺挪到明天。' }
      ]),
      tools: engineGateway,
      systemPrompt: '你是学习管家。'
    });
    const { controller, dispose } = await makeHarness({ pi: engine });
    try {
      const collector = collect(controller, runId);
      const handle = controller.start(
        makeRequest({
          runId,
          workspaceIds: [fixture.workspaceId],
          engineId: 'pi',
          userInput: '把「周五前读完第一章」改到明天'
        }),
        { butler: butlerContext(fixture, planner) }
      );
      await collector.waitFor((event) => event.type === 'approval.requested');
      expect(await controller.approve(runId, 'approved')).toBe(true);
      const state = await handle.done;
      return {
        state,
        vault: await readVaultNormalized(fixture),
        commitments: await fixture.commitments.list()
      };
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
}

async function runLegacyReschedule(runId: string): Promise<RescheduleResult> {
  const fixture = await makeFixture({ busyToday: false });
  try {
    await seedCommitment(fixture.root);
    const planner = createWorkspacePlanner({ workspaceService: fixture.service, now });
    const client = new FakeModelClient([
      {
        text: '',
        usage: ZERO_USAGE,
        toolCalls: [
          { id: 'r1', name: 'resolve_commitment', arguments: { id: 'cm-seed', newDue: TOMORROW } }
        ]
      },
      { text: '已把承诺挪到明天。', usage: ZERO_USAGE }
    ]);
    const butler = new ButlerServiceImpl({
      workspaceService: fixture.service,
      modelClient: client,
      planner,
      commitmentService: fixture.commitments,
      now,
      maxToolSteps: 4
    });
    const { controller, dispose } = await makeHarness({ legacy: new LegacyEngine({ butler }) });
    try {
      const handle = controller.start(
        makeRequest({
          runId,
          workspaceIds: [fixture.workspaceId],
          engineId: 'legacy',
          userInput: '把「周五前读完第一章」改到明天'
        }),
        { butler: butlerContext(fixture, planner) }
      );
      const state = await handle.done;
      return {
        state,
        vault: await readVaultNormalized(fixture),
        commitments: await fixture.commitments.list()
      };
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
}

test('对拍·场景二（承诺改期，现入口 resolve_commitment+newDue）：Legacy 与 Pi 的最终 vault 逐字段一致', async () => {
  const [legacy, pi] = await Promise.all([
    runLegacyReschedule('run-resched-legacy'),
    runPiReschedule('run-resched-pi')
  ]);
  expect(legacy.state).toBe('completed');
  expect(pi.state).toBe('completed');
  expect(pi.vault).toEqual(legacy.vault);
  // 用户可见结果（解析读数）：承诺被改到目标日、保持 open、resolvedAt 清空。
  // id 是种子固定的（cm-seed），两边逐字段相等含 id/createdAt。
  expect(pi.commitments).toEqual(legacy.commitments);
  expect(pi.commitments).toEqual([
    {
      id: 'cm-seed',
      text: '周五前读完第一章',
      due: TOMORROW,
      status: 'open',
      createdAt: '2026-11-27T08:00:00.000Z'
    }
  ]);
  // 注意：本条对拍的是 P3 之前的现入口。P3 合入后按任务书第 4 条在此文件补
  // 三条旁路负例（同名取第一条 / 审批绑参 / 旧入口带 newDue 拒绝）。
});

/** 场景三（周总结）对拍——P4 周总结工具未合入，skip 占位（不装绿）。 */
test.skip('对拍·场景三（周总结）：Legacy 与 Pi 的最终 vault 逐字段一致（待 P4 合入后补）', () => {
  // 待补说明：P4 的周总结工具（只读、跨项目取事实、来源引用）合入后，在此写
  // 与场景一同构的对拍：同一种子 vault（一周的练习/错题/承诺），Legacy 与 Pi
  // 各跑一次周总结，断言最终 vault 归一化内容一致 + 只读（无新增文件）。
  // 依据：spec 验收 20–22。
});
