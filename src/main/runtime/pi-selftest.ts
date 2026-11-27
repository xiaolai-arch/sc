import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import { createAvailabilityService } from '../availability/service';
import { createWorkspaceService } from '../workspace/create-workspace-service';
import { createWorkspacePlanner } from '../planning/workspace-planner';
import type { ButlerToolContext } from '../butler/tools';
import type { RunEvent, RunRequest } from './contracts';
import { assembleRuntime } from './assembly';
import { PiEngine, loadPiAgentCore, scriptedPiModel } from './engine-pi';
import { ToolGateway } from './tool-gateway';
import { RunJournal } from './run-journal';

/**
 * P2 打包自测引导（验收 11 的手测通道，spec :31/:114「打包产物实跑，开发机
 * Node 跑通不算」）。由 `src/main/index.ts` 的 env 开关
 * （`ASAKI_RUNTIME_PI_SELFTEST=1`）进入：在**打包后的 Electron 主进程**里
 * （真实 Electron 运行时 + 打包产物 node_modules 里的锁版本 Pi 包）驱动
 * PiEngine 完成三步——一次流式响应、一次工具调用、一次取消——结果写
 * JSON 文件并按成败退出。
 *
 * 最小可逆：P3 正式装配时删掉 index.ts 的 3 行钩子与本文件即可，不触碰
 * 任何产品行为。三步的业务通道与单测同一套缝（网关、控制器、journal），
 * 模型传输层用脚本化假模型（同 `pi-fake-model`）——本门验证的是「锁版本
 * Pi 包在打包产物里能加载并完整跑通引擎链路」，不是 provider 连通性。
 */

const NOW = new Date(2026, 10, 27, 8, 0, 0);
const now = (): Date => new Date(NOW);
const TODAY = '2026-11-27';

interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
}

interface SelfTestReport {
  packagedElectron: boolean;
  node: string;
  electron: string;
  piAgentCoreLoaded: string;
  steps: StepResult[];
  ok: boolean;
}

function describeEvent(event: RunEvent): string {
  switch (event.type) {
    case 'text.delta':
      return `text.delta(${JSON.stringify(event.text)})`;
    case 'tool.committed':
      return `tool.committed(${event.tool})`;
    case 'tool.failed':
      return `tool.failed(${event.tool},${event.reason})`;
    case 'approval.requested':
      return `approval.requested(${event.tool})`;
    case 'service.receipt':
      return `service.receipt`;
    case 'run.finished':
      return `run.finished(${event.state})`;
    default:
      return event.type;
  }
}

