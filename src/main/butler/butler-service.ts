import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
  ButlerService,
  SendMessageInput,
  SendMessageResult,
  WorkspaceService
} from '../../shared/workspace';
import type {
  Conversation,
  ConversationMessage,
  ConversationStep
} from '../../shared/conversations';
import type { KnowledgeService } from '../../shared/knowledge';
import type { MemoryService } from '../../shared/memory';
import type { WorkspacePlanner } from '../../shared/planning';
import type { ButlerStreamListener } from '../../shared/butler-stream';
import { butlerToolLabel } from '../../shared/butler-stream';
import type {
  ModelClient,
  ModelMessage,
  ModelResponse,
  ModelToolCall,
  ModelUsage
} from '../agent/model-client';
import { supportsStreaming } from '../agent/model-client';
import { redactSecrets } from '../ipc';
import {
  classifyModelError,
  ModelRetryError,
  runWithModelRetry,
  type ModelErrorKind
} from '../agent/model-retry';
import type { ConversationStore } from '../conversations/conversation-store';
import { gatherContext, type ButlerContext } from './context';
import { buildSystemPrompt, buildUserPrompt } from './prompt';
import { buildTemplateReply, type TemplateOptions } from './template';
import {
  createButlerTools,
  executeButlerTool,
  toModelToolDefinitions,
  type ButlerToolDefinition,
  type ButlerToolResult
} from './tools';

/** Unsummarized history beyond this count is compressed before the turn. */
const SUMMARY_TRIGGER = 24;
/** The newest messages always stay verbatim for local coherence. */
const SUMMARY_KEEP_RECENT = 12;
/** Cap one summarization request; later turns summarize the next slice. */
const SUMMARY_CHUNK = 60;
const SUMMARY_LIMIT = 1500;
const SUMMARY_PROMPT = `你是阿咲的对话摘要器。把给出的历史对话压缩成一段中文摘要，保留仍然有用的信息：用户的目标与偏好、已确认的事实、未完成的任务、卡点与已做出的决定。不要寒暄，不要编造，不要逐条复述，控制在 300 字以内。如果提供了“现有摘要”，请在此基础上合并更新，不要丢掉仍然有效的旧信息。`;

export interface ButlerServiceOptions {
  /** Injected vault-backed workspace service; null keeps the butler read-only. */
  workspaceService?: WorkspaceService | null;
  /** Vault root used as the cwd for native local-CLI agents. */
  workspaceRoot?: string;
  /** Injected model client. Null means template replies only (e.g. no API key). */
  modelClient?: ModelClient | null;
  /** Builds a client for a conversation-level model override; null falls back. */
  modelClientFor?: (model: string) => ModelClient | null;
  /** Retry policy for model calls; defaults to one retry after 300ms. */
  modelRetry?: { attempts?: number; delayMs?: number };
  /** Optional conversation persistence. Null keeps send/stream stateless. */
  conversationStore?: ConversationStore | null;
  memoryService?: MemoryService | null;
  planner?: WorkspacePlanner | null;
  knowledgeService?: KnowledgeService | null;
  now?: () => Date;
  /** Maximum number of tool-call rounds before the butler stops. */
  maxToolSteps?: number;
  temperature?: number;
  maxTokens?: number;
}

const DEFAULT_MAX_TOOL_STEPS = 4;

export class ButlerServiceImpl implements ButlerService {
  private readonly workspaceService: WorkspaceService | null;
  private readonly workspaceRoot: string | null;
  private readonly modelClient: ModelClient | null;
  private readonly modelClientFor: ((model: string) => ModelClient | null) | null;
  private readonly modelRetry: { attempts: number; delayMs: number };
  private readonly conversationStore: ConversationStore | null;
  private readonly memoryService: MemoryService | null;
  private readonly planner: WorkspacePlanner | null;
  private readonly knowledgeService: KnowledgeService | null;
  private readonly now: () => Date;
  private readonly maxToolSteps: number;
  private readonly temperature: number | undefined;
  private readonly maxTokens: number | undefined;
  private readonly tools: ButlerToolDefinition[];

