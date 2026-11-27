import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommitmentService } from '../../../src/main/commitments/service';
import { createWorkspaceService } from '../../../src/main/workspace/create-workspace-service';
import type { ButlerToolContext } from '../../../src/main/butler/tools';
import { FakeEngine } from '../../../src/main/runtime/fake-engine';
import { registerButlerTools } from '../../../src/main/runtime/butler-bridge';
import { RunController } from '../../../src/main/runtime/run-controller';
import { RunJournal } from '../../../src/main/runtime/run-journal';
import { ToolGateway } from '../../../src/main/runtime/tool-gateway';
import type { RunEvent, RunRequest } from '../../../src/main/runtime/contracts';
import type { ButlerReference } from '../../../src/shared/butler-stream';
import type { CommitmentService } from '../../../src/main/commitments/service';
import type { WorkspaceService } from '../../../src/shared/workspace';

/**
 * 场景三「总结这一周」（spec P4，验收 20–22）：只读跨项目周复盘工具
 * `weekly_review`。验收 20：每条结论附来源记录标识；验收 21：某项目无记录
 * 明说「没有记录」不编补；验收 22：运行全程只读——写入类工具调用被网关拒绝
 * 并记 tool.failed（注入模型尝试写入的负例）。
 */

const NOW = new Date(2026, 10, 27, 8, 0, 0); // 2026-11-27（周五）08:00 local
const now = (): Date => new Date(NOW);
/** 本周周一（2026-11-23）到周日（2026-11-29）。 */
const WEEK_START = '2026-11-23';
const WEEK_END = '2026-11-29';

interface Fixture {
  root: string;
  service: WorkspaceService;
  englishId: string;
  mathId: string;
  commitments: CommitmentService;
  dispose(): Promise<void>;
}

/** 夹具：英语项目有本周记录（任务+笔记+承诺），数学项目零记录（验收 21）。 */
async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'asaki-runtime-weekly-'));
  const service = createWorkspaceService(root, { seed: false });
  const english = await service.createWorkspace({
    name: '英语',
    kind: 'study',
    goal: '流利读外刊',
    description: ''
  });
  const math = await service.createWorkspace({
    name: '数学',
    kind: 'study',
    goal: '刷完真题',
    description: ''
  });
  // 英语：本周三完成一个任务。
  await service.createTask({
    workspaceId: english.id,
    title: '读懂外刊一篇',
    subject: '英语',
    durationMin: 20,
    acceptance: '摘 5 句',
    due: '2026-11-25'
  });
  const tasks = (await service.getWorkspaceSnapshot(english.id)).tasks;
  await service.updateWorkspaceTask({ taskId: tasks[0]!.id, status: 'done' });
  // 英语：本周有笔记。
  await service.createNote({
    workspaceId: english.id,
    title: '本周复盘笔记',
    subject: '英语',
    tags: [],
    summary: '本周读了三篇外刊',
    body: '……',
    related: []
  });
  // 英语：一条本周到期的承诺。
  const commitments = createCommitmentService({ root, now });
  await commitments.create({ text: '背完 100 个单词', due: '2026-11-26', workspaceId: english.id });
  return {
    root,
    service,
    englishId: english.id,
    mathId: math.id,
    commitments,
    async dispose(): Promise<void> {
      await rm(root, { recursive: true, force: true });
    }
  };
}

function butlerContext(fixture: Fixture): ButlerToolContext {
  return {
    workspace: fixture.service,
    workspaceId: fixture.englishId,
    commitments: fixture.commitments,
    now
  };
}

