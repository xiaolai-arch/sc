import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeEngine, type FakeStep } from '../../../src/main/runtime/fake-engine';
import { RunController } from '../../../src/main/runtime/run-controller';
import { RunJournal } from '../../../src/main/runtime/run-journal';
import { ToolGateway, type GatewayToolEntry } from '../../../src/main/runtime/tool-gateway';
import { RUN_INTERRUPTED_MESSAGE } from '../../../src/main/butler/conversation-runs';
import type { ButlerToolContext } from '../../../src/main/butler/tools';
import type { RunEvent, RunRequest } from '../../../src/main/runtime/contracts';

const NOW = new Date(2026, 10, 27, 8, 0, 0); // 2026-11-27 08:00 local
const now = (): Date => new Date(NOW);

function butlerStub(): ButlerToolContext {
  return { workspace: {} as ButlerToolContext['workspace'], now };
}

function makeRequest(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    origin: 'chat',
    workspaceIds: ['ws-1'],
    userInput: '用户的话（完整提示词，绝不落盘）',
    engineId: 'fake',
    now,
    ...overrides
  };
}

/** A counting fake tool registered straight into the gateway. */
function spyEntry(
  name: string,
  options: {
    level?: GatewayToolEntry['level'];
    calls?: unknown[];
    gate?: Promise<void>;
    failWith?: Error;
  } = {}
): GatewayToolEntry {
  const calls = options.calls ?? [];
  return {
    name,
    level: options.level ?? 'confirm',
    description: `测试工具 ${name}`,
    parameters: { type: 'object', properties: {} },
    async execute(input) {
      calls.push(input);
      if (options.failWith) throw options.failWith;
      if (options.gate) await options.gate;
      return { echo: input, name };
    }
  };
}

interface Harness {
  controller: RunController;
  gateway: ToolGateway;
  journal: RunJournal;
  dir: string;
  dispose(): Promise<void>;
}

async function makeHarness(engines: FakeEngine[]): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-runtime-contracts-'));
  const journal = new RunJournal({ dirPath: dir, now });
  const gateway = new ToolGateway();
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

test('验收 2：FakeEngine 回放的事件序号单次运行内严格递增且连续，订阅流与 Journal 一致', async () => {
  const engine = new FakeEngine({
    steps: [
      { type: 'emit', event: { type: 'text.delta', text: '你好' } },
      { type: 'emit', event: { type: 'text.delta', text: '，我来安排' } },
      { type: 'receipt', detail: 'read ok' }
    ] satisfies FakeStep[]
  });
  const { controller, gateway, journal, dispose } = await makeHarness([engine]);
  try {
    gateway.register(spyEntry('get_memory', { level: 'query' }));
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest({ runId: 'run-1' }), { butler: butlerStub() });
    const state = await handle.done;
    expect(state).toBe('completed');

    const expectedTypes = [
      'run.started',
      'text.delta',
      'text.delta',
      'service.receipt',
      'run.finished'
    ];
    expect(collector.events.map((event) => event.type)).toEqual(expectedTypes);
    const seqs = collector.events.map((event) => event.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
    for (let index = 1; index < seqs.length; index += 1) {
      expect(seqs[index]).toBe(seqs[index - 1] + 1); // 严格递增且连续
    }
    expect(collector.events.every((event) => event.runId === 'run-1')).toBe(true);

    const journaled = await journal.readRun('run-1');
    expect(journaled).toEqual(collector.events);
    expect(collector.events[4]).toMatchObject({ type: 'run.finished', state: 'completed' });
  } finally {
    await dispose();
  }
});

