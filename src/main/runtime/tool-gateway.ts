import type { ButlerToolContext } from '../butler/tools';
import { BUTLER_REFERENCE_LABELS, type ButlerReference } from '../../shared/butler-stream';
import type {
  ApprovalCandidate,
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

/** 审批候选形状 = 契约里的 `ApprovalCandidate`（网关与引擎共用一张表）。 */
export type GatewayApprovalCandidate = ApprovalCandidate;

/**
 * 同名歧义探测（验收 17）：确认级工具可在批准前声明一个候选探测钩子。返回
 * 多于一个候选 → 审批事件附带候选、批准必须带选择；返回 null/≤1 个 → 照常
 * 审批。钩子抛错按工具失败处理（不静默放行）。网关不解释候选的业务含义，
 * 只在批准带选择时把选中 id pin 回参数 `id`（见 invoke 内的候选选择语义）。
 */
export type ApprovalCandidatesProbe = (
  input: Record<string, unknown>,
  context: ButlerToolContext
) => Promise<GatewayApprovalCandidate[] | null> | GatewayApprovalCandidate[] | null;

/** One registry entry. `level` is mandatory: a tool without a declared behavior level must be refused at call time. */
export interface GatewayToolEntry {
  name: string;
  level: ToolBehaviorLevel;
  description: string;
  parameters: Record<string, unknown>;
  execute(input: Record<string, unknown>, context: ButlerToolContext): Promise<unknown>;
  approvalCandidates?: ApprovalCandidatesProbe;
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
  /** 只读运行（验收 22）：确认级（写入类）调用一律拒绝，记 tool.failed。 */
  readOnly?: boolean;
}

export interface GatewayRunSession extends RuntimeToolHandle {
  readonly runId: string;
  /**
   * Client verb target: resolves the oldest pending approval; false when none is pending.
   * `selection` only applies when the approval carried candidates (验收 17): the
   * approval is pinned to that candidate id; an unknown id keeps the approval pending.
   */
  decide(decision: 'approved' | 'rejected', options?: { selection?: string }): boolean;
  /** Controller-side cancel: refuses any further work and resolves pending approvals as cancelled. */
  abortPending(): void;
}

interface PendingApproval {
  invocationId: string;
  tool: string;
  /** 候选 id 集合；null = 本次审批无候选（不需选择）。 */
  candidateIds: Set<string> | null;
  /** 批准带候选时 resolve 附带选中 id（invoke 侧 pin 回参数）。 */
  resolve(decision: 'approved' | 'rejected', selection?: string): void;
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

/**
 * Schema 层拒绝未声明参数（验收 23：旧 `resolve_commitment` 携带 `newDue` 的
 * 旁路必须被拒）。工具 schema 声明 `additionalProperties: false` 时，出现
 * `properties` 之外的参数即拒；`additionalProperties: true` 或未声明则放行。
 * 只校验顶层键——嵌套对象的 schema 由工具执行体自行校验（与旧执行器一致）。
 */
function undeclaredArguments(tool: GatewayToolEntry, args: Record<string, unknown>): string | null {
  const schema = tool.parameters;
  const declared = schema['properties'];
  if (typeof declared !== 'object' || declared === null) return null;
  if (schema['additionalProperties'] !== false) return null;
  const allowed = new Set(Object.keys(declared as Record<string, unknown>));
  for (const key of Object.keys(args)) {
    if (args[key] === undefined) continue;
    if (!allowed.has(key)) return key;
  }
  return null;
}

/** `references` 结果提取：仅当工具返回值是对象且携带合法的 references 数组。 */
function referencesOf(result: unknown): ButlerReference[] | null {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return null;
  const raw = (result as { references?: unknown }).references;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const items: ButlerReference[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    const id = record['id'];
    const kind = record['kind'];
    const title = record['title'];
    if (typeof id !== 'string' || typeof title !== 'string') return null;
    if (typeof kind !== 'string' || !(kind in BUTLER_REFERENCE_LABELS)) return null;
    items.push(entry as ButlerReference);
  }
  return items;
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
      decide(decision, options_): boolean {
        const current = pending;
        if (!current) return false;
        // 候选审批（验收 17）：批准必须选中一个候选；未选择/未知 id → 仍待选，
        // 不落盘。选中 id 直接写入本次调用参数（批准本身带着选择 resolve）。
        if (decision === 'approved' && current.candidateIds) {
          const selection = options_?.selection;
          if (typeof selection !== 'string' || !current.candidateIds.has(selection)) return false;
          pending = null;
          current.resolve(decision, selection);
          return true;
        }
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
        if (tool.level === 'confirm' && options.readOnly) {
          // 验收 22（场景三）：只读运行的任何写入类调用都被拒，记 tool.failed。
          return refuse(
            name,
            invocationId,
            'permission',
            '本次运行只读，不能修改学习库。'
          );
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
        const undeclared = undeclaredArguments(tool, args);
        if (undeclared !== null) {
          // 验收 23：JSON Schema 声明 additionalProperties:false 时，多余参数即拒
          // ——旧 resolve_commitment 携带 newDue 的旁路在此被堵死（不写盘）。
          return refuse(
            name,
            invocationId,
            'unknown-arg',
            `工具 ${name} 不接受参数「${undeclared}」。`
          );
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
          // 同名歧义（验收 17）：批准前探测候选；多于一个 → 审批附带候选，批准
          // 必须选中一个，选中 id pin 回本次调用的参数 `id`（选择进入去重键与
          // 审计参数，不可经旧工具调用替代）。
          let candidates: GatewayApprovalCandidate[] | null = null;
          if (tool.approvalCandidates) {
            try {
              const probed = await tool.approvalCandidates(args, options.butler);
              if (Array.isArray(probed) && probed.length > 1) candidates = probed;
            } catch (error) {
              return refuse(name, invocationId, 'failed', describeError(error));
            }
          }
          // 审批绑定这一次操作 + 项目 + 参数：没有批准缓存，参数变了就是新审批。
          const decided = await new Promise<{
            decision: 'approved' | 'rejected';
            selection?: string;
          }>((resolveDecision) => {
            pending = {
              invocationId,
              tool: name,
              candidateIds: candidates
                ? new Set(candidates.map((candidate) => candidate.id))
                : null,
              resolve: (decision, selection) => resolveDecision({ decision, selection })
            };
            options.emit({
              type: 'approval.requested',
              invocationId,
              tool: name,
              params: args,
              ...(candidates ? { candidates } : {})
            });
          });
          pending = null;
          if (aborted || options.signal?.aborted) {
            return refuse(name, invocationId, 'cancelled', '运行已取消，不再执行工具。', {
              emitEvent: false
            });
          }
          if (decided.decision === 'rejected') {
            return refuse(name, invocationId, 'rejected', `用户未批准调用 ${name}。`);
          }
          if (decided.selection !== undefined) {
            // 候选选择进入执行参数：工具据此定位到被选中的记录（验收 17）。
            // 选择改变了最终参数（id pin）→ 去重键随之改变，必须在执行前按最终
            // 参数再查一次，否则「选中同一候选」重复调用会绕过早先的检查。
            args = { ...args, id: decided.selection };
            const keys = committed.get(runId) as Set<string>;
            if (keys.has(dedupKey(runId, name, args))) {
              return refuse(
                name,
                invocationId,
                'duplicate',
                `重复调用已提交的工具：${name}（同一运行中相同参数与选择只会执行一次）`
              );
            }
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
          // 缝④：工具返回值携带合法 references 数组 → 发 references 事件
          // （两条引擎路径同一缝，引擎侧不再重复映射）。
          const references = referencesOf(result);
          if (references) {
            options.emit({ type: 'references', items: references });
          }
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