function makeRequest(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    runId: 'run-weekly',
    sessionId: 'conv-weekly',
    origin: 'chat',
    workspaceIds: ['ws'],
    userInput: '帮我总结这一周',
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

async function makeHarness(engines: FakeEngine[]): Promise<Harness> {
  const journalDir = await mkdtemp(join(tmpdir(), 'asaki-runtime-weekly-journal-'));
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

interface WeeklyFactView {
  source: { recordId: string; kind: string; path?: string };
  summary: string;
}

interface WeeklyWorkspaceView {
  workspaceId: string;
  name: string;
  hasRecords: boolean;
  noRecordNotice?: string;
  facts: WeeklyFactView[];
}

interface WeeklyReviewResult {
  weekStart: string;
  weekEnd: string;
  workspaces: WeeklyWorkspaceView[];
  references: ButlerReference[];
}

const engineResult = (engine: FakeEngine): WeeklyReviewResult =>
  engine.invocations.find((record) => record.name === 'weekly_review')?.outcome.result as WeeklyReviewResult;

test('验收 20：周复盘每条结论附来源记录标识（recordId / kind / path），references 事件同一份来源', async () => {
  const fixture = await makeFixture();
  try {
    const engine = new FakeEngine({
      steps: [
        { type: 'tool', name: 'weekly_review', args: { weekStart: WEEK_START } },
        { type: 'receipt', detail: 'weekly_review 成功' }
      ]
    });
    const { controller, dispose } = await makeHarness([engine]);
    try {
      const collector = collect(controller, 'run-weekly');
      const handle = controller.start(makeRequest({ workspaceIds: [fixture.englishId] }), {
        butler: butlerContext(fixture)
      });
      expect(await handle.done).toBe('completed');
      const result = engineResult(engine);
      expect(result.weekStart).toBe(WEEK_START);
      expect(result.weekEnd).toBe(WEEK_END);

      const english = result.workspaces.find((section) => section.workspaceId === fixture.englishId);
      expect(english?.hasRecords).toBe(true);
      // 每条事实都带来源记录标识；任务是本周完成的、笔记本周更新、承诺本周到期。
      expect(english?.facts.length).toBeGreaterThanOrEqual(3);
      for (const fact of english!.facts) {
        expect(typeof fact.source.recordId).toBe('string');
        expect(fact.source.recordId.length).toBeGreaterThan(0);
        expect(['task', 'note', 'memory', 'commitment']).toContain(fact.source.kind);
        expect(fact.summary.length).toBeGreaterThan(0);
      }
      const kinds = new Set(english!.facts.map((fact) => fact.source.kind));
      expect(kinds).toEqual(new Set(['task', 'note', 'commitment']));
      // 任务/笔记/承诺的来源 id 都是真实记录 id（能在 vault 里找到）。
      const snapshot = await fixture.service.getWorkspaceSnapshot(fixture.englishId);
      const taskIds = new Set(snapshot.tasks.map((task) => task.id));
      const noteIds = new Set(snapshot.notes.map((note) => note.id));
      const commitmentIds = new Set((await fixture.commitments.list()).map((entry) => entry.id));
      for (const fact of english!.facts) {
        if (fact.source.kind === 'task') expect(taskIds.has(fact.source.recordId)).toBe(true);
        if (fact.source.kind === 'note') expect(noteIds.has(fact.source.recordId)).toBe(true);
        if (fact.source.kind === 'commitment') expect(commitmentIds.has(fact.source.recordId)).toBe(true);
      }

      // 缝④：网关把同一份来源发成 references 事件（UI 可逐条打开原记录）。
      const references = collector.events.find((event) => event.type === 'references') as
        | { type: 'references'; items: ButlerReference[] }
        | undefined;
      expect(references).toBeDefined();
      const expectedIds = english!.facts.map((fact) => fact.source.recordId).sort();
      expect(references!.items.map((item) => item.id).sort()).toEqual(expectedIds);
      expect(references!.items.every((item) => item.kind !== undefined && item.title.length > 0)).toBe(true);

      // 工具是查询级：无审批、无确认级提交；有回执（FakeEngine 显式发）。
      expect(collector.events.some((event) => event.type === 'approval.requested')).toBe(false);
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

test('验收 21：某项目本周无记录 → 明说「没有记录」，不编补任何事实', async () => {
  const fixture = await makeFixture();
  try {
    const engine = new FakeEngine({
      steps: [
        { type: 'tool', name: 'weekly_review', args: { weekStart: WEEK_START } },
        { type: 'receipt', detail: 'weekly_review 成功' }
      ]
    });
    const { controller, dispose } = await makeHarness([engine]);
    try {
      const collector = collect(controller, 'run-weekly');
      const handle = controller.start(makeRequest({ workspaceIds: [fixture.englishId] }), {
        butler: butlerContext(fixture)
      });
      expect(await handle.done).toBe('completed');
      const result = engineResult(engine);
      const math = result.workspaces.find((section) => section.workspaceId === fixture.mathId);
      expect(math).toBeDefined();
      expect(math?.hasRecords).toBe(false);
      expect(math?.facts).toEqual([]);
      expect(math?.noRecordNotice).toContain('没有记录');
      expect(math?.noRecordNotice).toContain('数学');
      // 数学项目没有任何 references（不编补）。
      expect(result.references.some((item) => item.workspaceId === fixture.mathId)).toBe(false);
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

test('验收 22：场景三全程只读——注入模型尝试写入 → 网关拒绝、记 tool.failed，不写盘', async () => {
  const fixture = await makeFixture();
  try {
    const snapshotBefore = await fixture.service.getWorkspaceSnapshot(fixture.englishId);
    const commitmentsBefore = await fixture.commitments.list();
    const engine = new FakeEngine({
      steps: [
        { type: 'tool', name: 'weekly_review', args: { weekStart: WEEK_START } },
        // 注入的负例：模型试图写入（确认级工具）。
        {
          type: 'tool',
          name: 'create_task',
          args: {
            workspaceId: fixture.englishId,
            title: '编造的任务',
            subject: '英语',
            durationMin: 10,
            acceptance: '无'
          }
        },
        {
          type: 'tool',
          name: 'reschedule_commitment',
          args: { text: '背完 100 个单词', newDue: '2026-12-04' }
        },
        { type: 'receipt', detail: 'weekly_review 成功' }
      ]
    });
    const { controller, dispose } = await makeHarness([engine]);
    try {
      const collector = collect(controller, 'run-weekly');
      const handle = controller.start(
        // readOnly：场景三运行契约的一部分（RunRequest.readOnly，验收 22）。
        makeRequest({ workspaceIds: [fixture.englishId], readOnly: true }),
        { butler: butlerContext(fixture) }
      );
      expect(await handle.done).toBe('completed');

      // 只读工具成功。
      expect(engine.invocations[0]?.outcome.ok).toBe(true);
      // 两次写入都被网关拒绝：reason=permission，且记 tool.failed（模型可见回执）。
      const writeOutcomes = engine.invocations.slice(1);
      expect(writeOutcomes).toHaveLength(2);
      for (const invocation of writeOutcomes) {
        expect(invocation.outcome.ok).toBe(false);
        expect(invocation.outcome.reason).toBe('permission');
        expect(invocation.outcome.error).toContain('只读');
      }
      const failed = collector.events.filter(
        (event) => event.type === 'tool.failed'
      ) as Array<{ tool: string; reason: string }>;
      expect(failed.map((event) => event.tool)).toEqual(['create_task', 'reschedule_commitment']);
      expect(failed.every((event) => event.reason === 'permission')).toBe(true);
      // 不写盘：任务数、承诺 due 原样。
      const snapshotAfter = await fixture.service.getWorkspaceSnapshot(fixture.englishId);
      expect(snapshotAfter.tasks).toEqual(snapshotBefore.tasks);
      expect(await fixture.commitments.list()).toEqual(commitmentsBefore);
      // 无确认级提交（没有任何写入被提交）。
      expect(collector.events.some((event) => event.type === 'tool.committed')).toBe(true); // weekly_review（查询级）
      const committedTools = collector.events
        .filter((event) => event.type === 'tool.committed')
        .map((event) => (event as { tool: string }).tool);
      expect(committedTools).toEqual(['weekly_review']);
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

test('周复盘：跨项目——无归属项目的承诺也出现在结果里（不丢事实）', async () => {
  const fixture = await makeFixture();
  try {
    await fixture.commitments.create({ text: '给朋友回信', due: '2026-11-27' });
    const engine = new FakeEngine({
      steps: [{ type: 'tool', name: 'weekly_review', args: { weekStart: WEEK_START } }]
    });
    const { controller, dispose } = await makeHarness([engine]);
    try {
      const collector = collect(controller, 'run-weekly');
      const handle = controller.start(makeRequest({ workspaceIds: [fixture.englishId] }), {
        butler: butlerContext(fixture)
      });
      expect(await handle.done).toBe('completed');
      const result = engineResult(engine);
      const unassigned = (result as { unassignedCommitments?: { hasRecords: boolean; facts: WeeklyFactView[] } })
        .unassignedCommitments;
      expect(unassigned?.hasRecords).toBe(true);
      expect(unassigned?.facts).toHaveLength(1);
      expect(unassigned?.facts[0]?.source.kind).toBe('commitment');
      expect(unassigned?.facts[0]?.summary).toContain('给朋友回信');
      expect(result.references.some((item) => item.title === '给朋友回信')).toBe(true);
    } finally {
      await dispose();
    }
  } finally {
    await fixture.dispose();
  }
});