test('验收 2（带工具与审批的完整回放）：序号连续覆盖 approval/committed/finished', async () => {
  const engine = new FakeEngine({
    steps: [
      { type: 'tool', name: 'write_note', args: { title: 't', body: 'b' } },
      { type: 'receipt' }
    ] satisfies FakeStep[]
  });
  const { controller, gateway, dispose } = await makeHarness([engine]);
  try {
    const calls: unknown[] = [];
    gateway.register(spyEntry('write_note', { calls }));
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest({ runId: 'run-1' }), { butler: butlerStub() });
    await collector.waitFor((event) => event.type === 'approval.requested');
    expect(controller.getRun('run-1')?.state).toBe('waiting-approval');
    await controller.approve('run-1', 'approved');
    const state = await handle.done;
    expect(state).toBe('completed');
    const types = collector.events.map((event) => event.type);
    expect(types).toEqual([
      'run.started',
      'approval.requested',
      'tool.committed',
      'service.receipt',
      'run.finished'
    ]);
    const seqs = collector.events.map((event) => event.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
    expect(calls).toEqual([{ title: 't', body: 'b' }]);
  } finally {
    await dispose();
  }
});

test('验收 3：cancel 后运行进「取消」态，不再执行任何后续工具（工具+取消竞态负例）', async () => {
  let releaseWrite!: () => void;
  const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const engine = new FakeEngine({
    steps: [
      { type: 'tool', name: 'slow_note', args: { title: 'a' } },
      { type: 'tool', name: 'slow_note', args: { title: 'b' } }
    ] satisfies FakeStep[]
  });
  const { controller, gateway, journal, dispose } = await makeHarness([engine]);
  try {
    const calls: unknown[] = [];
    gateway.register(spyEntry('slow_note', { calls, gate: writeGate }));
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest({ runId: 'run-1' }), { butler: butlerStub() });
    await collector.waitFor((event) => event.type === 'approval.requested');
    await controller.approve('run-1', 'approved');
    // 工具正在执行（停在 writeGate 上）时取消 —— 竞态注入点。
    expect(await controller.cancel('run-1')).toBe(true);
    releaseWrite();
    const state = await handle.done;
    expect(state).toBe('cancelled');

    const snapshot = controller.getRun('run-1');
    expect(snapshot?.state).toBe('cancelled');
    // 没有任何 tool.committed；只有 run.started / approval.requested / run.finished。
    expect(collector.events.map((event) => event.type)).toEqual([
      'run.started',
      'approval.requested',
      'run.finished'
    ]);
    expect(collector.events[2]).toMatchObject({ type: 'run.finished', state: 'cancelled' });
    // 竞态中的第一个工具已执行但不得提交；第二个工具完全未执行。
    expect(calls).toEqual([{ title: 'a' }]);
    expect(engine.invocations[0]?.outcome).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(engine.invocations[1]?.outcome).toMatchObject({ ok: false, reason: 'cancelled' });
    const journaled = await journal.readRun('run-1');
    expect(journaled.some((event) => event.type === 'tool.committed')).toBe(false);
  } finally {
    await dispose();
  }
});

test('cancel 语义：未知/已结束运行返回 false，二次 cancel 无副作用', async () => {
  const engine = new FakeEngine({ steps: [] satisfies FakeStep[] });
  const { controller, dispose } = await makeHarness([engine]);
  try {
    expect(await controller.cancel('nope')).toBe(false);
    const handle = controller.start(makeRequest({ runId: 'run-1' }), { butler: butlerStub() });
    await handle.done;
    expect(await controller.cancel('run-1')).toBe(false);
    expect(controller.getRun('run-1')?.state).toBe('completed');
  } finally {
    await dispose();
  }
});

test('引擎抛错 → 运行「失败」，run.finished 与 getRun 携带错误', async () => {
  const engine = new FakeEngine({
    steps: [{ type: 'fail', message: 'boom' }] satisfies FakeStep[]
  });
  const { controller, journal, dispose } = await makeHarness([engine]);
  try {
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest({ runId: 'run-1' }), { butler: butlerStub() });
    expect(await handle.done).toBe('failed');
    expect(controller.getRun('run-1')).toMatchObject({ state: 'failed', error: 'boom' });
    const finished = collector.events.find((event) => event.type === 'run.finished');
    expect(finished).toMatchObject({ type: 'run.finished', state: 'failed', error: 'boom' });
    expect((await journal.readRun('run-1')).at(-1)).toMatchObject({
      type: 'run.finished',
      state: 'failed'
    });
  } finally {
    await dispose();
  }
});

