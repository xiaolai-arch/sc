import type { ButlerStreamEvent } from '../../shared/butler-stream';
import type { ButlerService } from '../../shared/workspace';
import type { EnginePort, RunContext } from './contracts';
import { BUTLER_TOOL_LEVELS } from './butler-bridge';

/**
 * LegacyEngine (spec「引擎适配器」): wraps the existing butler loop
 * (`ButlerService.stream`) as the comparison/rollback engine — a mapping
 * adapter, not a rewrite of the loop. Engine id is `'legacy'`.
 *
 * ## 缝②：单 pending 槽 = 串行调用约束
 *
 * ToolGateway 挂一个审批槽（P0 事实），这条约束成立的前提是引擎**串行**发起
 * 工具调用。LegacyEngine 全程串行：它只包装 `ButlerService.stream`，而该循环
 * （butler-service.ts 的 `for (const call of toolCalls)`）本身逐个 `await`
 * 执行工具调用，从不并行；本适配器的事件回调也是同步映射、按事件到达顺序
 * 发射。因此 Legacy 路径一次只有一个工具在途，与网关的单审批槽一一对应。
 * 本文件不得引入任何并行工具调用（`Promise.all` / 并发 `invoke`）。
 *
 * ## 确认（审批）语义 — 产品取舍点，见交付报告
 *
 * Legacy 循环自身没有审批概念：确认级工具在循环内直执行，唯一闸门是
 * `permissions`（ButlerToolContext.permissions，随 SendMessageInput 原样传入
 * `stream`）。把确认级工具改经网关审批需要改动 `ButlerService.stream` 本体
 * （工具表不可注入），越出本批白名单且被「包装不是重写」约束禁止——两案的
 * 取舍在交付报告里呈报，不在本文件拍板。Fake 路径的确认照旧走网关（P0 既有）。
 *
 * ## 缝①：回执（service.receipt）映射点
 *
 * 完成必须由服务回执驱动（spec：模型停止输出 ≠ 任务完成）。映射点在
 * `tool-result` 事件：Legacy 循环里工具执行体返回 ok=true 即该次服务调用
 * 成功；对确认级（写入类）工具的成功回执，本适配器 emit
 * `service.receipt`。`RunController` 据此把「有写入提交 + 其后有回执」判为
 * `completed`（否则 pending-verification）。查询级工具的成功不发生回执。
 * 前提：装配时 RunController 的网关注册表必须含管家工具标级
 * （`registerButlerTools`），控制器的 confirm 判定读的是同一张表。
 *
 * ## 事件映射表（详见交付报告）
 *
 * | ButlerStreamEvent | RunEvent |
 * |---|---|
 * | `text` | `text.delta` |
 * | `narration` | `text.delta`（工具调用前的模型叙述也是模型文本） |
 * | `tool-result`（ok=true） | `tool.committed`；确认级工具再补 `service.receipt` |
 * | `tool-result`（ok=false） | `tool.failed`（reason=`failed`） |
 * | `error` | 不映射为事件；结束时引擎抛错 → 运行「失败」 |
 * | `done`（canceled） | 不映射；取消终态由 `RunController.cancel` 合成 `run.finished` |
 * | `done`（其余） | 不映射；`run.finished` 由控制器合成 |
 * | `references` / `reasoning` / `retry` / `tool-start` | v1 契约无对应类型，不映射（报告写明） |
 */

export interface LegacyEngineOptions {
  /** 被包装的既有管家服务（`ButlerService.stream`）。 */
  butler: ButlerService;
  /**
   * 视为写入类的工具名集合：它们的成功回执触发 `service.receipt`，它们的
   * 失败把运行判为失败。默认取 `BUTLER_TOOL_LEVELS` 里全部 confirm 级工具。
   */
  writeTools?: ReadonlySet<string>;
}

export class LegacyEngine implements EnginePort {
  readonly id = 'legacy';

  private readonly butler: ButlerService;
  private readonly writeTools: ReadonlySet<string>;

  constructor(options: LegacyEngineOptions) {
    this.butler = options.butler;
    this.writeTools =
      options.writeTools ??
      new Set(
        Object.entries(BUTLER_TOOL_LEVELS)
          .filter(([, level]) => level === 'confirm')
          .map(([name]) => name)
      );
  }

  async run(context: RunContext): Promise<void> {
    const request = context.request;
    /** 最后一次「确认级工具失败」：此后若无确认级工具成功，运行按失败收尾。 */
    let lastWriteFailure: string | undefined;
    /** Legacy 循环的 `error` 事件（模型连接失败等）：结束时抛出 → 运行失败。 */
    let modelError: string | undefined;

    const onEvent = (event: ButlerStreamEvent): void => {
      switch (event.type) {
        case 'text':
        case 'narration':
          context.emit({ type: 'text.delta', text: event.text });
          return;
        case 'tool-result': {
          if (event.ok) {
            // 服务调用成功：与网关语义对齐（查询级也发 committed）。
            context.emit({
              type: 'tool.committed',
              invocationId: event.id,
              tool: event.name
            });
            // 缝①回执映射点：确认级写入服务返回成功 → 立即发回执。
            if (this.writeTools.has(event.name)) {
              lastWriteFailure = undefined;
              context.emit({
                type: 'service.receipt',
                detail: `${event.label || event.name} 成功`
              });
            }
          } else {
            context.emit({
              type: 'tool.failed',
              invocationId: event.id,
              tool: event.name,
              reason: 'failed',
              error: event.detail ?? `${event.name} 执行失败`
            });
            if (this.writeTools.has(event.name)) {
              lastWriteFailure = event.name;
            }
          }
          return;
        }
        case 'error':
          modelError = event.message;
          return;
        default:
          // references / reasoning / retry / tool-start / done：v1 不映射。
          return;
      }
    };

    await this.butler.stream(
      {
        message: request.userInput,
        ...(request.workspaceIds[0] ? { workspaceId: request.workspaceIds[0] } : {}),
        // sessionId 即既有管家的会话（历史/持久化沿用 ButlerService 既有语义）。
        ...(request.sessionId ? { conversationId: request.sessionId } : {}),
        // 权限门：确认级工具在 Legacy 直执行，唯一闸门随输入原样传入。
        ...(context.butler?.permissions ? { permissions: context.butler.permissions } : {})
      },
      onEvent,
      // 取消：RunController.cancel → 合并信号 abort → 既有 cancel-stream 语义
      // （循环内 throwIfAborted / 模型请求 signal）接管；取消后不再执行工具。
      { signal: context.signal }
    );

    // 取消后的收尾不判成败：终态已由控制器定为 cancelled。
    if (context.signal.aborted) return;
    if (modelError !== undefined) {
      throw new Error(modelError);
    }
    if (lastWriteFailure !== undefined) {
      // 失败不说成功（验收 9）：写入类工具失败且其后无成功写入 → 运行失败，
      // 而不是把 Legacy 的模板兜底文案当成功。
      throw new Error(`工具 ${lastWriteFailure} 调用失败，本次运行按失败结束。`);
    }
  }
}
