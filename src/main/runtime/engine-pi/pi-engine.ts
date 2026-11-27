import type { Api, AssistantMessage, Model, TextContent } from '@earendil-works/pi-ai';
import type { Agent, AgentEvent, AgentTool, AgentToolResult, StreamFn } from '@earendil-works/pi-agent-core';
import { butlerToolLabel } from '../../../shared/butler-stream';
import { doneOnlyCatchUp, type EnginePort, type RunContext } from '../contracts';
import type { ToolGateway } from '../tool-gateway';
import { BUTLER_TOOL_LEVELS } from '../butler-bridge';

/**
 * PiEngine (spec P2「引擎适配器」)：适配锁定的 `@earendil-works/pi-agent-core`
 * （package.json 精确版本 1.6.1，MIT，Node ≥ 22.19.0）实现 P0 的
 * `EnginePort`。Engine id 用 `'pi'`。不 fork、不复制上游源码改名（spec :74）。
 *
 * ## ESM-only 接入形态（报告要点）
 *
 * 上游包是 ESM-only（exports 只有 `import` 条件，无 `default`/`require`）——
 * CJS 里 `require()` 直接 `ERR_PACKAGE_PATH_NOT_EXPORTED`（已实测，Node
 * 24.18 与 Electron 内置 24.22.1 同样）。因此唯一的运行时引用方式是动态
 * `import()`（Electron 运行时实测加载成功）。本文件对 Pi 包只有两类引用：
 * - `import type`（类型引用，编译期擦除，零运行时代价）；
 * - `loadPiAgentCore()` 里唯一的动态 `import()`（惰性、模块级缓存）。
 * 其余模块不得出现 Pi 包名（验收 14 由 pi-leak 测试锁）。
 *
 * ## 假模型注入（报告要点）
 *
 * 上游 `Agent` 的构造参数 `streamFn` 是一等可注入槽位——模型传输层整体可换，
 * 不需要 fork 即可用脚本化假模型驱动真实上游循环（多轮、工具执行、事件流、
 * 取消）。见 `pi-fake-model.ts`。
 *
 * ## 串行约束（缝②，继承 P0/P1）
 *
 * ToolGateway 单审批槽的前提是引擎串行发起工具调用。本适配器构造 Agent 时
 * 显式传 `toolExecution: 'sequential'`（上游默认是 parallel，必须覆盖），且
 * AgentTool.execute 内部严格逐个 await 网关 invoke。本文件不得引入任何并行
 * 工具调用（`Promise.all` / 并发 `invoke`）。测试锁：`pi-engine.test.ts` 的
 * maxActive=1 断言。
 *
 * ## 缝①：回执（service.receipt）映射点（与 LegacyEngine 同缝）
 *
 * 完成必须由服务回执驱动（spec：模型停止输出 ≠ 任务完成）。映射点在网关
 * invoke 的成功回执处：确认级（写入类）工具返回 ok=true 即该次服务调用成功
 * → 立即 emit `service.receipt`；确认级失败且其后无成功写入 → run() 抛错 →
 * 运行「失败」（失败不说成功）。RunController 据「有写入提交 + 其后有回执」
 * 判 completed（否则 pending-verification）。writeTools 默认取
 * `BUTLER_TOOL_LEVELS` 全部 confirm 级工具——与 LegacyEngine 同一张表。
 *
 * ## 事件映射表（详见交付报告）
 *
 * | pi AgentEvent | RunEvent |
 * |---|---|
 * | `agent_start` / `turn_start` / `turn_end` | 不映射（run.started / run.finished 由 RunController 合成） |
 * | `message_update`（assistantMessageEvent.type=`text_delta`） | `text.delta`（增量原文） |
 * | `message_update`（其余：thinking_* / toolcall_* / text_start / text_end） | 不映射（thinking 对齐 Legacy 的 reasoning 不映射；toolcall_* 由网关事件承载） |
 * | `message_start` | 不映射 |
 * | `message_end`（stopReason=stop/toolUse） | 缝③：全程零 text_delta 且消息正文非空（一次成段返回）→ 补发一条 `text.delta`（全文）；其余不映射（run.finished 由控制器合成） |
 * | `message_end`（stopReason=`error`） | 不映射为即时事件；记下 errorMessage，run() 结束时抛出 → 运行「失败」（对齐 Legacy 的 error 事件映射） |
 * | `message_end`（stopReason=`aborted`） | 不映射；取消终态由 `RunController.cancel` 合成 `run.finished` |
 * | `tool_execution_start` / `tool_execution_update` | 不映射（v1 契约无对应类型；对齐 Legacy 的 tool-start 不映射） |
 * | 工具执行本体（AgentTool.execute → gateway.invoke） | `tool.committed` / `tool.failed` / `references` 由 ToolGateway 发射（与 Fake 路径同一缝）；确认级成功再补 `service.receipt`（缝①）；缝④ references：工具返回值携带合法 references 数组时网关发射——两条引擎路径同一缝，引擎不重复映射 |
 * | `tool_execution_end`（isError=true 且网关从未见过该调用） | `tool.failed`（reason=`unknown-tool`：模型调了未注册工具；reason=`failed`：参数校验失败）——网关拦截不到的 pi 侧前置失败 |
 * | `tool_execution_end`（isError=true 且网关已回执失败） | 不映射（`tool.failed` 已由网关发射，不重复） |
 * | `agent_end` | 不映射（`run.finished` 由控制器合成） |
 */