test('六态「结果待核实」：写入已提交但无后续服务回执 → 不算完成', async () => {
  const engine = new FakeEngine({
    steps: [{ type: 'tool', name: 'write_note', args: { title: 't' } }] satisfies FakeStep[]
  });
  const { controller, gateway, dispose } = await makeHarness([engine]);
  try {
    gateway.register(spyEntry('write_note', {}));
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest({ runId: 'run-1' }), { butler: butlerStub() });
    await collector.waitFor((event) => event.type === 'approval.requested');
    await controller.approve('run-1', 'approved');
    expect(await handle.done).toBe('pending-verification');
    expect(controller.getRun('run-1')?.state).toBe('pending-verification');
  } finally {
    await dispose();
  }
});

test('六态「完成」：最后一次提交之后收到服务回执 → 完成', async () => {
  const engine = new FakeEngine({
    steps: [
      { type: 'tool', name: 'write_note', args: { title: 't' } },
      { type: 'receipt', detail: 'createTask ok' }
    ] satisfies FakeStep[]
  });
  const { controller, gateway, dispose } = await makeHarness([engine]);
  try {
    gateway.register(spyEntry('write_note', {}));
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest({ runId: 'run-1' }), { butler: butlerStub() });
    await collector.waitFor((event) => event.type === 'approval.requested');
    await controller.approve('run-1', 'approved');
    expect(await handle.done).toBe('completed');
  } finally {
    await dispose();
  }
});

test('审批流：等待确认 → 批准执行；拒绝 → tool.failed 但运行继续', async () => {
  const engine = new FakeEngine({
    steps: [
      { type: 'tool', name: 'write_note', args: { title: 'a' } },
      { type: 'tool', name: 'get_memory' },
      { type: 'receipt' }
    ] satisfies FakeStep[]
  });
  const { controller, gateway, dispose } = await makeHarness([engine]);
  try {
    gateway.register(spyEntry('write_note', {}));
    gateway.register(spyEntry('get_memory', { level: 'query' }));
    const collector = collect(controller, 'run-1');
    const handle = controller.start(makeRequest({ runId: 'run-1' }), { butler: butlerStub() });
    await collector.waitFor((event) => event.type === 'approval.requested');
    expect(await controller.approve('run-1', 'rejected')).toBe(true);
    const rejected = await collector.waitFor(
      (event) => event.type === 'tool.failed' && event.reason === 'rejected'
    );
    expect(rejected).toMatchObject({
      type: 'tool.failed',
      tool: 'write_note',
      reason: 'rejected'
    });
    expect(await handle.done).toBe('completed'); // 拒绝后引擎继续，查询工具照常执行
    expect(collector.events.some((event) => event.type === 'tool.committed')).toBe(true);
    expect(engine.invocations[1]?.outcome).toMatchObject({ ok: true });
  } finally {
    await dispose();
  }
});

test('断线补读：subscribe(fromSeq) 按 Journal 重放，随后接续实时事件，不重不漏', async () => {
  const engine = new FakeEngine({
    steps: [
      { type: 'emit', event: { type: 'text.delta', text: 'a' } },
      { type: 'emit', event: { type: 'text.delta', text: 'b' } },
      { type: 'gate', name: 'mid' },
      { type: 'emit', event: { type: 'text.delta', text: 'c' } }
    ] satisfies FakeStep[]
  });
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const first = collect(controller, 'run-1');
    const handle = controller.start(makeRequest({ runId: 'run-1' }), { butler: butlerStub() });
    // 引擎走到 gate 前，run.started + 两条文本增量已落盘。
    await first.waitFor((event) => event.type === 'text.delta' && event.seq === 3);

    const late: RunEvent[] = [];
    controller.subscribe('run-1', (event) => late.push(event), { fromSeq: 2 });
    engine.openGate('mid');
    await handle.done;

    expect(late.map((event) => event.seq)).toEqual([2, 3, 4, 5]);
    expect(first.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
  } finally {
    await dispose();
  }
});

