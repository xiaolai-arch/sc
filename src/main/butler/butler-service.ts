import type {
  ButlerService,
  SendMessageInput,
  SendMessageResult,
  WorkspaceService
} from '../../shared/workspace';
import type { ButlerStreamListener } from '../../shared/butler-stream';
import { butlerToolLabel } from '../../shared/butler-stream';
import type {
  ModelClient,
  ModelMessage,
  ModelResponse,
  ModelUsage
} from '../agent/model-client';
import { supportsStreaming } from '../agent/model-client';
import { redactSecrets } from '../ipc';
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
  private readonly now: () => Date;
  private readonly maxToolSteps: number;
  private readonly temperature: number | undefined;
  private readonly maxTokens: number | undefined;
  private readonly tools: ButlerToolDefinition[];

  constructor(options: ButlerServiceOptions = {}) {
    this.workspaceService = options.workspaceService ?? null;
    this.modelClient = options.modelClient ?? null;
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
    if (!message) {
      const context = await gatherContext(this.workspaceService, input, this.now());
      return { text: buildTemplateReply(context, input, { reason: 'empty-message' }) };
    }

    const context = await gatherContext(this.workspaceService, input, this.now());
    if (!this.modelClient) {
      return { text: buildTemplateReply(context, input, { reason: 'no-key' }) };
    }

    const messages: ModelMessage[] = [
      { role: 'system', content: buildSystemPrompt(context) },
      { role: 'user', content: buildUserPrompt(input) }
    ];

    let usage: ModelUsage | undefined;
    let lastText = '';
    let lastToolFailure: string | undefined;

    for (let step = 0; step <= this.maxToolSteps; step += 1) {
      let response: ModelResponse;
      try {
        response = await this.complete(messages);
      } catch {
        return this.failureResult(context, input, usage, lastToolFailure);
      }

      usage = sumUsage(usage, response.usage);
      if (response.text.trim()) {
        lastText = response.text.trim();
      }

      const toolCalls = response.toolCalls ?? [];
      if (toolCalls.length === 0) {
        return {
          text: lastText || '我暂时没有整理出回复，请再试一次。',
          usage
        };
      }

      if (step === this.maxToolSteps) {
        return {
          text: buildTemplateReply(context, input, { reason: 'tool-limit' }),
          usage
        };
      }

      messages.push({
        role: 'assistant',
        content: response.text,
        toolCalls
      });

      for (const call of toolCalls) {
        const result = await this.runTool(call, context);
        if (!result.ok) {
          lastToolFailure = call.name;
        }
        messages.push({
          role: 'tool',
          content: result.content,
          toolCallId: call.id,
          toolName: call.name
        });
      }
    }

    return {
      text: lastText || buildTemplateReply(context, input, { reason: 'tool-limit' }),
      usage
    };
  }

  async stream(
    input: SendMessageInput,
    onEvent: ButlerStreamListener
  ): Promise<SendMessageResult> {
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    if (!message) {
      const context = await gatherContext(this.workspaceService, input, this.now());
      const text = buildTemplateReply(context, input, { reason: 'empty-message' });
      onEvent({ type: 'text', text });
      onEvent({ type: 'done', text });
      return { text };
    }

    const context = await gatherContext(this.workspaceService, input, this.now());
    if (!this.modelClient) {
      const text = buildTemplateReply(context, input, { reason: 'no-key' });
      onEvent({ type: 'text', text });
      onEvent({ type: 'done', text });
      return { text };
    }

    const messages: ModelMessage[] = [
      { role: 'system', content: buildSystemPrompt(context) },
      { role: 'user', content: buildUserPrompt(input) }
    ];

    let usage: ModelUsage | undefined;
    let lastToolFailure: string | undefined;

    const finish = (text: string): SendMessageResult => {
      onEvent({ type: 'done', text, ...(usage ? { usage } : {}) });
      return { text, ...(usage ? { usage } : {}) };
    };

    try {
      for (let step = 0; step <= this.maxToolSteps; step += 1) {
        let response: ModelResponse;
        let streamedText = false;

        if (supportsStreaming(this.modelClient)) {
          response = await this.modelClient.stream(
            this.buildRequest(messages),
            (event) => {
              if (event.type === 'reasoning') {
                onEvent({ type: 'reasoning', text: event.text });
              } else {
                streamedText = true;
                onEvent({ type: 'text', text: event.text });
              }
            }
          );
        } else {
          response = await this.complete(messages);
        }

        usage = sumUsage(usage, response.usage);
        const toolCalls = response.toolCalls ?? [];

        if (toolCalls.length === 0) {
          const text =
            response.text.trim() || '我暂时没有整理出回复，请再试一次。';
          if (!streamedText && text) {
            onEvent({ type: 'text', text });
          }
          return finish(text);
        }

        if (step === this.maxToolSteps) {
          return finish(buildTemplateReply(context, input, { reason: 'tool-limit' }));
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
          const label = butlerToolLabel(call.name);
          onEvent({ type: 'tool-start', id: call.id, name: call.name, label });
          const result = await this.runTool(call, context);
          if (!result.ok) {
            lastToolFailure = call.name;
          }
          onEvent({
            type: 'tool-result',
            id: call.id,
            name: call.name,
            ok: result.ok,
            label,
            ...(result.ok
              ? {}
              : { detail: redactSecrets(errorDetailFromToolResult(result.content)) })
          });
          messages.push({
            role: 'tool',
            content: result.content,
            toolCallId: call.id,
            toolName: call.name
          });
        }
      }

      return finish(buildTemplateReply(context, input, { reason: 'tool-limit' }));
    } catch (error) {
      onEvent({
        type: 'error',
        message: redactSecrets(error instanceof Error ? error.message : String(error))
      });
      const fallback = this.failureResult(context, input, usage, lastToolFailure);
      onEvent({
        type: 'done',
        text: fallback.text,
        ...(fallback.usage ? { usage: fallback.usage } : {})
      });
      return fallback;
    }
  }

  private buildRequest(messages: ModelMessage[]) {
    return {
      messages,
      ...(this.workspaceService
        ? { tools: toModelToolDefinitions(this.tools) }
        : {}),
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      ...(this.maxTokens !== undefined ? { maxTokens: this.maxTokens } : {})
    };
  }

  private async complete(messages: ModelMessage[]): Promise<ModelResponse> {
    if (!this.modelClient) {
      throw new Error('Model client is not configured.');
    }
    return this.modelClient.complete(this.buildRequest(messages));
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
