import { randomUUID } from 'node:crypto';
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

export interface ButlerServiceOptions {
  /** Injected vault-backed workspace service; null keeps the butler read-only. */
  workspaceService?: WorkspaceService | null;
  /** Injected model client. Null means template replies only (e.g. no API key). */
  modelClient?: ModelClient | null;
  /** Builds a client for a conversation-level model override; null falls back. */
  modelClientFor?: (model: string) => ModelClient | null;
  /** Optional conversation persistence. Null keeps send/stream stateless. */
  conversationStore?: ConversationStore | null;
  memoryService?: MemoryService | null;
  planner?: WorkspacePlanner | null;
  now?: () => Date;
  /** Maximum number of tool-call rounds before the butler stops. */
  maxToolSteps?: number;
  temperature?: number;
  maxTokens?: number;
}

const DEFAULT_MAX_TOOL_STEPS = 4;

export class ButlerServiceImpl implements ButlerService {
  private readonly workspaceService: WorkspaceService | null;
  private readonly modelClient: ModelClient | null;
  private readonly modelClientFor: ((model: string) => ModelClient | null) | null;
  private readonly conversationStore: ConversationStore | null;
  private readonly memoryService: MemoryService | null;
  private readonly planner: WorkspacePlanner | null;
  private readonly now: () => Date;
  private readonly maxToolSteps: number;
  private readonly temperature: number | undefined;
  private readonly maxTokens: number | undefined;
  private readonly tools: ButlerToolDefinition[];

  constructor(options: ButlerServiceOptions = {}) {
    this.workspaceService = options.workspaceService ?? null;
    this.modelClient = options.modelClient ?? null;
    this.modelClientFor = options.modelClientFor ?? null;
    this.conversationStore = options.conversationStore ?? null;
    this.memoryService = options.memoryService ?? null;
    this.planner = options.planner ?? null;
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
    const context = await gatherContext(this.workspaceService, effectiveInput, this.now());

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

    const messages = this.buildModelMessages(context, conversation, input);
    const steps: ConversationStep[] = [];
    let usage: ModelUsage | undefined;
    let lastText = '';
    let lastToolFailure: string | undefined;

    try {
      for (let stepIndex = 0; stepIndex <= this.maxToolSteps; stepIndex += 1) {
        const response = await this.complete(messages, undefined, client);
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
    } catch {
      const fallback = this.failureResult(context, input, usage, lastToolFailure);
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
    const context = await gatherContext(this.workspaceService, effectiveInput, this.now());

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

    const messages = this.buildModelMessages(context, conversation, input);
    const steps: ConversationStep[] = [];
    let usage: ModelUsage | undefined;
    let lastToolFailure: string | undefined;
    let streamedSoFar = '';

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
        let response: ModelResponse;
        let streamedText = false;
        let streamedTextContent = '';

        if (supportsStreaming(client)) {
          response = await client.stream(
            this.buildRequest(messages, signal),
            (event) => {
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
        } else {
          response = await this.complete(messages, signal, client);
        }
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
          const result = await this.runTool(call, context);
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
      onEvent({
        type: 'error',
        message: redactSecrets(error instanceof Error ? error.message : String(error))
      });
      const fallback = this.failureResult(context, input, usage, lastToolFailure);
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
    return [
      { role: 'system', content: buildSystemPrompt(context) },
      ...(conversation ? this.historyBefore(conversation.messages, input.message.trim()) : []),
      { role: 'user', content: buildUserPrompt(input) }
    ];
  }

  private historyBefore(messages: ConversationMessage[], current: string): ModelMessage[] {
    const last = messages[messages.length - 1];
    const prior =
      last && last.role === 'user' && last.text.trim() === current
        ? messages.slice(0, -1)
        : messages;
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

  private buildRequest(messages: ModelMessage[], signal?: AbortSignal) {
    return {
      messages,
      ...(this.workspaceService
        ? { tools: toModelToolDefinitions(this.tools) }
        : {}),
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      ...(this.maxTokens !== undefined ? { maxTokens: this.maxTokens } : {}),
      ...(signal ? { signal } : {})
    };
  }

  private async complete(
    messages: ModelMessage[],
    signal: AbortSignal | undefined,
    client: ModelClient
  ): Promise<ModelResponse> {
    return client.complete(this.buildRequest(messages, signal));
  }

  private async runTool(
    call: { id: string; name: string; arguments: unknown },
    context: ButlerContext
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
      now: this.now
    });
  }

  private failureResult(
    context: ButlerContext,
    input: SendMessageInput,
    usage: ModelUsage | undefined,
    toolFailure: string | undefined
  ): SendMessageResult {
    const options: TemplateOptions = toolFailure
      ? { reason: 'tool-error', toolName: toolFailure }
      : { reason: 'model-error' };
    return {
      text: buildTemplateReply(context, input, options),
      ...(usage ? { usage } : {})
    };
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