test('崩溃恢复：无 run.finished 的活跃运行被显式标记中断（沿用 ConversationRunStore 语义）', async () => {
  const engine = new FakeEngine({
    steps: [
      { type: 'emit', event: { type: 'text.delta', text: 'x' } },
      { type: 'gate', name: 'never' }
    ] satisfies FakeStep[]
  });
  const { controller, journal, dispose, dir } = await makeHarness([engine]);
  try {
    const first = collect(controller, 'run-crash');
    const crashed = controller.start(makeRequest({ runId: 'run-crash' }), {
      butler: butlerStub()
    });
    await first.waitFor((event) => event.type === 'text.delta');

    const nextJournal = new RunJournal({ dirPath: dir, now });
    const recovered = await nextJournal.recover();
    expect(recovered).toEqual(['run-crash']);
    const events = await nextJournal.readRun('run-crash');
    expect(events.at(-1)).toMatchObject({
      type: 'run.interrupted',
      message: RUN_INTERRUPTED_MESSAGE
    });

    // 收尾：取消遗留的活跃运行（其 run.finished 落在中断标记之后）。
    expect(await controller.cancel('run-crash')).toBe(true);
    await crashed.done;
    const afterCancel = await journal.readRun('run-crash');
    expect(afterCancel.map((event) => event.type).slice(-2)).toEqual([
      'run.interrupted',
      'run.finished'
    ]);
  } finally {
    await dispose();
  }
});

test('start 校验：未知引擎 / 重复活跃 runId / 非法 origin / 缺统一时钟 → 抛错', async () => {
  const engine = new FakeEngine({
    steps: [{ type: 'gate', name: 'hold' }] satisfies FakeStep[]
  });
  const { controller, dispose } = await makeHarness([engine]);
  try {
    expect(() =>
      controller.start(makeRequest({ runId: 'a', engineId: 'legacy' }), { butler: butlerStub() })
    ).toThrow('未知引擎');
    controller.start(makeRequest({ runId: 'dup' }), { butler: butlerStub() });
    expect(() => controller.start(makeRequest({ runId: 'dup' }))).toThrow('runId 已存在');
    expect(() =>
      controller.start(makeRequest({ runId: 'b', origin: 'cron' as RunRequest['origin'] }))
    ).toThrow('origin');
    expect(() =>
      controller.start(
        makeRequest({ runId: 'c', now: undefined as unknown as RunRequest['now'] })
      )
    ).toThrow('now');
    expect(await controller.cancel('dup')).toBe(true);
  } finally {
    await dispose();
  }
});

test('RunRequest 取消信号：外部 abort 等价于 cancel', async () => {
  const engine = new FakeEngine({
    steps: [{ type: 'gate', name: 'hold' }] satisfies FakeStep[]
  });
  const { controller, dispose } = await makeHarness([engine]);
  try {
    const external = new AbortController();
    const handle = controller.start(makeRequest({ runId: 'run-1', signal: external.signal }), {
      butler: butlerStub()
    });
    external.abort();
    expect(await handle.done).toBe('cancelled');
    expect(controller.getRun('run-1')?.state).toBe('cancelled');
  } finally {
    await dispose();
  }
});

