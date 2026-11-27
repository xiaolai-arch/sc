import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ButlerServiceImpl } from '../../../src/main/butler/butler-service';
import type { ButlerToolContext } from '../../../src/main/butler/tools';
import { FakeModelClient } from '../../../src/main/agent/model-client';
import { createCommitmentService } from '../../../src/main/commitments/service';
import { createWorkspaceService } from '../../../src/main/workspace/create-workspace-service';
import { LegacyEngine } from '../../../src/main/runtime/legacy-engine';
import { FakeEngine } from '../../../src/main/runtime/fake-engine';
import { registerButlerTools } from '../../../src/main/runtime/butler-bridge';
import { RunController } from '../../../src/main/runtime/run-controller';
import { RunJournal } from '../../../src/main/runtime/run-journal';
import { ToolGateway } from '../../../src/main/runtime/tool-gateway';
import type { RunEvent, RunRequest } from '../../../src/main/runtime/contracts';
import type { CommitmentService } from '../../../src/main/commitments/service';
import type { WorkspaceService } from '../../../src/shared/workspace';

/**
 * 场景二「把一条承诺改到周五」（spec P3/P4，验收 15–19、23）：改期唯一入口是
 * 确认级 `reschedule_commitment`（后端 `CommitmentService.resolve({ newDue })`）；
 * 旧 `resolve_commitment` 收敛为纯「结掉」，携带 newDue 的旧式调用在网关 schema
 * 层拒绝（旁路负例=验收 23）。同名承诺先发 approval.requested 附候选（验收 17）；
 * 审批绑定参数（验收 18）；approval.requested ≠ tool.committed（验收 19）。
 */

const NOW = new Date(2026, 10, 27, 8, 0, 0); // 2026-11-27（周五）08:00 local
const now = (): Date => new Date(NOW);
const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };

interface Fixture {
  root: string;
  service: WorkspaceService;
  workspaceId: string;
  commitments: CommitmentService;
  dispose(): Promise<void>;
}

async function makeFixture(seed: Array<{ text: string; due: string }> = []): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'asaki-runtime-reschedule-'));
  const service = createWorkspaceService(root, { seed: false });
  const created = await service.createWorkspace({
    name: '英语',
    kind: 'study',
    goal: '流利读外刊',
    description: ''
  });
  const commitments = createCommitmentService({ root, now });
  for (const entry of seed) {
    await commitments.create({ text: entry.text, due: entry.due, workspaceId: created.id });
  }
  return {
    root,
    service,
    workspaceId: created.id,
    commitments,
    async dispose(): Promise<void> {
      await rm(root, { recursive: true, force: true });
    }
  };
}