/** `import('@earendil-works/pi-agent-core')` 的模块形状（本目录之外不得引用）。 */
export type PiAgentCoreModule = typeof import('@earendil-works/pi-agent-core');

let cachedModule: PiAgentCoreModule | null = null;

/**
 * 惰性动态加载（src 中唯一的 Pi 包运行时引用点）。模块级缓存：同一进程只
 * import 一次；测试可以经 PiEngineOptions.pi 显式注入以绕过加载器。
 */
export async function loadPiAgentCore(): Promise<PiAgentCoreModule> {
  if (!cachedModule) {
    cachedModule = await import('@earendil-works/pi-agent-core');
  }
  return cachedModule;
}

/** 测试/打包自测注入加载模块的豁免口；生产装配不传。 */
export function setCachedPiAgentCore(module: PiAgentCoreModule | null): void {
  cachedModule = module;
}

/** PiEngine 装配所需的最小网关读取面（与 RunContext.tools 同一网关实例）。 */
export type PiToolSource = Pick<ToolGateway, 'definitions'>;

export interface PiEngineOptions {
  /** 模型传输层（StreamFn）。单测/打包自测注入脚本化假模型；真实 provider 适配器在 P3 装配时提供。 */
  streamFn: StreamFn;
  /** 模型描述符（透传 streamFn；脚本化假模型不读）。缺省用占位 unknown 模型。 */
  model?: Model<Api>;
  /** 系统提示词。引擎不拼业务上下文（那是 ContextBuilder 的事，spec 接缝段）。 */
  systemPrompt?: string;
  /**
   * 视为写入类的工具名集合：成功回执触发 `service.receipt`、失败参与
   * 「失败不说成功」判定。默认取 BUTLER_TOOL_LEVELS 全部 confirm 级工具。
   */
  writeTools?: ReadonlySet<string>;
  /** 预载的 pi 模块（测试豁免加载器）；缺省 lazy 动态 import。 */
  pi?: PiAgentCoreModule;
  /** 网关读取面（工具清单）。装配时传与控制器同一实例。 */
  tools: PiToolSource;
}

/** 占位模型描述符（脚本化假模型不读它；只满足 StreamFn 的签名）。 */
export const PI_STUB_MODEL: Model<Api> = {
  id: 'unknown',
  name: 'unknown',
  api: 'unknown',
  provider: 'unknown',
  baseUrl: '',
  reasoning: false,
  input: [],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 0,
  maxTokens: 0
};

/** 从 pi 侧错误工具结果里提取面向模型的文案（错误结果的 content 是 text 块）。 */
function errorTextOf(result: unknown): string {
  const content = (result as { content?: unknown } | null | undefined)?.content;
  if (Array.isArray(content)) {
    const text = content
      .map((block) =>
        block && typeof block === 'object' && (block as TextContent).type === 'text'
          ? (block as TextContent).text
          : ''
      )
      .filter((text) => text.length > 0)
      .join('\n');
    if (text) return text;
  }
  return '工具调用失败。';
}

export class PiEngine implements EnginePort {
  readonly id = 'pi';

  private readonly options: PiEngineOptions;
  private readonly writeTools: ReadonlySet<string>;

  constructor(options: PiEngineOptions) {
    this.options = options;
    this.writeTools =
      options.writeTools ??
      new Set(
        Object.entries(BUTLER_TOOL_LEVELS)
          .filter(([, level]) => level === 'confirm')
          .map(([name]) => name)
      );
  }

