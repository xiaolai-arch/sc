import type { ButlerToolContext } from '../butler/tools';
import type {
  EngineEvent,
  RunBudget,
  ToolFailureReason,
  ToolInvocationOutcome,
  RuntimeToolHandle
} from './contracts';

/**
 * ToolGateway (spec P0): the tool registry with three behavior tiers, approval
 * for local-data writes bound to one operation + one project + one parameter
 * set, and post-commit deduplication. Legacy butler tools register here as thin
 * wrappers delegating to the very same implementation functions, so P0 keeps
 * live behavior byte-identical (Legacy only wires into the Runtime in P1).
 */

/**
 * 三级行为（spec 草稿 4）：查询/预览=自动执行；修改本地数据=确认；
 * 删除、批量改动、对外发送=v1 不注册（第三级不在本联合类型里——注册即违规）。
 */
export type ToolBehaviorLevel = 'query' | 'confirm';

export const TOOL_BEHAVIOR_LEVELS: readonly ToolBehaviorLevel[] = ['query', 'confirm'];

/** One registry entry. `level` is mandatory: a tool without a declared behavior level must be refused at call time. */
export interface GatewayToolEntry {
  name: string;
  level: ToolBehaviorLevel;
  description: string;
  parameters: Record<string, unknown>;
  execute(input: Record<string, unknown>, context: ButlerToolContext): Promise<unknown>;
}

/** Model-visible shape engines derive their tool lists from. */
export interface GatewayToolDefinitionView {
  name: string;
  level: ToolBehaviorLevel;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GatewaySessionOptions {
  runId: string;
  butler?: ButlerToolContext;
  /** Receives approval/tool events; wired to the run's event stream by the controller. */
  emit(event: EngineEvent): void;
  budget?: RunBudget;
  signal?: AbortSignal;
}

export interface GatewayRunSession extends RuntimeToolHandle {
  readonly runId: string;
  /** Client verb target: resolves the oldest pending approval; false when none is pending. */
  decide(decision: 'approved' | 'rejected'): boolean;
  /** Controller-side cancel: refuses any further work and resolves pending approvals as cancelled. */
  abortPending(): void;
}

interface PendingApproval {
  invocationId: string;
  tool: string;
  resolve(decision: 'approved' | 'rejected'): void;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Mirrors the legacy `executeButlerTool` argument normalization (model args may arrive JSON-encoded). */
function normalizeArguments(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return normalizeArguments(parsed);
    } catch {
      throw new Error('工具参数不是合法的 JSON。');
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('工具参数必须是一个对象。');
  }
  return value as Record<string, unknown>;
}

/** Deterministic key material: same parameters must always hash to the same key. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * 去重键（验收 5）：仅对确认级（写入类）调用，`runId + 工具名 + 参数 + 项目范围`。
 * 「范围」取参数里的 workspaceId（没有则视为运行级作用域）——同参同范围才算同一次写入。
 */
function dedupKey(runId: string, tool: string, args: Record<string, unknown>): string {
  const scope = typeof args['workspaceId'] === 'string' ? args['workspaceId'] : '';
  return `${runId}\u0000${tool}\u0000${canonicalJson(args)}\u0000${scope}`;
}

export class ToolGateway {
  private readonly entries = new Map<string, GatewayToolEntry>();
  /** runId → keys of already-committed write calls (验收 5: committed-only dedup). */
  private readonly committedKeys = new Map<string, Set<string>>();

