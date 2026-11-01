import { jsonSchema, streamText } from 'ai';
import type {
  JSONSchema7,
  LanguageModel,
  ModelMessage as AiSdkMessage,
  ToolCallPart,
  ToolSet
} from 'ai';
import type {
  ModelClient,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  ModelToolCall,
  ModelToolDefinition,
  StreamingModelClient
} from './model-client';

type AiSdkGenerateOptions = Parameters<typeof import('ai').generateText>[0];

/** Subset of the AI SDK result that the adapter consumes. */
export interface AiSdkGenerateResult {
  text: string;
  usage?: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    /** Legacy AI SDK usage field names. */
    promptTokens?: number | undefined;
    completionTokens?: number | undefined;
  };
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    input?: unknown;
  }>;
}

export type AiSdkGenerate = (options: AiSdkGenerateOptions) => Promise<AiSdkGenerateResult>;

export interface AiSdkStreamPart {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  totalUsage?: AiSdkUsageLike;
  error?: unknown;
}

export interface AiSdkUsageLike {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
}

export interface AiSdkStreamResult {
  fullStream: AsyncIterable<AiSdkStreamPart>;
  totalUsage?: PromiseLike<AiSdkUsageLike> | AiSdkUsageLike;
}

export type AiSdkStreamGenerate = (options: AiSdkGenerateOptions) => AiSdkStreamResult;

export interface AiSdkModelClientOptions {
  generate: AiSdkGenerate;
  streamGenerate?: AiSdkStreamGenerate;
  model: LanguageModel;
}

/**
 * Adapter between the provider-agnostic ModelClient and the AI SDK.
 * Tool execution stays outside the SDK so the butler owns the tool loop.
 */
export class AiSdkModelClient implements StreamingModelClient {
  private readonly generate: AiSdkGenerate;
  private readonly streamGenerate: AiSdkStreamGenerate;
  private readonly model: LanguageModel;

  constructor(options: AiSdkModelClientOptions) {
    this.generate = options.generate;
    this.streamGenerate = options.streamGenerate ?? streamText;
    this.model = options.model;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const options = this.buildOptions(request);
    const result = await this.generate(options as AiSdkGenerateOptions);
    const usage = result.usage;
    const toolCalls: ModelToolCall[] = (result.toolCalls ?? []).map((call) => ({
      id: call.toolCallId,
      name: call.toolName,
      arguments: call.input
    }));

    return {
      text: result.text,
      usage: {
        inputTokens: usage?.inputTokens ?? usage?.promptTokens ?? 0,
        outputTokens: usage?.outputTokens ?? usage?.completionTokens ?? 0
      },
      ...(toolCalls.length > 0 ? { toolCalls } : {})
    };
  }

  async stream(
    request: ModelRequest,
    onEvent: (event: ModelStreamEvent) => void
  ): Promise<ModelResponse> {
    const result = this.streamGenerate(this.buildOptions(request) as AiSdkGenerateOptions);
    let text = '';
    const toolCalls: ModelToolCall[] = [];

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta' && typeof part.text === 'string') {
        text += part.text;
        onEvent({ type: 'text', text: part.text });
      } else if (part.type === 'reasoning-delta' && typeof part.text === 'string') {
        onEvent({ type: 'reasoning', text: part.text });
      } else if (part.type === 'tool-call' && part.toolCallId && part.toolName) {
        toolCalls.push({
          id: part.toolCallId,
          name: part.toolName,
          arguments: part.input ?? {}
        });
      } else if (part.type === 'error') {
        throw part.error instanceof Error
          ? part.error
          : new Error(String(part.error ?? '模型流式输出失败。'));
      }
    }

    const usage = (await Promise.resolve(
      result.totalUsage ?? { inputTokens: 0, outputTokens: 0 }
    )) as AiSdkUsageLike;
    return {
      text,
      usage: {
        inputTokens: usage.inputTokens ?? usage.promptTokens ?? 0,
        outputTokens: usage.outputTokens ?? usage.completionTokens ?? 0
      },
      ...(toolCalls.length > 0 ? { toolCalls } : {})
    };
  }

  private buildOptions(request: ModelRequest): Record<string, unknown> {
    // AI SDK v7 rejects system messages inside `messages`; they belong in
    // `instructions`, which applies to both generateText and streamText.
    const instructions = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const conversation = request.messages.filter((message) => message.role !== 'system');
    const options: Record<string, unknown> = {
      model: this.model,
      messages: toAiSdkMessages(conversation)
    };
    if (instructions) {
      options['instructions'] = instructions;
    }
    if (request.temperature !== undefined) {
      options['temperature'] = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      options['maxOutputTokens'] = request.maxTokens;
    }
    if (request.signal !== undefined) {
      options['abortSignal'] = request.signal;
    }
    const tools = toAiSdkTools(request.tools);
    if (tools) {
      options['tools'] = tools;
    }
    return options;
  }
}

function toAiSdkMessages(messages: ModelMessage[]): AiSdkMessage[] {
  return messages.map((message): AiSdkMessage => {
    if (message.role === 'tool') {
      if (!message.toolCallId || !message.toolName) {
        throw new Error('Tool messages require toolCallId and toolName.');
      }
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            output: { type: 'text', value: message.content }
          }
        ]
      };
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      const parts: Array<{ type: 'text'; text: string } | ToolCallPart> = [];
      if (message.content.trim()) {
        parts.push({ type: 'text', text: message.content });
      }
      for (const call of message.toolCalls) {
        parts.push({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: call.name,
          input: call.arguments
        });
      }
      return { role: 'assistant', content: parts };
    }

    if (message.role === 'system' || message.role === 'user' || message.role === 'assistant') {
      return { role: message.role, content: message.content };
    }

    throw new Error(`Unsupported model message role: ${String(message.role)}`);
  });
}

function toAiSdkTools(definitions?: ModelToolDefinition[]): ToolSet | undefined {
  if (!definitions?.length) {
    return undefined;
  }
  const tools: ToolSet = {};
  for (const definition of definitions) {
    tools[definition.name] = {
      description: definition.description,
      inputSchema: jsonSchema(definition.parameters as JSONSchema7)
    };
  }
  return tools;
}
