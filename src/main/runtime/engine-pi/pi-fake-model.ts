import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { AssistantMessage, ToolCall, Usage } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';

/**
 * 脚本化假模型（spec 测试表 P2 行「单测用 Fake」的注入件）。
 *
 * 为什么住在 engine-pi/ 里：验收 14 的零泄漏边界要求 src 里只有本目录可以
 * import Pi 包，而构造 pi 的 `AssistantMessageEventStream` 必须用上游工厂
 * （`createAssistantMessageEventStream`）。把假模型做成本目录的导出，单测与
 * 打包自测（`../pi-selftest`）都只 import 本文件，测试代码里没有一行 Pi。
 *
 * 注入方式（报告要点）：pi `Agent` 的构造参数 `streamFn` 是一等可注入槽位
 * （AgentOptions.streamFn，见上游 README「Quick Start」），不需要 fork、不需要
 * provider catalog——`models.streamSimple` 只是官方推荐的默认实现之一。本文件
 * 用同一槽位注入脚本化流，驱动的是**真实的 pi Agent 循环**（多轮、工具执行、
 * 事件发射、取消全部是上游代码在跑）。
 *
 * 这里的「假」只假在模型传输层：`ScriptedPiRound` 重放上游流协议事件
 * （start → text_delta → toolcall_* → done/error），事件形状与真 provider
 * 相同（对照 pi-ai `AssistantMessageEvent` 联合类型逐字段构造）。
 */

/** 一条脚本化的工具调用（对应 AssistantMessage.content 里的 toolCall 块）。 */
export interface ScriptedPiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 一次 provider 请求（一个 turn）的脚本。字段全可选，按需组合。 */
export interface ScriptedPiRoundData {
  /** 逐条推成 text_delta 的文本增量（流式响应的最小可见单位）。 */
  deltas?: string[];
  /** 最终消息携带的工具调用；出现即 stopReason=toolUse，循环会执行工具再续一轮。 */
  toolCalls?: ScriptedPiToolCall[];
  /** 纯文本收尾（stopReason=stop），不再续轮。 */
  finalText?: string;
  /**
   * 缝③ scripted 形态：一次成段返回——全文只出现在 done 消息里（零
   * text_delta，stopReason=stop），模拟不发增量的提供方。与 deltas/finalText
   * 互斥（本字段优先，出现即整轮收尾）。
   */
  doneOnlyText?: string;
  /** 推完 deltas 后挂起，直到运行信号 abort，再以 stopReason=aborted 收尾（取消竞态）。 */
  holdUntilAbort?: boolean;
  /** 以 provider 错误收尾（模型调用失败路径），值为错误文案。 */
  error?: string;
}

/**
 * 轮脚本可以是惰性函数（发起该轮 provider 请求时才求值）：场景测试里模型要
 * 「读 plan_preview 的结果再发 commit_plan」——与 P1 FakeEngine 的 custom 步骤
 * 同一模式。函数拿到的是测试闭包（例如上一轮落进录制 planner 的输入）。
 */
export type ScriptedPiRound = ScriptedPiRoundData | (() => ScriptedPiRoundData | Promise<ScriptedPiRoundData>);

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: ZERO_COST
};

function basePartial(stopReason: AssistantMessage['stopReason']): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'unknown',
    provider: 'unknown',
    model: 'asaki-runtime-stub',
    usage: ZERO_USAGE,
    stopReason,
    timestamp: Date.now()
  };
}

/** 上游流协议的 `done` reason 与消息 stopReason 的对应（见 pi-ai AssistantMessageEvent）。 */
function doneReason(message: AssistantMessage): 'stop' | 'toolUse' {
  return message.stopReason === 'toolUse' ? 'toolUse' : 'stop';
}

/**
 * 把脚本渲染成真 StreamFn。每轮 provider 请求消费一条脚本；脚本耗尽即抛错
 * （与 FakeModelClient 的「没有下一轮」语义一致，防止测试悄悄跑偏）。
 * 信号已 abort 的轮次不再按脚本走，直接以 aborted 收尾（取消后不产生新内容）。
 */
