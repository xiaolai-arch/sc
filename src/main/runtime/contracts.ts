import type { ButlerToolContext } from '../butler/tools';
import type { ButlerReference } from '../../shared/butler-stream';

/**
 * Agent Runtime contracts (spec item 61, P0 skeleton).
 *
 * Everything here is the runtime's public vocabulary: one run's request shape,
 * its event stream, and its six-state lifecycle. Field set follows the spec's
 * `RunRequest` (marked 「spec 填充，待方案 v2 确认」 there) — implemented as
 * written; any forced choice beyond the spec is listed in the delivery report.
 */

/** 发起来源（spec：chat / 晨检 / 用户主动操作）。 */
export type RunOrigin = 'chat' | 'morning-check' | 'user-action';

/**
 * 一次运行的六态（spec：执行中 / 等待确认 / 完成 / 失败 / 取消 / 结果待核实）。
 * 「模型停止输出」≠「任务完成」：`completed` 必须由服务回执驱动（见
 * `RunController` 的 service-receipt 规则），否则落 `pending-verification`。
 */
export type RunState =
  | 'running'
  | 'waiting-approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'pending-verification';

export type TerminalRunState = Exclude<RunState, 'running' | 'waiting-approval'>;

export function isTerminalRunState(state: RunState): state is TerminalRunState {
  return state !== 'running' && state !== 'waiting-approval';
}

/**
 * 运行预算（spec：模型调用次数上限）。`maxModelCalls` 由引擎自行遵守（P0 的
 * 引擎没有模型调用）；`maxToolCalls` 是 Runtime 侧可直接执行的上限，超限的
 * 工具调用被网关以 `tool.failed` 拒绝。
 *
 * F4 记录（P4 批，架构审计裁定：本批不改代码）：`maxModelCalls` 目前**无任何
 * 消费方**——全仓 grep 仅本文件声明，两个真实引擎（LegacyEngine
 * `legacy-engine.ts` 包装 ButlerService.stream、PiEngine `engine-pi/pi-engine.ts`
 * 上游 Agent 循环）都不读预算。接线时明显该消费它的位置：PiEngine 的模型轮次
 * 入口（`pi-engine.ts` 的 `agent.prompt(...)` 调用处——上游每次 provider 请求
 * 增计数，超限在工具步之前收尾）、LegacyEngine 的 `butler.stream(...)` 包装处。
 * 本批按裁定不动。
 */
export interface RunBudget {
  maxModelCalls?: number;
  maxToolCalls?: number;
}

/**
 * 一次任务的请求（spec「RunRequest」，字段为「spec 填充，待 v2 确认」，照 spec
 * 实现）。`userInput` 只进引擎，从不进 RunEvent 与 RunJournal（不记完整提示词）。
 */
export interface RunRequest {
  runId: string;
  sessionId: string;
  /** 发起来源：同一句话经 chat 与晨检进来，权限可以不同（spec 草稿 3）。 */
  origin: RunOrigin;
  /** 项目范围：本次运行允许触碰的 workspace。 */
  workspaceIds: string[];
  /** 用户输入（完整提示词；不落盘、不进事件流）。 */
  userInput: string;
  /** 引擎选择（`fake` / 未来 `legacy` / `pi`）。 */
  engineId: string;
  budget?: RunBudget;
  /** 外部取消信号（进程内注入点；与 `RunController.cancel` 等价）。 */
  signal?: AbortSignal;
  /** 本次统一时钟：运行内所有时间读数都来自它（方案 §二第一条设计）。 */
  now: () => Date;
  /**
   * 只读运行（场景三，验收 22）：置 true 时网关拒绝一切确认级（写入类）工具
   * 调用（reason=permission，记 tool.failed），查询级不受影响。缺省=读写。
   */
  readOnly?: boolean;
}

/** Why a tool call was refused or failed; carried on `tool.failed` events. */
export type ToolFailureReason =
  | 'unknown-tool'
  | 'undeclared-level'
  | 'unknown-arg'
  | 'permission'
  | 'duplicate'
  | 'cancelled'
  | 'rejected'
  | 'budget'
  | 'failed';

/**
 * 审批候选（验收 17：同名承诺先让用户选）。`approval.requested` 附带候选时，
 * 批准必须携带其中一个 `id` 作为选择；未选择前不落盘，选择经网关 pin 进
 * 本次调用的参数（见 ToolGateway 的候选选择语义）。
 */
export interface ApprovalCandidate {
  /** 候选记录 id（批准时经 `decide` 的 selection pin 回参数 `id`）。 */
  id: string;
  /** 面向用户的一行标识（承诺原文）。 */
  label: string;
  /** 面向用户的补充区分信息（如各自到期日）。 */
  detail?: string;
}