  constructor(options: ButlerServiceOptions = {}) {
    this.workspaceService = options.workspaceService ?? null;
    this.workspaceRoot = options.workspaceRoot ?? null;
    this.modelClient = options.modelClient ?? null;
    this.modelClientFor = options.modelClientFor ?? null;
    this.modelRetry = {
      attempts: options.modelRetry?.attempts ?? 2,
      delayMs: options.modelRetry?.delayMs ?? 300
    };
    this.conversationStore = options.conversationStore ?? null;
    this.memoryService = options.memoryService ?? null;
    this.planner = options.planner ?? null;
    this.knowledgeService = options.knowledgeService ?? null;
    this.now = options.now ?? (() => new Date());
    this.maxToolSteps = Math.max(
      0,
      Math.floor(options.maxToolSteps ?? DEFAULT_MAX_TOOL_STEPS)
    );
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
    this.tools = createButlerTools();
  }

  async send(input: SendMessageInput): Promise<SendMessageResult> {
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    const conversation = await this.resolveConversation(input);
    const client = this.clientFor(conversation);
    const effectiveInput = this.effectiveInput(input, conversation);
    const context = await gatherContext(
      this.workspaceService,
      effectiveInput,
      this.now(),
      this.knowledgeService
    );
    const cwd = this.cwdFor(context);

    if (!message) {
      const text = buildTemplateReply(context, input, { reason: 'empty-message' });
      await this.persistAssistant(conversation, input, text, []);
      return { text, ...(conversation ? { conversationId: conversation.id } : {}) };
    }

    if (!client) {
      const text = buildTemplateReply(context, input, { reason: 'no-key' });
      await this.persistAssistant(conversation, input, text, []);
      return { text, ...(conversation ? { conversationId: conversation.id } : {}) };
    }

    const summaryUsage = await this.maybeSummarize(conversation, client);
    const messages = this.buildModelMessages(context, conversation, input);
    const steps: ConversationStep[] = [];
    let usage = summaryUsage;
    let lastText = '';
    let lastToolFailure: string | undefined;
    let retried = false;

    try {
      for (let stepIndex = 0; stepIndex <= this.maxToolSteps; stepIndex += 1) {
        const outcome = await runWithModelRetry(
          () => this.complete(messages, undefined, client, true, cwd),
          { attempts: this.modelRetry.attempts, delayMs: this.modelRetry.delayMs }
        );
        if (outcome.attempts > 1) retried = true;
        const response = outcome.value;
        usage = sumUsage(usage, response.usage);
        if (response.text.trim()) lastText = response.text.trim();

        const toolCalls = response.toolCalls ?? [];
        if (toolCalls.length === 0) {
          const text = lastText || '我暂时没有整理出回复，请再试一次。';
          await this.persistAssistant(conversation, input, text, steps);
          return {
            text,
            ...(usage ? { usage } : {}),
            ...(conversation ? { conversationId: conversation.id } : {})
          };
        }

        if (stepIndex === this.maxToolSteps) {
          const text = buildTemplateReply(context, input, { reason: 'tool-limit' });
          await this.persistAssistant(conversation, input, text, steps);
          return {
            text,
            ...(usage ? { usage } : {}),
            ...(conversation ? { conversationId: conversation.id } : {})
          };
        }

        messages.push({
          role: 'assistant',
          content: response.text,
          toolCalls
        });

        for (const call of toolCalls) {
          const step = this.startToolStep(call, steps);
          const result = await this.runTool(call, context);
          if (!result.ok) lastToolFailure = call.name;
          this.finishToolStep(step, result);
          await this.linkCreatedWorkspace(call, result, context, conversation);
          messages.push({
            role: 'tool',
            content: result.content,
            toolCallId: call.id,
            toolName: call.name
          });
        }
      }
    } catch (error) {
      const attempts = error instanceof ModelRetryError ? error.attempts : 1;
      const wasRetried = retried || attempts > 1;
      const fallback = this.failureResult(
        context,
        input,
        usage,
        lastToolFailure,
        wasRetried
      );
      await this.persistAssistant(conversation, input, fallback.text, steps);
      return { ...fallback, ...(conversation ? { conversationId: conversation.id } : {}) };
    }

    const text = lastText || buildTemplateReply(context, input, { reason: 'tool-limit' });
    await this.persistAssistant(conversation, input, text, steps);
    return {
      text,
      ...(usage ? { usage } : {}),
      ...(conversation ? { conversationId: conversation.id } : {})
    };
  }

