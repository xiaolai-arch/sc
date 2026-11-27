import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerButlerTools } from '../../../src/main/runtime/butler-bridge';
import type { EngineAssembly } from '../../../src/main/runtime/engine-selection';
import { assembleEngines, hasEngine } from '../../../src/main/runtime/engine-selection';
import { LegacyEngine } from '../../../src/main/runtime/legacy-engine';
import { RunController } from '../../../src/main/runtime/run-controller';
import { RunJournal } from '../../../src/main/runtime/run-journal';
import { ToolGateway } from '../../../src/main/runtime/tool-gateway';
import type { ButlerService } from '../../../src/shared/workspace';

const NOW = new Date(2026, 10, 27, 8, 0, 0); // 2026-11-27 08:00 local
const now = (): Date => new Date(NOW);

/**
 * 默认引擎禁令（item 61 硬约束，P3 装配批守卫）：
 * - 把「默认引擎」槽位塞进装配对象的尝试，字面量路径在类型层不可能（TS 多余
 *   属性检查），变量/as/展开路径由 assembleEngines 运行时抛错；
 * - 只注册 Legacy 时 selection 只产出引擎集合——没有 engineId 就没有运行，
 *   不存在静默选中 Legacy 的代码路径（Legacy 必须显式 engineId 才可达）。
 */

test('装配守卫：塞入未知字段（试图设默认引擎）→ assembleEngines 运行时抛错', () => {
  const fake = { id: 'fake', run: async () => undefined };
  // 类型层：字面量多余属性检查直接拒绝（下一行的 cast 模拟变量/as 逃逸路径）。
  const sneaky = { fake, legacy: null, pi: null, default: fake } as unknown as EngineAssembly;
  expect(() => assembleEngines(sneaky)).toThrow(/default[\s\S]*默认引擎槽位[\s\S]*Legacy 不得设为默认/);
});

test('Legacy 永不默认：只注册 Legacy → 集合可建，但无默认可选，显式 engineId 才可达', async () => {
  const stubButler = {
    stream: async (): Promise<{ text: string }> => ({ text: '' })
  } as unknown as ButlerService;
  const legacy = new LegacyEngine({ butler: stubButler });

  // 集合语义：legacy-only 装配成功，且没有任何「默认」出口。
  const engines = assembleEngines({ legacy });
  expect(engines).toHaveLength(1);
  expect(hasEngine(engines, 'legacy')).toBe(true);

  const dir = await mkdtemp(join(tmpdir(), 'asaki-runtime-selection-'));
  try {
    const journal = new RunJournal({ dirPath: join(dir, 'runtime-runs'), now });
    const gateway = new ToolGateway();
    registerButlerTools(gateway);
    const controller = new RunController({ engines, gateway, journal });

    // 无 engineId → 抛错（不替调用者挑引擎，哪怕集合里只有 Legacy）。
    expect(() =>
      controller.start({
        runId: 'run-no-id',
        sessionId: 'conv-1',
        origin: 'chat',
        workspaceIds: ['ws'],
        userInput: 'x',
        engineId: '',
        now
      })
    ).toThrow(/engineId 必须是非空字符串/);

    // 显式要别的引擎 → 未知引擎（集合里没有，不做 Legacy 回退）。
    expect(() =>
      controller.start({
        runId: 'run-other',
        sessionId: 'conv-1',
        origin: 'chat',
        workspaceIds: ['ws'],
        userInput: 'x',
        engineId: 'fake',
        now
      })
    ).toThrow(/未知引擎/);

    // 只有显式 engineId: 'legacy' 才真正到达 Legacy（对照/回退引擎按需显式选）。
    const handle = controller.start({
      runId: 'run-explicit',
      sessionId: 'conv-1',
      origin: 'chat',
      workspaceIds: ['ws'],
      userInput: 'x',
      engineId: 'legacy',
      now
    });
    expect(await handle.done).toBe('completed');
    expect(controller.getRun('run-no-id')).toBe(null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
