import type { EnginePort } from './contracts';

/**
 * 引擎注册/选择层（spec P2 验收 13 的「关 Pi 开关」落点）。
 *
 * 「关闭 Pi 开关」在 v1 的含义是**装配层的引擎集合**：PiEngine 不进
 * `RunController` 的 engines 表，`engineId: 'pi'` 的请求即不可达（start 对
 * 未注册引擎抛「未知引擎」——P0 既有行为）；Legacy/Fake 的注册与行为不受
 * Pi 依赖存在与否影响（卸除 PiEngine 装配不影响 Legacy 路径）。
 *
 * ## 默认引擎禁令（item 61 裁定，硬约束）
 *
 * Legacy 不得设为默认引擎；本层也**不设任何隐式默认**——保守口径「要求显式
 * engineId、不设隐式默认」（备选：强制一个默认引擎，已并呈交付报告待裁定）。
 * `RunRequest.engineId` 是必填契约字段（P0），`RunController.start` 对空值/
 * 未注册值抛错；本层的任何函数都不在 engineId 缺失时替调用者挑引擎。
 *
 * 守卫（P3 装配批）：`EngineAssembly` 没有「默认引擎」槽位——对象字面量里
 * 塞 `default` 等多余字段在类型层直接不可能（TS 多余属性检查）；`assembleEngines`
 * 再对非字面量路径（变量、`as` 断言、展开）做运行时兜底：出现 {fake, legacy, pi}
 * 之外的装配字段即抛错。因此「只注册了 Legacy 一个引擎」时 selection 产出的是
 * 引擎集合 + 无任何默认可选——没有 engineId 就没有运行，不存在静默选中 Legacy
 * 的代码路径（tests/main/runtime/engine-selection.test.ts 锁两个方向）。
 */

export interface EngineAssembly {
  fake?: EnginePort | null;
  legacy?: EnginePort | null;
  pi?: EnginePort | null;
}

/** 合法装配字段（默认引擎禁令：不存在的槽位，出现即装配错误）。 */
const ASSEMBLY_KEYS: ReadonlySet<string> = new Set(['fake', 'legacy', 'pi']);

/**
 * 按显式装配产出引擎集合。null/缺省 = 该引擎关闭（验收 13 的开关语义）；
 * 顺序仅为可读性，不构成任何「注册顺序即默认」语义——没有 engineId 就没有
 * 运行（RunController.start 的既有校验）。
 */
export function assembleEngines(assembly: EngineAssembly): EnginePort[] {
  // 默认引擎禁令的运行时兜底：字面量路径已被类型层堵死，这里拦变量/as/展开
  // 路径——任何试图把「默认引擎」槽位塞进装配对象的写法启动即抛。
  for (const key of Object.keys(assembly)) {
    if (!ASSEMBLY_KEYS.has(key)) {
      throw new Error(
        `assembleEngines：未知装配字段「${key}」——装配层没有默认引擎槽位，Legacy 不得设为默认（item 61）。`
      );
    }
  }
  const engines: EnginePort[] = [];
  for (const engine of [assembly.fake, assembly.legacy, assembly.pi]) {
    if (engine) engines.push(engine);
  }
  return engines;
}

/** 是否已注册指定引擎（开关状态的查询面；装配/诊断用）。 */
export function hasEngine(engines: Iterable<EnginePort>, engineId: string): boolean {
  for (const engine of engines) {
    if (engine.id === engineId) return true;
  }
  return false;
}