/**
 * RunEvent 载荷（spec：至少 run.started / text.delta / approval.requested /
 * tool.committed / tool.failed / run.finished，每条带 runId 与递增序号）。
 * `run.interrupted` 只由 RunJournal 崩溃恢复追加（沿用 ConversationRunStore
 * 先例），控制器从不产生它。
 */
export type RunEventPayload =
  | { type: 'run.started'; origin: RunOrigin; engineId: string; workspaceIds: string[] }
  | { type: 'text.delta'; text: string }
  | {
      /** 服务回执：完成必须由它驱动（方案 §二第二条设计的可观测形式）。 */
      type: 'service.receipt';
      detail?: string;
    }
  | {
      type: 'approval.requested';
      invocationId: string;
      tool: string;
      /** 审批展示与审计用：本次调用的完整参数。 */
      params: Record<string, unknown>;
      /**
       * 同名歧义候选（验收 17）：在场时批准必须携带其中一个 id 作为选择，
       * 未选择前不写盘（见 ApprovalCandidate 与 ToolGateway）。
       */
      candidates?: ApprovalCandidate[];
    }
  | { type: 'tool.committed'; invocationId: string; tool: string }
  | {
      /**
       * 本次回答参考的记录集合（缝④，P4 批：场景三引用来源用）。Legacy 从
       * `ButlerStreamEvent` 的 references 事件原样映射；经网关执行的工具在其
       * 返回值携带合法 `references` 数组时由 ToolGateway 发射（与
       * committed/failed 同一条工具缝），两条引擎路径都不重复映射。
       */
      type: 'references';
      items: ButlerReference[];
    }
  | {
      type: 'tool.failed';
      invocationId: string;
      tool: string;
      reason: ToolFailureReason;
      error: string;
    }
  | { type: 'run.finished'; state: TerminalRunState; error?: string }
  | { type: 'run.interrupted'; message: string };

/** `run.started` 与 `run.finished` 由控制器合成；引擎与网关发其余事件。 */
export type EngineEvent = Extract<
  RunEventPayload,
  {
    type:
      | 'text.delta'
      | 'service.receipt'
      | 'approval.requested'
      | 'tool.committed'
      | 'tool.failed'
      | 'references';
  }
>;

/**
 * 缝③：done-only 文本补发判定（P3 装配批）。
 *
 * 某些引擎/路径一次成段返回：正文只在终局事件里携带（pi 的 `message_end`
 * 消息正文、Legacy 的 `done.text`——工具步数兜底模板等路径从不发 text 事件），
 * 此前从未发过任何 `text.delta`，不补发则正文丢失/空屏。两个引擎适配器共用
 * 本判定：全程零 delta 且终局文本非空 → 返回需补发的全文（适配器先补发一条
 * `text.delta` 再交控制器收尾）；已发过 delta（含此前的补发）→ 返回 null，
 * 不重复。
 */
export function doneOnlyCatchUp(
  /** 本会话迄今已发出的 `text.delta` 条数。 */
  deltaCount: number,
  /** 终局事件携带的全文；缺省/空串不算待补发。 */
  doneText: string | undefined
): string | null {
  if (deltaCount > 0) return null;
  if (typeof doneText !== 'string' || doneText.length === 0) return null;
  return doneText;
}

/** 完整 RunEvent：载荷 + runId + 单次运行内严格递增且连续的序号 + 统一时钟读数。 */
export type RunEvent = RunEventPayload & { runId: string; seq: number; at: string };

export type RunEventListener = (event: RunEvent) => void;

/** 引擎拿到的工具调用回执；失败以回执形式返还，不静默（验收 4）。 */
export interface ToolInvocationOutcome {
  ok: boolean;
  /** 服务回执结果（仅 ok）。 */
  result?: unknown;
  /** 面向模型的错误文案（仅失败）。 */
  error?: string;
  reason?: ToolFailureReason;
  invocationId?: string;
}

/** 引擎经它调用工具；这是客户端之外引擎唯一的工具入口。 */
export interface RuntimeToolHandle {
  invoke(name: string, args?: Record<string, unknown>): Promise<ToolInvocationOutcome>;
}

/** 引擎一次运行的执行上下文（`EnginePort.run` 的唯一参数）。 */
export interface RunContext {
  readonly request: RunRequest;
  /** 内部与外部取消信号的合并；取消后引擎不得再发起任何工具调用。 */
  readonly signal: AbortSignal;
  /** 既有管家工具的执行上下文（`ButlerToolContext`），由装配方提供。 */
  readonly butler?: ButlerToolContext;
  /** 发射引擎事件（文本增量、服务回执等）；工具事件经 `tools.invoke` 产生。 */
  emit(event: EngineEvent): void;
  readonly tools: RuntimeToolHandle;
}

/** 可替换执行引擎的结构端口（spec「引擎适配器」）。P0 只有 FakeEngine。 */
export interface EnginePort {
  readonly id: string;
  run(context: RunContext): Promise<void>;
}