  /** Registers one tool. Duplicate names and undeclared levels are programming errors → throw. */
  register(entry: GatewayToolEntry): void {
    if (typeof entry.name !== 'string' || entry.name === '') {
      throw new Error('网关工具注册缺少 name。');
    }
    if (this.entries.has(entry.name)) {
      throw new Error(`工具已注册：${entry.name}`);
    }
    if (
      typeof entry.level !== 'string' ||
      !TOOL_BEHAVIOR_LEVELS.includes(entry.level as ToolBehaviorLevel)
    ) {
      throw new Error(`工具 ${entry.name} 未声明合法行为级（query/confirm）。`);
    }
    this.entries.set(entry.name, entry);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  entry(name: string): GatewayToolEntry | undefined {
    return this.entries.get(name);
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  definitions(): GatewayToolDefinitionView[] {
    return [...this.entries.values()].map((entry) => ({
      name: entry.name,
      level: entry.level,
      description: entry.description,
      parameters: entry.parameters
    }));
  }

  /** Drops dedup state of a finished run (dedup is a per-run semantic). */
  purgeRun(runId: string): void {
    this.committedKeys.delete(runId);
  }

  createSession(options: GatewaySessionOptions): GatewayRunSession {
    const { runId } = options;
    let invocationCounter = 0;
    let executedCalls = 0;
    let aborted = false;
    let pending: PendingApproval | null = null;
    const committed = this.committedKeys;
    if (!committed.has(runId)) committed.set(runId, new Set<string>());
    const registry = this.entries;

    const refuse = (
      tool: string,
      invocationId: string,
      reason: ToolFailureReason,
      error: string,
      options_: { emitEvent?: boolean } = {}
    ): ToolInvocationOutcome => {
      if (options_.emitEvent !== false) {
        options.emit({
          type: 'tool.failed',
          invocationId,
          tool,
          reason,
          error
        });
      }
      return { ok: false, error, reason, invocationId };
    };

    const session: GatewayRunSession = {
      runId,
      decide(decision): boolean {
        const current = pending;
        if (!current) return false;
        pending = null;
        current.resolve(decision);
        return true;
      },
      abortPending(): void {
        aborted = true;
        const current = pending;
        pending = null;
        current?.resolve('rejected');
      },
      async invoke(name, rawArgs) {
        const invocationId = `${runId}#${(invocationCounter += 1)}`;
        const tool = registry.get(name);
        if (!tool) {
          // 验收 4：未注册工具必须得到错误回执，而不是静默忽略。
          return refuse(name, invocationId, 'unknown-tool', `未知工具：${name}`);
        }
        if (
          typeof tool.level !== 'string' ||
          !TOOL_BEHAVIOR_LEVELS.includes(tool.level as ToolBehaviorLevel)
        ) {
          // 验收 4：未声明行为级的工具同样拒绝。
          return refuse(name, invocationId, 'undeclared-level', `工具 ${name} 未声明行为级。`);
        }
        if (aborted || options.signal?.aborted) {
          return refuse(name, invocationId, 'cancelled', '运行已取消，不再执行工具。', {
            emitEvent: false
          });
        }
        if (!options.butler) {
          return refuse(name, invocationId, 'failed', '本次运行未接入工具执行上下文。');
        }
        if (tool.level === 'confirm' && options.butler.permissions?.write === false) {
          // Permission gate kept at parity with the legacy `executeButlerTool`.
          return refuse(
            name,
            invocationId,
            'permission',
            '当前是「仅可查看」权限，不能修改学习库。请让用户切到「项目内修改」后再试。'
          );
        }
        let args: Record<string, unknown>;
        try {
          args = normalizeArguments(rawArgs ?? {});
        } catch (error) {
          return refuse(name, invocationId, 'failed', describeError(error));
        }
        if (tool.level === 'confirm') {
          const keys = committed.get(runId) as Set<string>;
          const key = dedupKey(runId, name, args);
          if (keys.has(key)) {
            // 验收 5：已提交的同参同范围调用再出现 → 拒（失败后的重试不在键里 → 放行）。
            return refuse(
              name,
              invocationId,
              'duplicate',
              `重复调用已提交的工具：${name}（同一运行中相同参数只会执行一次）`
            );
          }
        }
        const maxToolCalls = options.budget?.maxToolCalls;
        if (typeof maxToolCalls === 'number' && executedCalls >= maxToolCalls) {
          return refuse(name, invocationId, 'budget', '本次运行的工具调用预算已用尽。');
        }

        if (tool.level === 'confirm') {
          // 审批绑定这一次操作 + 项目 + 参数：没有批准缓存，参数变了就是新审批。
          const decision = await new Promise<'approved' | 'rejected'>((resolve) => {
            pending = {
              invocationId,
              tool: name,
              resolve
            };
            options.emit({
              type: 'approval.requested',
              invocationId,
              tool: name,
              params: args
            });
          });
          pending = null;
          if (aborted || options.signal?.aborted) {
            return refuse(name, invocationId, 'cancelled', '运行已取消，不再执行工具。', {
              emitEvent: false
            });
          }
          if (decision === 'rejected') {
            return refuse(name, invocationId, 'rejected', `用户未批准调用 ${name}。`);
          }
        }

        executedCalls += 1;
        try {
          const result = await tool.execute(args, options.butler);
          if (options.signal?.aborted || aborted) {
            // Cancel may land while a slow tool is in flight: the service may
            // have run, but without a post-cancel receipt there is no commit.
            return refuse(name, invocationId, 'cancelled', '已取消，未提交。', {
              emitEvent: false
            });
          }
          if (tool.level === 'confirm') {
            (committed.get(runId) as Set<string>).add(dedupKey(runId, name, args));
          }
          options.emit({ type: 'tool.committed', invocationId, tool: name });
          return { ok: true, result, invocationId };
        } catch (error) {
          // 验收 5：失败不进去重键——同参重试放行。失败回执进事件流（模型可见）。
          return refuse(name, invocationId, 'failed', describeError(error));
        }
      }
    };
    return session;
  }
}