  async stream(
    input: SendMessageInput,
    onEvent: ButlerStreamListener,
    options: { signal?: AbortSignal } = {}
  ): Promise<SendMessageResult> {
    const signal = options.signal;
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    const conversation = await this.resolveConversation(input);
    const client = this.clientFor(conversation);
    const effectiveInput = this.effectiveInput(input, conversation);
    const context = await gatherContext(
      this.workspaceService,
      effectiveInput,
      this.now(),
      this.knowledgeService
    );
    const cwd = this.cwdFor(context);

    if (!message) {
      const text = buildTemplateReply(context, input, { reason: 'empty-message' });
      await this.persistAssistant(conversation, input, text, []);
      onEvent({ type: 'text', text });
      onEvent({ type: 'done', text });
      return { text, ...(conversation ? { conversationId: conversation.id } : {}) };
    }

    if (!client) {
      const text = buildTemplateReply(context, input, { reason: 'no-key' });
      await this.persistAssistant(conversation, input, text, []);
      onEvent({ type: 'text', text });
      onEvent({ type: 'done', text });
      return { text, ...(conversation ? { conversationId: conversation.id } : {}) };
    }

    const summaryUsage = await this.maybeSummarize(conversation, client, signal);
    throwIfAborted(signal);
    const messages = this.buildModelMessages(context, conversation, input);
    const steps: ConversationStep[] = [];
    let usage = summaryUsage;
    let lastToolFailure: string | undefined;
    let streamedSoFar = '';
    let retried = false;

    const finish = async (text: string): Promise<SendMessageResult> => {
      await this.persistAssistant(conversation, input, text, steps);
      onEvent({ type: 'done', text, ...(usage ? { usage } : {}) });
      return {
        text,
        ...(usage ? { usage } : {}),
        ...(conversation ? { conversationId: conversation.id } : {})
      };
    };

    try {
      for (let stepIndex = 0; stepIndex <= this.maxToolSteps; stepIndex += 1) {
        throwIfAborted(signal);
        let attemptEmitted = false;
        let response: ModelResponse;
        let streamedText = false;
        let streamedTextContent = '';

        const outcome = await runWithModelRetry(
          () => {
            attemptEmitted = false;
            if (supportsStreaming(client)) {
              return client.stream(
                this.buildRequest(messages, signal, cwd),
                (event) => {
                  attemptEmitted = true;
                  if (event.type === 'reasoning') {
                    onEvent({ type: 'reasoning', text: event.text });
                  } else {
                    streamedText = true;
                    streamedTextContent += event.text;
                    streamedSoFar += event.text;
                    onEvent({ type: 'text', text: event.text });
                  }
                }
              );
            }
            return this.complete(messages, signal, client, true, cwd);
          },
          {
            attempts: this.modelRetry.attempts,
            delayMs: this.modelRetry.delayMs,
            signal,
            shouldRetry: () => !attemptEmitted,
            onRetry: ({ attempt }) => {
              retried = true;
              onEvent({ type: 'retry', attempt, message: '模型连接失败，正在重试…' });
            }
          }
        );
        if (outcome.attempts > 1) retried = true;
        response = outcome.value;
        throwIfAborted(signal);

        usage = sumUsage(usage, response.usage);
        const toolCalls = response.toolCalls ?? [];

        if (toolCalls.length === 0) {
          const text =
            (response.text.trim() || streamedTextContent.trim()) ||
            '我暂时没有整理出回复，请再试一次。';
          if (!streamedText && text) {
            onEvent({ type: 'text', text });
          }
          return await finish(text);
        }

        if (stepIndex === this.maxToolSteps) {
          return await finish(buildTemplateReply(context, input, { reason: 'tool-limit' }));
        }

        if (response.text.trim() && !streamedText) {
          onEvent({ type: 'narration', text: response.text.trim() });
        }

        messages.push({
          role: 'assistant',
          content: response.text,
          toolCalls
        });

        for (const call of toolCalls) {
          throwIfAborted(signal);
          const step = this.startToolStep(call, steps);
          onEvent({ type: 'tool-start', id: call.id, name: call.name, label: step.label });
          const result = await this.runTool(call, context, signal);
          if (!result.ok) {
            lastToolFailure = call.name;
          }
          this.finishToolStep(step, result);
          onEvent({
            type: 'tool-result',
            id: call.id,
            name: call.name,
            ok: result.ok,
            label: step.label,
            ...(step.detail ? { detail: step.detail } : {})
          });
          await this.linkCreatedWorkspace(call, result, context, conversation);
          messages.push({
            role: 'tool',
            content: result.content,
            toolCallId: call.id,
            toolName: call.name
          });
        }
      }
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        const text = streamedSoFar.trim() || '（已停止生成）';
        await this.persistAssistant(conversation, input, text, steps);
        onEvent({
          type: 'done',
          text,
          canceled: true,
          ...(usage ? { usage } : {})
        });
        return {
          text,
          ...(usage ? { usage } : {}),
          ...(conversation ? { conversationId: conversation.id } : {})
        };
      }
      const kind = classifyModelError(error, signal);
      const attempts = error instanceof ModelRetryError ? error.attempts : 1;
      const wasRetried = retried || attempts > 1;
      const detail = redactSecrets(error instanceof Error ? error.message : String(error));
      onEvent({
        type: 'error',
        message: describeModelError(kind, wasRetried, detail)
      });
      if (streamedSoFar.trim()) {
        const text = `${streamedSoFar.trim()}\n\n（模型连接中断，以上内容可能不完整。）`;
        await this.persistAssistant(conversation, input, text, steps);
        onEvent({ type: 'done', text, ...(usage ? { usage } : {}) });
        return {
          text,
          ...(usage ? { usage } : {}),
          ...(conversation ? { conversationId: conversation.id } : {})
        };
      }
      const fallback = this.failureResult(context, input, usage, lastToolFailure, wasRetried);
      await this.persistAssistant(conversation, input, fallback.text, steps);
      onEvent({
        type: 'done',
        text: fallback.text,
        ...(fallback.usage ? { usage: fallback.usage } : {})
      });
      return { ...fallback, ...(conversation ? { conversationId: conversation.id } : {}) };
    }