export function scriptedPiModel(rounds: ScriptedPiRound[]): StreamFn {
  let cursor = 0;
  return async (_model, _context, options) => {
    const scripted = rounds[cursor];
    cursor += 1;
    if (!scripted) throw new Error('scriptedPiModel: 没有下一轮脚本。');
    const round =
      typeof scripted === 'function'
        ? await (scripted as () => ScriptedPiRoundData | Promise<ScriptedPiRoundData>)()
        : scripted;
    const stream = createAssistantMessageEventStream();
    const signal = options?.signal;
    void (async () => {
      const aborted = (): boolean => signal?.aborted === true;
      // 已取消：直接 aborted 收尾，不消耗脚本内容。
      if (aborted()) {
        stream.push({
          type: 'error',
          reason: 'aborted',
          error: { ...basePartial('aborted'), errorMessage: 'aborted before generation' }
        });
        return;
      }
      const partial = basePartial('pending');
      stream.push({ type: 'start', partial });
      // 缝③ scripted 形态：一次成段——全文只进 done 消息，零 text_delta。
      if (round.doneOnlyText !== undefined) {
        partial.content = [{ type: 'text', text: round.doneOnlyText }];
        stream.push({
          type: 'done',
          reason: 'stop',
          message: { ...partial, stopReason: 'stop' as const }
        });
        return;
      }
      let text = '';
      const deltas = [...(round.deltas ?? [])];
      if (round.finalText !== undefined) deltas.push(round.finalText);
      for (const delta of deltas) {
        if (aborted()) break;
        text += delta;
        partial.content = [{ type: 'text', text }];
        stream.push({ type: 'text_delta', contentIndex: 0, delta, partial: { ...partial } });
      }
      if (round.toolCalls?.length) {
        partial.content = [...partial.content];
        for (const call of round.toolCalls) {
          if (aborted()) break;
          // 脚本作者传入的 arguments 必须是 JSON 兼容值（与真 provider 的
          // toolCall.arguments: JsonObject 同一约束），这里收窄为上游类型。
          const toolCall: ToolCall = {
            type: 'toolCall',
            id: call.id,
            name: call.name,
            arguments: call.arguments as ToolCall['arguments']
          };
          partial.content.push(toolCall);
          const partialSnapshot = (): AssistantMessage => ({ ...partial, content: [...partial.content] });
          stream.push({ type: 'toolcall_start', contentIndex: partial.content.length - 1, partial: partialSnapshot() });
          stream.push({
            type: 'toolcall_delta',
            contentIndex: partial.content.length - 1,
            delta: JSON.stringify(call.arguments),
            partial: partialSnapshot()
          });
          stream.push({ type: 'toolcall_end', contentIndex: partial.content.length - 1, toolCall, partial: partialSnapshot() });
        }
      }
      if (aborted()) {
        const abortedMessage = { ...partial, stopReason: 'aborted' as const, errorMessage: 'aborted' };
        stream.push({ type: 'error', reason: 'aborted', error: abortedMessage });
        return;
      }
      if (round.holdUntilAbort) {
        await new Promise<void>((resolve) => {
          if (signal) {
            if (signal.aborted) resolve();
            else signal.addEventListener('abort', () => resolve(), { once: true });
          }
        });
        const abortedMessage = { ...partial, stopReason: 'aborted' as const, errorMessage: 'aborted' };
        stream.push({ type: 'error', reason: 'aborted', error: abortedMessage });
        return;
      }
      if (round.error !== undefined) {
        const errorMessage = {
          ...partial,
          stopReason: 'error' as const,
          errorMessage: round.error
        };
        stream.push({ type: 'error', reason: 'error', error: errorMessage });
        return;
      }
      const stopReason: AssistantMessage['stopReason'] = round.toolCalls?.length ? 'toolUse' : 'stop';
      const final: AssistantMessage = {
        ...partial,
        content: [...partial.content],
        stopReason
      };
      stream.push({ type: 'done', reason: doneReason(final), message: final });
    })();
    return stream;
  };
}