async function runSelfTest(): Promise<SelfTestReport> {
  const steps: StepResult[] = [];
  const report: SelfTestReport = {
    packagedElectron: Boolean(process.versions.electron),
    node: process.versions.node ?? 'unknown',
    electron: process.versions.electron ?? 'none',
    piAgentCoreLoaded: 'unknown',
    steps,
    ok: false
  };
  // 唯一的 Pi 引用走 engine-pi 的动态加载器（engine-pi/ 是零泄漏边界）。
  const pi = await loadPiAgentCore();
  report.piAgentCoreLoaded = `Agent=${typeof pi.Agent}`;
  steps.push({
    step: 'load',
    ok: typeof pi.Agent === 'function',
    detail: `engine-pi 动态加载器在打包主进程加载 Pi 包成功（${report.piAgentCoreLoaded}）`
  });

  // 临时 vault（真实 WorkspaceService，产物运行时写 os 临时目录，不碰用户数据）。
  const root = await mkdtemp(join(tmpdir(), 'asaki-pi-selftest-vault-'));
  const journalDir = await mkdtemp(join(tmpdir(), 'asaki-pi-selftest-journal-'));
  try {
    const service = createWorkspaceService(root, { seed: false });
    const created = await service.createWorkspace({
      name: '自测项目',
      kind: 'study',
      goal: '验证 Pi 引擎',
      description: ''
    });
    const availability = createAvailabilityService({ root, now });
    await availability.set({ weekStart: '2026-11-23', busyDates: [TODAY] });
    const planner = createWorkspacePlanner({ workspaceService: service, now });
    const butler: ButlerToolContext = {
      workspace: service,
      workspaceId: created.id,
      planner,
      weekAvailability: availability,
      now
    };
    const journal = new RunJournal({ dirPath: journalDir, now });

    // 步骤 A：流式响应 + 只读工具调用（plan_preview，query 级网关直执行）。
    // 注释对齐实际行为（P3 装配批修正）：本门只验验收 11 的三步口径
    // 「一次流式、一次工具调用、一次取消」，不跑 commit_plan/审批——确认级
    // 路径（approval.requested → approve → 回执）由 scenario-plan-pi.test.ts
    // 在同一套缝上单测覆盖。
    {
      const gateway = new ToolGateway();
      const { controller } = assembleRuntime({
        gateway,
        journal,
        engines: {
          pi: new PiEngine({
            streamFn: scriptedPiModel([
              {
                deltas: ['我来为今天生成计划。'],
                toolCalls: [{ id: 'p1', name: 'plan_preview', arguments: {} }]
              },
              { finalText: '预览完成（自测不再提交）。' }
            ]),
            tools: gateway,
            systemPrompt: '你是学习管家（自测）。'
          })
        }
      });
      const events: RunEvent[] = [];
      controller.subscribe('selftest-stream', (event) => events.push(event));
      const handle = controller.start(
        {
          runId: 'selftest-stream',
          sessionId: 'selftest-conv',
          origin: 'chat',
          workspaceIds: [created.id],
          userInput: '帮我安排今天的计划（自测）',
          engineId: 'pi',
          now
        },
        { butler }
      );
      const state = await handle.done;
      const types = events.map(describeEvent);
      const streamed = events.some((event) => event.type === 'text.delta');
      const toolCommitted = events.some(
        (event) => event.type === 'tool.committed' && event.tool === 'plan_preview'
      );
      const ok = streamed && toolCommitted && state === 'completed';
      steps.push({
        step: 'stream+tool',
        ok,
        detail: `终态=${state}；流式 delta 与 plan_preview 提交${streamed && toolCommitted ? '齐备' : '缺失'}；事件序列=[${types.join(' → ')}]`
      });
    }

    // 步骤 B：取消（流中 cancel → cancelled，无工具提交）。
    {
      const gateway = new ToolGateway();
      const { controller } = assembleRuntime({
        gateway,
        journal,
        engines: {
          pi: new PiEngine({
            streamFn: scriptedPiModel([
              { deltas: ['自测流开始。'], holdUntilAbort: true },
              {
                toolCalls: [
                  { id: 'never', name: 'create_task', arguments: { title: '不应创建', durationMin: 5 } }
                ]
              }
            ]),
            tools: gateway,
            systemPrompt: '你是学习管家（自测）。'
          })
        }
      });
      const events: RunEvent[] = [];
      const sawDelta = new Promise<void>((resolve) => {
        controller.subscribe('selftest-cancel', (event) => {
          events.push(event);
          if (event.type === 'text.delta') resolve();
        });
      });
      const handle = controller.start(
        {
          runId: 'selftest-cancel',
          sessionId: 'selftest-conv',
          origin: 'chat',
          workspaceIds: [created.id],
          userInput: '帮我安排今天的计划（自测取消）',
          engineId: 'pi',
          now
        },
        { butler }
      );
      await sawDelta;
      await controller.cancel('selftest-cancel');
      const state = await handle.done;
      const committed = events.some((event) => event.type === 'tool.committed');
      const ok = state === 'cancelled' && !committed;
      steps.push({
        step: 'cancel',
        ok,
        detail: `终态=${state}；取消后无工具提交=${!committed}；事件=[${events.map(describeEvent).join(' → ')}]`
      });
    }

    report.ok = steps.every((step) => step.ok);
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    await rm(journalDir, { recursive: true, force: true }).catch(() => undefined);
  }
  return report;
}

/** env 开关入口：跑三步、写结果文件、按成败退出进程。 */
export async function runPiSelfTest(): Promise<void> {
  const outPath = process.env['ASAKI_RUNTIME_PI_SELFTEST_OUT']?.trim();
  let report: SelfTestReport;
  try {
    report = await Promise.race([
      runSelfTest(),
      new Promise<SelfTestReport>((_, reject) => {
        setTimeout(() => reject(new Error('selftest timeout (60s)')), 60_000);
      })
    ]);
  } catch (error) {
    report = {
      packagedElectron: Boolean(process.versions.electron),
      node: process.versions.node ?? 'unknown',
      electron: process.versions.electron ?? 'none',
      piAgentCoreLoaded: 'load failed',
      steps: [{ step: 'fatal', ok: false, detail: error instanceof Error ? error.message : String(error) }],
      ok: false
    };
  }
  const lines = [
    `[pi-selftest] ok=${report.ok} node=${report.node} electron=${report.electron}`,
    ...report.steps.map((step) => `[pi-selftest] ${step.step}: ${step.ok ? 'PASS' : 'FAIL'} — ${step.detail}`)
  ];
  for (const line of lines) console.log(line);
  if (outPath) {
    await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8').catch((error: unknown) => {
      console.error(`[pi-selftest] 写结果文件失败: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  app.exit(report.ok ? 0 : 1);
}