  async run(context: RunContext): Promise<void> {
    const pi = this.options.pi ?? (await loadPiAgentCore());
    /** pi 侧被拦截（未达网关）的工具调用 id：tool_execution_end 判定用。 */
    const gatewaySeen = new Set<string>();
    /** 最后一次「确认级工具失败」：其后无确认级成功则运行按失败收尾（对齐 Legacy）。 */
    let lastWriteFailure: string | undefined;
    /** pi 的 stopReason=error 消息文案（Legacy error 事件的对应物）。 */
    let modelError: string | undefined;
    /** 本会话已发出的 `text.delta` 条数（缝③补发判定：补发本身也计数）。 */
    let textDeltaCount = 0;
    const writeTools = this.writeTools;

    const definitions = this.options.tools.definitions();
    const declared = new Set(definitions.map((definition) => definition.name));

    // 网关注册表 → pi AgentTool 的薄映射：名字/描述/JSON Schema 原样透传，
    // execute 委托到 RunContext.tools.invoke（网关同一缝，committed/failed
    // 与审批都在网关内发生——引擎不绕过它）。
    const agentTools: AgentTool[] = definitions.map((definition) => {
      const toolName = definition.name;
      const agentTool: AgentTool = {
        name: toolName,
        description: definition.description,
        parameters: definition.parameters,
        label: butlerToolLabel(toolName),
        execute: async (toolCallId: string, params: unknown): Promise<AgentToolResult> => {
          // 取消后引擎不得再发起任何工具调用（缝②）。
          if (context.signal.aborted) {
            return {
              content: [{ type: 'text', text: '运行已取消，不再执行工具。' }],
              details: null,
              isError: true
            };
          }
          gatewaySeen.add(toolCallId);
          const outcome = await context.tools.invoke(
            toolName,
            params as Record<string, unknown>
          );
          if (outcome.ok) {
            // 缝①回执映射点：确认级写入服务成功 → 立即发回执（与 Legacy 同缝）。
            if (writeTools.has(toolName)) {
              lastWriteFailure = undefined;
              context.emit({
                type: 'service.receipt',
                detail: `${butlerToolLabel(toolName)} 成功`
              });
            }
            return {
              content: [{ type: 'text', text: JSON.stringify(outcome.result ?? {}) }],
              // details 给 UI/日志：网关结果本就是 JSON 值（P0 契约 execute → unknown）。
              details: (outcome.result ?? null) as AgentToolResult['details']
            };
          }
          if (writeTools.has(toolName)) {
            lastWriteFailure = toolName;
          }
          return {
            content: [{ type: 'text', text: outcome.error ?? '工具执行失败。' }],
            details: { reason: outcome.reason ?? 'failed' },
            isError: true
          };
        }
      };
      return agentTool;
    });

    const agent: Agent = new pi.Agent({
      // 缝②串行约束（上游默认 parallel，必须显式覆盖；见文件头）。
      toolExecution: 'sequential',
      initialState: {
        model: this.options.model ?? PI_STUB_MODEL,
        ...(this.options.systemPrompt !== undefined
          ? { systemPrompt: this.options.systemPrompt }
          : {}),
        tools: agentTools
      },
      streamFn: this.options.streamFn
    });

    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      switch (event.type) {
        case 'message_update': {
          const streamEvent = event.assistantMessageEvent;
          if (streamEvent.type === 'text_delta') {
            textDeltaCount += 1;
            context.emit({ type: 'text.delta', text: streamEvent.delta });
          }
          return;
        }
        case 'message_end': {
          const message = event.message as AssistantMessage;
          if (message.stopReason === 'error') {
            modelError = message.errorMessage ?? '模型调用失败';
            return;
          }
          // 缝③：一次成段返回（全程零 text_delta）而终局消息携带正文 → 先补发
          // 一条全文 delta 再交控制器收尾。error/aborted 终局走既有失败/取消
          // 路径，不在本缝（补发只对正常终局）。补发本身计入 delta 计数，
          // 多轮时不会重复。
          if (message.stopReason === 'stop' || message.stopReason === 'toolUse') {
            const text = message.content
              .map((block) =>
                block && (block as TextContent).type === 'text' ? (block as TextContent).text : ''
              )
              .join('');
            const catchUp = doneOnlyCatchUp(textDeltaCount, text);
            if (catchUp !== null) {
              textDeltaCount += 1;
              context.emit({ type: 'text.delta', text: catchUp });
            }
          }
          return;
        }
        case 'tool_execution_end': {
          // 网关没见过的失败是 pi 侧前置拦截：未注册工具 / 参数校验失败。
          // 网关回执过的失败不再重复映射（tool.failed 已在事件流里）。
          if (event.isError && !gatewaySeen.has(event.toolCallId)) {
            context.emit({
              type: 'tool.failed',
              invocationId: event.toolCallId,
              tool: event.toolName,
              reason: declared.has(event.toolName) ? 'failed' : 'unknown-tool',
              error: errorTextOf(event.result)
            });
          }
          return;
        }
        default:
          // agent_start / turn_* / message_start / tool_execution_start|update /
          // agent_end：见文件头映射表（v1 不映射）。
          return;
      }
    });

    // 取消：RunController.cancel → 合并信号 abort → agent.abort()（上游把
    // 在途流与后续工具准备全部以 aborted 收束；取消后不再执行工具）。
    const onAbort = (): void => {
      agent.abort();
    };
    context.signal.addEventListener('abort', onAbort, { once: true });
    try {
      await agent.prompt(context.request.userInput);
    } finally {
      unsubscribe();
      context.signal.removeEventListener('abort', onAbort);
    }

    // 取消后的收尾不判成败：终态已由控制器定为 cancelled。
    if (context.signal.aborted) return;
    if (modelError !== undefined) {
      throw new Error(modelError);
    }
    if (lastWriteFailure !== undefined) {
      // 失败不说成功：写入类工具失败且其后无成功写入 → 运行失败。
      throw new Error(`工具 ${lastWriteFailure} 调用失败，本次运行按失败结束。`);
    }
  }
}
