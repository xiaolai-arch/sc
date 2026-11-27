import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createButlerTools } from '../../../src/main/butler/tools';
import { assembleRuntime } from '../../../src/main/runtime/assembly';
import { assertButlerConfirmTools } from '../../../src/main/runtime/butler-bridge';
import { FakeEngine } from '../../../src/main/runtime/fake-engine';
import { RunJournal } from '../../../src/main/runtime/run-journal';
import { ToolGateway } from '../../../src/main/runtime/tool-gateway';
import type { RunEvent } from '../../../src/main/runtime/contracts';

const NOW = new Date(2026, 10, 27, 8, 0, 0); // 2026-11-27 08:00 local
const now = (): Date => new Date(NOW);

/**
 * 装配断言（P3 装配收口批）：assembleRuntime 是 runtime 装配唯一入口——
 * 显式 registerButlerTools + 确认级 fail-fast 断言。负例用 butlerBridge.tools
 * 注入裁剪表（生产装配不传该参数）。
 */

async function makeJournal(): Promise<{ journal: RunJournal; dispose(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-runtime-assembly-'));
  const journal = new RunJournal({ dirPath: join(dir, 'runtime-runs'), now });
  return {
    journal,
    async dispose(): Promise<void> {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

test('装配成功：assembleRuntime 显式注册管家工具，确认级断言通过，控制器可用', async () => {
  const { journal, dispose } = await makeJournal();
  try {
    const { gateway, controller } = assembleRuntime({
      journal,
      engines: { fake: new FakeEngine({ steps: [] }) }
    });
    // 管家工具与计划拆分工具全部注册。
    expect(gateway.has('update_task')).toBe(true);
    expect(gateway.has('create_task')).toBe(true);
    expect(gateway.has('plan_preview')).toBe(true);
    expect(gateway.has('commit_plan')).toBe(true);
    expect(gateway.entry('commit_plan')?.level).toBe('confirm');
    // 启动断言复跑同样通过（一致性可重复验证）。
    expect(() => assertButlerConfirmTools(gateway)).not.toThrow();
    void controller;

    // 装配出的控制器端到端可用：一次带 text.delta 的运行正常收尾。
    const engine = new FakeEngine({
      steps: [{ type: 'emit', event: { type: 'text.delta', text: '装配自检。' } }]
    });
    const { gateway: gateway2, controller: controller2 } = assembleRuntime({
      journal,
      engines: { fake: engine }
    });
    const events: RunEvent[] = [];
    controller2.subscribe('run-assembly', (event) => events.push(event));
    const handle = controller2.start({
      runId: 'run-assembly',
      sessionId: 'conv-assembly',
      origin: 'chat',
      workspaceIds: ['ws'],
      userInput: '装配自检',
      engineId: 'fake',
      now
    });
    expect(await handle.done).toBe('completed');
    expect(events.map((event) => event.type)).toEqual(['run.started', 'text.delta', 'run.finished']);
    expect(gateway2.has('update_task')).toBe(true);
  } finally {
    await dispose();
  }
});

test('启动 fail-fast：漏注册一个确认级工具 → assembleRuntime 抛错，不静默降级', async () => {
  const { journal, dispose } = await makeJournal();
  try {
    // 故意从工具表里去掉 update_task（确认级）——模拟「装配漏注册」。
    const trimmed = createButlerTools().filter((tool) => tool.name !== 'update_task');
    expect(() =>
      assembleRuntime({
        journal,
        engines: {},
        butlerBridge: { tools: trimmed }
      })
    ).toThrow(/装配断言失败[\s\S]*update_task 未注册/);
  } finally {
    await dispose();
  }
});

test('启动 fail-fast：确认级工具已注册但标级漂移 → 断言抛错', () => {
  const gateway = new ToolGateway();
  gateway.register({
    name: 'update_task',
    level: 'query', // 标级漂移：确认级被标成查询级（审批会被旁路）
    description: '',
    parameters: {},
    execute: async () => ({})
  });
  expect(() => assertButlerConfirmTools(gateway)).toThrow(
    /装配断言失败[\s\S]*update_task 标级为 query/
  );
});

test('启动 fail-fast：注册表出现标级表之外的确认级工具 → 断言抛错', () => {
  const gateway = new ToolGateway();
  gateway.register({
    name: 'mystery_write',
    level: 'confirm',
    description: '',
    parameters: {},
    execute: async () => ({})
  });
  expect(() => assertButlerConfirmTools(gateway)).toThrow(
    /装配断言失败[\s\S]*mystery_write 是注册表里的确认级工具但不在标级表/
  );
});
