import { createButlerTools, type ButlerToolDefinition } from '../butler/tools';
import type { ToolBehaviorLevel } from './tool-gateway';
import { ToolGateway } from './tool-gateway';
import { buildCommitPlanTool, buildPlanPreviewTool } from './plan-tools';

/**
 * Registers every existing butler tool (the exact set returned by
 * `createButlerTools`) with the gateway as a thin wrapper delegating to the
 * same implementation function — `tools.ts` stays byte-identical, so live
 * behavior in P0 is unchanged (Legacy wires into the Runtime only in P1).
 * Plus the two new plan-split tools.
 */

/**
 * 三级行为标级表（19 个工具，名单以 `createButlerTools` 返回为准）：
 * - query：只读查询/预览（requiresWrite === false）。
 * - confirm：修改本地数据——批准绑定这一次操作 + 项目 + 参数。
 * - 第三级（删除 / 批量改动 / 对外发送）：v1 无此类工具，注册即违规。
 */
export const BUTLER_TOOL_LEVELS: Readonly<Record<string, ToolBehaviorLevel>> = {
  create_workspace: 'confirm',
  create_task: 'confirm',
  set_reminder: 'confirm',
  save_review: 'confirm',
  // 旧 plan_workspace（生成+写入一体）在网关层保留为别名一个迭代（默认决定 3）。
  // P0 它只是注册表条目（包装旧执行体），没有任何引擎会调用它；语义在 P1
  // 接线时才真正生效——届时它收敛为 commit_plan 的别名或退役。
  plan_workspace: 'confirm',
  create_long_plan: 'confirm',
  update_workspace: 'confirm',
  get_today_plan: 'query',
  write_note: 'confirm',
  update_task: 'confirm',
  get_memory: 'query',
  record_knowledge: 'confirm',
  schedule_revisit: 'confirm',
  record_commitment: 'confirm',
  resolve_commitment: 'confirm',
  set_week_availability: 'confirm',
  save_profile: 'confirm',
  create_practice_set: 'confirm',
  get_practice_overview: 'query',
  // 计划拆分（验收 6）：预览只读自动执行，提交是确认级写入。
  plan_preview: 'query',
  commit_plan: 'confirm'
};

/** Sanity guard: a `query` label on a tool that writes would silently bypass approval. */
function assertLevelConsistent(tool: ButlerToolDefinition, level: ToolBehaviorLevel): void {
  if (level === 'query' && tool.requiresWrite !== false) {
    throw new Error(`工具 ${tool.name} 标为 query 但未声明 requiresWrite:false。`);
  }
}

export interface ButlerBridgeOptions {
  /** Defaults to `createButlerTools()` — the authoritative 19-tool roster. */
  tools?: ButlerToolDefinition[];
  /** Register the plan-split tools too; tests may opt out. Default true. */
  includePlanSplit?: boolean;
}

export function registerButlerTools(gateway: ToolGateway, options: ButlerBridgeOptions = {}): void {
  const tools = options.tools ?? createButlerTools();
  for (const tool of tools) {
    const level = BUTLER_TOOL_LEVELS[tool.name];
    if (level === undefined) {
      throw new Error(`工具 ${tool.name} 未在标级表中声明行为级。`);
    }
    assertLevelConsistent(tool, level);
    gateway.register({
      name: tool.name,
      level,
      description: tool.description,
      parameters: tool.parameters,
      // 薄包装：委托到同一个实现函数。`tools.ts` 一字不动。
      execute: (input, context) => tool.execute(input, context)
    });
  }
  if (options.includePlanSplit !== false) {
    gateway.register(buildPlanPreviewTool());
    gateway.register(buildCommitPlanTool());
  }
}