    return await finish(
      buildTemplateReply(context, input, {
        reason: lastToolFailure ? 'tool-error' : 'tool-limit',
        ...(lastToolFailure ? { toolName: lastToolFailure } : {})
      })
    );
  }

  /** Conversation override first; any failure falls back to the default client. */
  private clientFor(conversation: Conversation | null): ModelClient | null {
    const override = conversation?.model?.trim();
    if (!override || !this.modelClientFor) return this.modelClient;
    try {
      return this.modelClientFor(override) ?? this.modelClient;
    } catch {
      return this.modelClient;
    }
  }

  private async resolveConversation(input: SendMessageInput): Promise<Conversation | null> {
    if (!this.conversationStore || !input.conversationId) return null;
    const conversation = await this.conversationStore.get(input.conversationId);
    if (!conversation) throw new Error('对话不存在。');
    return conversation;
  }

  private effectiveInput(
    input: SendMessageInput,
    conversation: Conversation | null
  ): SendMessageInput {
    const workspaceId = conversation?.workspaceId ?? input.workspaceId;
    return {
      ...input,
      ...(workspaceId ? { workspaceId } : {})
    };
  }

  private buildModelMessages(
    context: ButlerContext,
    conversation: Conversation | null,
    input: SendMessageInput
  ): ModelMessage[] {
    const summary = conversation?.summary?.trim();
    const system = summary
      ? `${buildSystemPrompt(context)}\n\n## 此前对话摘要\n${summary}\n（更早的消息已压缩在这里；最近的消息仍以原文为准。）`
      : buildSystemPrompt(context);
    return [
      { role: 'system', content: system },
      ...(conversation ? this.historyBefore(conversation, input.message.trim()) : []),
      { role: 'user', content: buildUserPrompt(input) }
    ];
  }

  private historyBefore(conversation: Conversation, current: string): ModelMessage[] {
    const messages = conversation.messages;
    const first = Math.min(conversation.summaryCount ?? 0, messages.length);
    const last = messages[messages.length - 1];
    const end =
      last && last.role === 'user' && last.text.trim() === current
        ? messages.length - 1
        : messages.length;
    const prior = messages.slice(first, end);
    const selected: ModelMessage[] = [];
    let chars = 0;
    for (let index = prior.length - 1; index >= 0; index -= 1) {
      const message = prior[index]!;
      if (message.role !== 'user' && message.role !== 'assistant') continue;
      const content = message.text.trim();
      if (!content) continue;
      if (selected.length >= 20 || chars + content.length > 12_000) break;
      selected.unshift({ role: message.role, content });
      chars += content.length;
    }
    return selected;
  }

  /**
   * Compresses the oldest uncompressed messages into a rolling summary. Runs
   * before the turn's model call and silently skips on failure, so a summary
   * problem never blocks the reply. Only one bounded slice is summarized per
   * turn; a very long conversation catches up over several turns.
   */
  private async maybeSummarize(
    conversation: Conversation | null,
    client: ModelClient,
    signal?: AbortSignal
  ): Promise<ModelUsage | undefined> {
    if (!this.conversationStore || !conversation) return undefined;
    const covered = Math.min(conversation.summaryCount ?? 0, conversation.messages.length);
    const pending = conversation.messages.length - covered;
    if (pending <= SUMMARY_TRIGGER) return undefined;
    const end = conversation.messages.length - SUMMARY_KEEP_RECENT;
    if (end <= covered) return undefined;
    const chunk = conversation.messages
      .slice(covered, Math.min(covered + SUMMARY_CHUNK, end))
      .filter((message) => message.text.trim().length > 0);
    if (chunk.length === 0) return undefined;

    const messages: ModelMessage[] = [
      { role: 'system', content: SUMMARY_PROMPT },
      ...(conversation.summary
        ? [{ role: 'assistant' as const, content: `现有摘要：\n${conversation.summary}` }]
        : []),
      ...chunk.map((message) => ({ role: message.role, content: message.text })),
      { role: 'user', content: '请输出更新后的摘要。' }
    ];

    try {
      const response = await this.complete(messages, signal, client, false);
      const summary = Array.from(response.text.trim())
        .slice(0, SUMMARY_LIMIT)
        .join('');
      if (!summary) return response.usage;
      const updated = await this.conversationStore.update(conversation.id, (current) => ({
        ...current,
        summary,
        summaryCount: Math.min(covered + SUMMARY_CHUNK, end)
      }));
      conversation.summary = updated.summary;
      conversation.summaryCount = updated.summaryCount;
      return response.usage;
    } catch (error) {
      if (signal?.aborted) throw error;
      return undefined;
    }
  }

  private async persistAssistant(
    conversation: Conversation | null,
    input: SendMessageInput,
    text: string,
    steps: ConversationStep[]
  ): Promise<void> {
    if (!this.conversationStore || !conversation) return;
    const message: ConversationMessage = {
      id: input.assistantMessageId?.trim() || randomUUID(),
      role: 'assistant',
      text,
      createdAt: this.now().toISOString(),
      ...(steps.length > 0 ? { steps: steps.map((step) => ({ ...step })) } : {}),
      source: 'butler'
    };
    await this.conversationStore.appendMessage(conversation.id, message);
  }

  private startToolStep(call: ModelToolCall, steps: ConversationStep[]): ConversationStep {
    const step: ConversationStep = {
      id: call.id,
      name: call.name,
      label: butlerToolLabel(call.name),
      status: 'running'
    };
    steps.push(step);
    return step;
  }

  private finishToolStep(step: ConversationStep, result: ButlerToolResult): void {
    step.status = result.ok ? 'done' : 'failed';
    if (!result.ok) {
      step.detail = redactSecrets(errorDetailFromToolResult(result.content));
    }
  }

  private async linkCreatedWorkspace(
    call: ModelToolCall,
    result: ButlerToolResult,
    context: ButlerContext,
    conversation: Conversation | null
  ): Promise<void> {
    if (call.name !== 'create_workspace' || !result.ok) return;
    const workspaceId = workspaceIdFromToolResult(result.content);
    if (!workspaceId) return;
    context.workspaceId = workspaceId;
    if (conversation && this.conversationStore) {
      await this.conversationStore.linkWorkspace(conversation.id, workspaceId);
      conversation.workspaceId = workspaceId;
    }
  }

  private buildRequest(
    messages: ModelMessage[],
    signal?: AbortSignal,
    cwd?: string
  ) {
    return {
      messages,
      ...(this.workspaceService
        ? { tools: toModelToolDefinitions(this.tools) }
        : {}),
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      ...(this.maxTokens !== undefined ? { maxTokens: this.maxTokens } : {}),
      ...(cwd ? { cwd } : {}),
      ...(signal ? { signal } : {})
    };
  }

  private async complete(
    messages: ModelMessage[],
    signal: AbortSignal | undefined,
    client: ModelClient,
    withTools = true,
    cwd?: string
  ): Promise<ModelResponse> {
    const request = this.buildRequest(messages, signal, cwd);
    if (!withTools) delete request.tools;
    return client.complete(request);
  }

  /** Native CLI agents run inside the current workspace, or the vault root. */
  private cwdFor(context: ButlerContext): string | undefined {
    if (!this.workspaceRoot) return undefined;
    if (context.workspaceId && /^[A-Za-z0-9_-]+$/.test(context.workspaceId)) {
      const dir = join(this.workspaceRoot, 'workspaces', context.workspaceId);
      if (existsSync(dir)) return dir;
    }
    return this.workspaceRoot;
  }

  private async runTool(
    call: { id: string; name: string; arguments: unknown },
    context: ButlerContext,
    signal?: AbortSignal
  ): Promise<ButlerToolResult> {
    if (!this.workspaceService) {
      return {
        ok: false,
        content: JSON.stringify({
          ok: false,
          tool: call.name,
          error: '本地工作区服务未连接，无法执行工具。'
        })
      };
    }
    return executeButlerTool(call, this.tools, {
      workspace: this.workspaceService,
      workspaceId: context.workspaceId,
      memory: this.memoryService,
      planner: this.planner,
      knowledge: this.knowledgeService,
      now: this.now,
      ...(signal ? { signal } : {})
    });
  }

  private failureResult(
    context: ButlerContext,
    input: SendMessageInput,
    usage: ModelUsage | undefined,
    toolFailure: string | undefined,
    retried = false
  ): SendMessageResult {
    const options: TemplateOptions = toolFailure
      ? { reason: 'tool-error', toolName: toolFailure }
      : { reason: 'model-error', ...(retried ? { retried: true } : {}) };
    return {
      text: buildTemplateReply(context, input, options),
      ...(usage ? { usage } : {})
    };
  }
}

