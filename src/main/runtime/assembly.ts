import {
  assertButlerConfirmTools,
  registerButlerTools,
  type ButlerBridgeOptions
} from './butler-bridge';
import type { EnginePort } from './contracts';
import { assembleEngines, type EngineAssembly } from './engine-selection';
import { RunController } from './run-controller';
import type { RunJournal } from './run-journal';
import { ToolGateway } from './tool-gateway';

/**
 * Runtime 装配唯一入口（P3 装配收口批，item 61）。
 *
 * 此前网关与控制器的绑定散在调用方手里（pi-selftest 手工 `registerButlerTools`
 * + `new RunController`），「装配时管家工具已注册」只是注释里的约定——漏注册
 * 不报错，控制器的 confirm 判定（缝①完成规则）会静默失效。本入口把三件事
 * 收拢并强制：
 *
 * 1. 显式 `registerButlerTools(gateway)`——装配路径必经，不再依赖调用方记得；
 * 2. 启动断言 `assertButlerConfirmTools(gateway)`——确认级工具集合与
 *    `BUTLER_TOOL_LEVELS`（controller/引擎共同的期望表）不一致 → fail-fast
 *    抛错拒绝启动，不静默降级；
 * 3. `assembleEngines` 组装引擎集合（含「无默认引擎/ Legacy 永不默认」守卫）。
 */

export interface RuntimeAssemblyOptions {
  /**
   * 已存在的网关（引擎构造需要先拿到网关实例时传入）；缺省自建。传入的网关
   * 必须尚未注册任何管家工具——管家注册由装配层独占（重复注册即抛错）。
   */
  gateway?: ToolGateway;
  journal: RunJournal;
  /** 引擎集合（无默认引擎槽位；Legacy 永不默认——engine-selection 的守卫）。 */
  engines: EngineAssembly;
  /**
   * 管家桥接参数：生产装配不传（注册完整 19+2 工具表）。测试可用 `tools`
   * 注入裁剪表制造「漏注册确认级工具」的负例——断言会如实拒绝。
   */
  butlerBridge?: ButlerBridgeOptions;
}

export interface RuntimeAssembly {
  gateway: ToolGateway;
  controller: RunController;
}

export function assembleRuntime(options: RuntimeAssemblyOptions): RuntimeAssembly {
  const gateway = options.gateway ?? new ToolGateway();
  registerButlerTools(gateway, options.butlerBridge);
  assertButlerConfirmTools(gateway);
  const engines: EnginePort[] = assembleEngines(options.engines);
  const controller = new RunController({ engines, gateway, journal: options.journal });
  return { gateway, controller };
}