function butlerContext(fixture: Fixture): ButlerToolContext {
  return {
    workspace: fixture.service,
    workspaceId: fixture.workspaceId,
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
    userInput: '把背单词改到周五',
    engineId: 'fake',
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
  const journalDir = await mkdtemp(join(tmpdir(), 'asaki-runtime-reschedule-journal-'));
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

test('验收 15：改期成功后承诺详情与通知中心读同一 due（Fake 路径，唯一入口 reschedule_commitment）', async () => {
  const fixture = await makeFixture([{ text: '背单词', due: '2026-11-28' }]);
  try {
    const before = await fixture.commitments.list();
    expect(before).toHaveLength(1);
    const commitmentId = before[0]!.id;
    const engine = new FakeEngine({
      steps: [
        { type: 'tool', name: 'reschedule_commitment', args: { id: commitmentId, newDue: '2026-12-04' } },
        { type: 'receipt', detail: 'reschedule_commitment 成功' }
      ]
    });
    const { controller, dispose } = await makeHarness([engine]);
    try {
      const collector = collect(controller, 'run-1');
      const handle = controller.start(makeRequest({ workspaceIds: [fixture.workspaceId] }), {
        butler: butlerContext(fixture)
      });
      await collector.waitFor((event) => event.type === 'approval.requested');
      expect(await controller.approve('run-1', 'approved')).toBe(true);
      expect(await handle.done).toBe('completed');

      // 详情（list）与通知中心（listSummaries）读同一份落盘 due。
      const after = await fixture.commitments.list();
      expect(after[0]?.due).toBe('2026-12-04');
      expect(after[0]?.status).toBe('open');
      expect(after[0]?.resolvedAt).toBeUndefined();
      const summaries = await fixture.commitments.listSummaries();
      expect(summaries[0]?.due).toBe('2026-12-04');
      expect(summaries[0]?.status).toBe('open');

      // 唯一改期路径：后端 resolve({ newDue })（工具层不得绕开）。
      expect(engine.invocations[0]?.outcome.ok).toBe(true);
      const types = collector.events.map((event) => event.type);
      expect(types).toEqual([
        'run.started',
        'approval.requested', // 确认级：改期必须批准
        'tool.committed',
        'service.receipt',
        'run.finished'
      ]);
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

test('验收 16：无效日期（过去/格式错/空串）服务拒绝、不写盘、运行「失败」，无「已改期」文案', async () => {
  const fixture = await makeFixture([{ text: '背单词', due: '2026-11-28' }]);
  try {
    const engine = new FakeEngine({
      steps: [
        // 过去日期：格式合法但早于今天 → 服务层拒绝（改期下界唯一权威）。
        { type: 'tool', name: 'reschedule_commitment', args: { text: '背单词', newDue: '2020-01-01' } },
        // 格式错（不存在的日子）：工具层拒绝。
        { type: 'tool', name: 'reschedule_commitment', args: { text: '背单词', newDue: '2026-02-30' } },
        // 空串：必填参数缺失。
        { type: 'tool', name: 'reschedule_commitment', args: { text: '背单词', newDue: '' } },
        { type: 'fail', message: 'reschedule_commitment 执行失败' }
      ]
    });
    const { controller, dispose } = await makeHarness([engine]);
    try {
      const collector = collect(controller, 'run-1');
      const handle = controller.start(makeRequest({ workspaceIds: [fixture.workspaceId] }), {
        butler: butlerContext(fixture)
      });
      // 三次尝试各需一次批准（确认级）。
      await collector.waitFor((event) => event.type === 'approval.requested');
      await controller.approve('run-1', 'approved');
      await collector.waitFor(
        (event) =>
          event.type === 'approval.requested' &&
          (event as { params?: Record<string, unknown> }).params?.['newDue'] === '2026-02-30'
      );
      await controller.approve('run-1', 'approved');
      await collector.waitFor(
        (event) =>
          event.type === 'approval.requested' &&
          (event as { params?: Record<string, unknown> }).params?.['newDue'] === ''
      );
      await controller.approve('run-1', 'approved');
      expect(await handle.done).toBe('failed');

      const failures = collector.events.filter(
        (event) => event.type === 'tool.failed'
      ) as Array<{ tool: string; reason: string; error: string }>;
      expect(failures).toHaveLength(3);
      expect(failures[0]?.error).toContain('改期日期不能早于今天');
      expect(failures[1]?.error).toContain('newDue 必须是 YYYY-MM-DD');
      expect(failures[2]?.error).toContain('缺少参数 newDue');
      // 不写盘：due 原样、仍 open、无 committed、无「已改期」。
      const after = await fixture.commitments.list();
      expect(after[0]?.due).toBe('2026-11-28');
      expect(after[0]?.status).toBe('open');
      expect(collector.events.some((event) => event.type === 'tool.committed')).toBe(false);
      for (const event of collector.events) {
        if (event.type === 'text.delta') {
          expect((event as { text: string }).text).not.toContain('已改期');
        }
      }
      expect(collector.events.at(-1)).toMatchObject({ type: 'run.finished', state: 'failed' });
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

test('验收 17：同名承诺 → approval.requested 附候选让用户选；未选择不落盘；选中后只改选中那条', async () => {
  const fixture = await makeFixture([
    { text: '背单词', due: '2026-11-28' },
    { text: '背单词', due: '2026-12-01' }
  ]);
  try {
    const all = await fixture.commitments.list();
    const firstId = all[0]!.id;
    const secondId = all[1]!.id;
    const engine = new FakeEngine({
      steps: [
        { type: 'tool', name: 'reschedule_commitment', args: { text: '背单词', newDue: '2026-12-04' } },
        { type: 'receipt', detail: 'reschedule_commitment 成功' }
      ]
    });
    const { controller, dispose } = await makeHarness([engine]);
    try {
      const collector = collect(controller, 'run-1');
      const handle = controller.start(makeRequest({ workspaceIds: [fixture.workspaceId] }), {
        butler: butlerContext(fixture)
      });
      const approval = await collector.waitFor((event) => event.type === 'approval.requested');
      // 审批卡附两条候选（各自到期日可区分）。
      const candidates = (approval as { candidates?: Array<{ id: string; label: string; detail?: string }> })
        .candidates;
      expect(candidates).toHaveLength(2);
      expect(candidates?.map((candidate) => candidate.id).sort()).toEqual([firstId, secondId].sort());
      expect(candidates?.every((candidate) => candidate.label === '背单词')).toBe(true);

      // 未选择前不落盘：无选择的批准不成立（仍待选），空手/未知 id 都拒。
      expect(await controller.approve('run-1', 'approved')).toBe(false);
      expect(await controller.approve('run-1', 'approved', { selection: 'cm-x' })).toBe(false);
      const soFar = await fixture.commitments.list();
      expect(soFar.every((entry) => entry.due !== '2026-12-04')).toBe(true);
      expect(controller.getRun('run-1')?.state).toBe('waiting-approval');

      // 用户选定第二条 → 只改它；第一条不动。
      expect(await controller.approve('run-1', 'approved', { selection: secondId })).toBe(true);
      expect(await handle.done).toBe('completed');
      const after = await fixture.commitments.list();
      const first = after.find((entry) => entry.id === firstId);
      const second = after.find((entry) => entry.id === secondId);
      expect(first?.due).toBe('2026-11-28');
      expect(second?.due).toBe('2026-12-04');
      // 工具收到的是 pin 了 id 的参数（选择进入执行与审计）。
      expect(engine.invocations[0]?.outcome.ok).toBe(true);
      const approvalParams = (approval as { params?: Record<string, unknown> }).params;
      expect(approvalParams).toEqual({ text: '背单词', newDue: '2026-12-04' });
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

test('验收 18：审批绑定参数——批准 A→周五后再提 A→周六，必须重新确认，不能用旧批准', async () => {
  const fixture = await makeFixture([{ text: '背单词', due: '2026-11-28' }]);
  try {
    const commitmentId = (await fixture.commitments.list())[0]!.id;
    const engine = new FakeEngine({
      steps: [
        { type: 'tool', name: 'reschedule_commitment', args: { text: '背单词', newDue: '2026-11-28' } },
        { type: 'tool', name: 'reschedule_commitment', args: { text: '背单词', newDue: '2026-12-05' } },
        { type: 'receipt', detail: 'reschedule_commitment 成功' }
      ]
    });
    const { controller, dispose } = await makeHarness([engine]);
    try {
      const collector = collect(controller, 'run-1');
      const handle = controller.start(makeRequest({ workspaceIds: [fixture.workspaceId] }), {
        butler: butlerContext(fixture)
      });
      // 第一次改期（→2026-11-28）：批准、提交。
      await collector.waitFor((event) => event.type === 'approval.requested');
      await controller.approve('run-1', 'approved');
      await collector.waitFor(
        (event) => event.type === 'tool.committed' && (event as { tool: string }).tool === 'reschedule_commitment'
      );
      // 第二次改期（→2026-12-05）：没有旧批准可复用——再次 approval.requested，
      // 未批准前不执行（committed 只有第一次那次）。
      const secondApproval = await collector.waitFor(
        (event) =>
          event.type === 'approval.requested' &&
          (event as { params?: Record<string, unknown> }).params?.['newDue'] === '2026-12-05'
      );
      expect(secondApproval).toMatchObject({ type: 'approval.requested', tool: 'reschedule_commitment' });
      const committedCount = collector.events.filter((event) => event.type === 'tool.committed').length;
      expect(committedCount).toBe(1);
      // 拒绝第二次 → 不落盘新日期；第一次的落盘保持。
      await controller.approve('run-1', 'rejected');
      const rejected = await collector.waitFor(
        (event) => event.type === 'tool.failed' && (event as { reason?: string }).reason === 'rejected'
      );
      expect(rejected).toMatchObject({ type: 'tool.failed', reason: 'rejected' });
      const after = await fixture.commitments.list();
      expect(after.find((entry) => entry.id === commitmentId)?.due).toBe('2026-11-28');
      // 第二次拒绝后 FakeEngine 直接回执收尾：无确认级提交在其后 → completed。
      expect(await handle.done).toBe('completed');
      expect(collector.events.at(-1)).toMatchObject({ type: 'run.finished', state: 'completed' });
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

test('验收 19：approval.requested ≠ tool.committed 可区分；只有服务回执后才产生 committed', async () => {
  const fixture = await makeFixture([{ text: '背单词', due: '2026-11-28' }]);
  try {
    const commitmentId = (await fixture.commitments.list())[0]!.id;
    const engine = new FakeEngine({
      steps: [
        { type: 'tool', name: 'reschedule_commitment', args: { id: commitmentId, newDue: '2026-12-04' } },
        { type: 'receipt', detail: 'reschedule_commitment 成功' }
      ]
    });
    const { controller, journal, dispose } = await makeHarness([engine]);
    try {
      const collector = collect(controller, 'run-1');
      const handle = controller.start(makeRequest({ workspaceIds: [fixture.workspaceId] }), {
        butler: butlerContext(fixture)
      });
      const approval = await collector.waitFor((event) => event.type === 'approval.requested');
      // 「准备修改」阶段：approval.requested 已发出，但还没有任何 committed、未落盘。
      expect(approval).toMatchObject({ type: 'approval.requested', tool: 'reschedule_commitment' });
      expect(collector.events.some((event) => event.type === 'tool.committed')).toBe(false);
      expect((await fixture.commitments.list())[0]?.due).toBe('2026-11-28');

      await controller.approve('run-1', 'approved');
      const committed = await collector.waitFor((event) => event.type === 'tool.committed');
      // 「已经修改」：committed 在批准之后才出现，且与 approval 是两条独立事件。
      expect(committed.seq).toBeGreaterThan(approval.seq);
      expect((await fixture.commitments.list())[0]?.due).toBe('2026-12-04');
      expect(await handle.done).toBe('completed');
      const journaled = await journal.readRun('run-1');
      expect(journaled.map((event) => event.type)).toEqual([
        'run.started',
        'approval.requested',
        'tool.committed',
        'service.receipt',
        'run.finished'
      ]);
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

test('验收 23（旁路负例）：resolve_commitment 携带 newDue → 网关 schema 层拒绝，不写盘、不产生 committed；改期只能走确认级新工具', async () => {
  const fixture = await makeFixture([{ text: '背单词', due: '2026-11-28' }]);
  try {
    const engine = new FakeEngine({
      steps: [
        // 旁路尝试：旧工具携带 newDue（schema 已移除该参数）。
        {
          type: 'tool',
          name: 'resolve_commitment',
          args: { text: '背单词', outcome: 'done', newDue: '2026-12-04' }
        },
        // 唯一改期路径：确认级 reschedule_commitment 批准后才落盘。
        { type: 'tool', name: 'reschedule_commitment', args: { text: '背单词', newDue: '2026-12-04' } },
        { type: 'receipt', detail: 'reschedule_commitment 成功' }
      ]
    });
    const { controller, dispose } = await makeHarness([engine]);
    try {
      const collector = collect(controller, 'run-1');
      const handle = controller.start(makeRequest({ workspaceIds: [fixture.workspaceId] }), {
        butler: butlerContext(fixture)
      });
      // 旁路调用被网关拒绝：多余参数即拒（unknown-arg），无审批、无提交。
      await collector.waitFor(
        (event) =>
          event.type === 'tool.failed' &&
          (event as { tool: string }).tool === 'resolve_commitment'
      );
      const bypassFailed = collector.events.find(
        (event) => event.type === 'tool.failed'
      ) as { reason: string; error: string };
      expect(bypassFailed.reason).toBe('unknown-arg');
      expect(bypassFailed.error).toContain('newDue');
      expect(collector.events.some((event) => event.type === 'tool.committed')).toBe(false);
      expect((await fixture.commitments.list())[0]?.due).toBe('2026-11-28');

      // 正路：reschedule_commitment 需要批准；批准后才落盘。
      await collector.waitFor((event) => event.type === 'approval.requested');
      await controller.approve('run-1', 'approved');
      expect(await handle.done).toBe('completed');
      expect((await fixture.commitments.list())[0]?.due).toBe('2026-12-04');
      const committed = collector.events.filter(
        (event) => event.type === 'tool.committed'
      ) as Array<{ tool: string }>;
      expect(committed).toHaveLength(1);
      expect(committed[0]?.tool).toBe('reschedule_commitment');
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

/** Legacy 对照：旧工具收敛后，Legacy 路径的 resolve_commitment 同样拒绝 newDue。 */
test('Legacy 对照：resolve_commitment+newDue 在 Legacy 引擎上是工具失败，运行按失败收尾', async () => {
  const fixture = await makeFixture([{ text: '背单词', due: '2026-11-28' }]);
  try {
    const client = new FakeModelClient([
      {
        text: '',
        usage: ZERO_USAGE,
        toolCalls: [
          { id: 'r1', name: 'resolve_commitment', arguments: { text: '背单词', newDue: '2026-12-04' } }
        ]
      },
      { text: '好的。', usage: ZERO_USAGE }
    ]);
    const butler = new ButlerServiceImpl({
      workspaceService: fixture.service,
      modelClient: client,
      commitmentService: fixture.commitments,
      now,
      maxToolSteps: 4
    });
    // writeTools 默认含 resolve_commitment（BUTLER_TOOL_LEVELS 确认级）→ 失败即运行失败。
    const engine = new LegacyEngine({ butler });
    const { controller, dispose } = await makeHarness([engine]);
    try {
      const collector = collect(controller, 'run-legacy');
      const handle = controller.start(
        makeRequest({ runId: 'run-legacy', engineId: 'legacy', workspaceIds: [fixture.workspaceId] }),
        { butler: butlerContext(fixture) }
      );
      expect(await handle.done).toBe('failed');
      const bypassFailed = collector.events.find((event) => event.type === 'tool.failed') as {
        tool: string;
        error: string;
      };
      expect(bypassFailed.tool).toBe('resolve_commitment');
      expect(bypassFailed.error).toContain('改期请用 reschedule_commitment');
      expect((await fixture.commitments.list())[0]?.due).toBe('2026-11-28');
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});