function describeModelError(
  kind: ModelErrorKind,
  retried: boolean,
  detail: string
): string {
  switch (kind) {
    case 'auth':
      return `模型认证失败，请检查 API Key 或 CLI 登录：${detail}`;
    case 'model':
      return `模型不可用，请检查全局设置或本对话模型：${detail}`;
    case 'transient':
      return retried
        ? `模型连接失败（已自动重试 1 次）：${detail}`
        : `模型调用失败：${detail}`;
    default:
      return `模型调用失败：${detail}`;
  }
}

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function workspaceIdFromToolResult(content: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    const result =
      typeof record['result'] === 'object' &&
      record['result'] !== null &&
      !Array.isArray(record['result'])
        ? (record['result'] as Record<string, unknown>)
        : record;
    const workspaceId = result['workspaceId'];
    return typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId : undefined;
  } catch {
    return undefined;
  }
}

function sumUsage(total: ModelUsage | undefined, next: ModelUsage): ModelUsage {
  return {
    inputTokens: (total?.inputTokens ?? 0) + next.inputTokens,
    outputTokens: (total?.outputTokens ?? 0) + next.outputTokens
  };
}

function errorDetailFromToolResult(content: string): string {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const error = (parsed as Record<string, unknown>)['error'];
      if (typeof error === 'string' && error.trim()) return error.trim();
    }
  } catch {
    // Fall through to the generic message.
  }
  return '工具执行失败。';
}