test('预算：maxToolCalls 用尽后网关拒绝后续调用（reason=budget）', async () => {
  const engine = new FakeEngine({
    steps: [
      { type: 'tool', name: 'get_memory' },
      { type: 'tool', name: 'get_memory' }
    ] satisfies FakeStep[]
  });
  const { controller, gateway, dispose } = await makeHarness([engine]);
  try {
    gateway.register(spyEntry('get_memory', { level: 'query' }));
    const handle = controller.start(makeRequest({ runId: 'run-1', budget: { maxToolCalls: 1 } }), {
      butler: butlerStub()
    });
    expect(await handle.done).toBe('completed');
    expect(engine.invocations[0]?.outcome).toMatchObject({ ok: true });
    expect(engine.invocations[1]?.outcome).toMatchObject({ ok: false, reason: 'budget' });
  } finally {
    await dispose();
  }
});

test('RunJournal.append 拒绝序号倒退（防控制器缺陷静默损坏日志）', async () => {
  const { journal, dispose } = await makeHarness([]);
  try {
    const base: RunEvent = {
      runId: 'run-1',
      seq: 1,
      at: now().toISOString(),
      type: 'run.started',
      origin: 'chat',
      engineId: 'fake',
      workspaceIds: []
    };
    await journal.append('run-1', base);
    await expect(journal.append('run-1', { ...base, seq: 1 })).rejects.toThrow('序号倒退');
  } finally {
    await dispose();
  }
});

test('e531（P4 批）：journal.append 失败仍扇出订阅者，错误显式暴露在 getRun().journalError', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-runtime-journalfail-'));
  try {
    const journal = new RunJournal({ dirPath: dir, now });
    // 让第二条 append（text.delta）失败：run.started 正常落盘，用于对照。
    let calls = 0;
    const failingAppend = async (runId: string, event: RunEvent): Promise<void> => {
      calls += 1;
      if (calls === 2) throw new Error('磁盘满（注入）');
      await journal.append(runId, event);
    };
    const flakyJournal: RunJournal = Object.create(journal) as RunJournal;
    flakyJournal.append = failingAppend;
    const engine = new FakeEngine({
      steps: [
        { type: 'emit', event: { type: 'text.delta', text: '第一条。' } },
        { type: 'receipt', detail: '完成' }
      ]
    });
    const gateway = new ToolGateway();
    const controller = new RunController({ engines: [engine], gateway, journal: flakyJournal });
    const seen: RunEvent[] = [];
    controller.subscribe('run-1', (event) => seen.push(event));
    const handle = controller.start(makeRequest());
    expect(await handle.done).toBe('completed');
    // 落盘失败的那条（text.delta）仍扇出给订阅者（扇出不因落盘失败被吞）。
    expect(seen.map((event) => event.type)).toContain('text.delta');
    expect(seen.at(-1)?.type).toBe('run.finished');
    // 错误不吞：快照携带失败文案；其余事件照常落盘（缺的正是失败那条）。
    const snapshot = controller.getRun('run-1');
    expect(snapshot?.journalError).toBe('磁盘满（注入）');
    const journaled = await journal.readRun('run-1');
    expect(journaled.map((event) => event.type)).toEqual([
      'run.started',
      'service.receipt',
      'run.finished'
    ]);
    // seq 缺口即落盘失败那条（补读按 seq 对齐）。
    expect(journaled.map((event) => event.seq)).toEqual([1, 3, 4]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('F3 双时钟绑定：butler.now 与 request.now 不同日 → start 抛错，不产生运行', async () => {
  const { controller, dispose } = await makeHarness([new FakeEngine({ steps: [] })]);
  try {
    const otherDay = (): Date => new Date(2026, 10, 26, 23, 59, 0); // 前一天
    expect(() =>
      controller.start(makeRequest(), { butler: { workspace: {} as ButlerToolContext['workspace'], now: otherDay } })
    ).toThrow(/双时钟不一致/);
    // 同日不同毫秒（合法）：照常启动。
    const sameDay = (): Date => new Date(2026, 10, 27, 9, 30, 0);
    const handle = controller.start(makeRequest({ runId: 'run-ok' }), {
      butler: { workspace: {} as ButlerToolContext['workspace'], now: sameDay }
    });
    expect(await handle.done).toBe('completed');
  } finally {
    await dispose();
  }
});
