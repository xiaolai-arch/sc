import type { ProviderConfig } from '../../shared/types';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { AiSdkModelClient } from './ai-sdk-client';
import { CliAgentClient } from './cli-agent-client';

export type ModelRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ModelMessage {
  role: ModelRole;
  content: string;
  /** Present on assistant messages that request tool execution. */
  toolCalls?: ModelToolCall[];
  /** Present on tool messages: the call this message answers. */
  toolCallId?: string;
  toolName?: string;
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object describing the tool input. */
  parameters: Record<string, unknown>;
}

export interface ModelRequest {
  messages: ModelMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ModelToolDefinition[];
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelResponse {
  text: string;
  usage: ModelUsage;
  toolCalls?: ModelToolCall[];
}

/** Provider-agnostic completion client. Tests must use FakeModelClient. */
export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export type ModelStreamEvent =
  | { type: 'reasoning'; text: string }
  | { type: 'text'; text: string };

/** Optional capability implemented by providers that can stream deltas. */
export interface StreamingModelClient extends ModelClient {
  stream(
    request: ModelRequest,
    onEvent: (event: ModelStreamEvent) => void
  ): Promise<ModelResponse>;
}

export function supportsStreaming(client: ModelClient): client is StreamingModelClient {
  return typeof (client as Partial<StreamingModelClient>).stream === 'function';
}

export class NoApiKeyError extends Error {
  constructor(readonly providerKind: ProviderConfig['kind']) {
    super(`No API key configured for provider "${providerKind}".`);
    this.name = 'NoApiKeyError';
  }
}

/**
 * Offline model client used by tests. It replays scripted responses in order
 * and records every request so tests can assert on the prompt and tool set.
 */
export class FakeModelClient implements ModelClient {
  readonly calls: ModelRequest[] = [];
  private cursor = 0;

  constructor(private readonly responses: Array<string | ModelResponse | Error>) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.calls.push(request);
    const next = this.responses[this.cursor];
    this.cursor += 1;
    if (next === undefined) {
      throw new Error('FakeModelClient has no scripted response left.');
    }
    if (next instanceof Error) {
      throw next;
    }
    if (typeof next === 'string') {
      return { text: next, usage: { inputTokens: 0, outputTokens: 0 } };
    }
    return { ...next, usage: next.usage ?? { inputTokens: 0, outputTokens: 0 } };
  }
}

export function createModelClient(provider: ProviderConfig, apiKey: string | null): ModelClient {
  switch (provider.kind) {
    case 'anthropic': {
      if (!apiKey) {
        throw new NoApiKeyError('anthropic');
      }
      const anthropic = createAnthropic({ apiKey });
      return new AiSdkModelClient({ generate: generateText, model: anthropic(provider.model) });
    }
    case 'openai-compatible': {
      const compatible = createOpenAICompatible({
        name: 'openai-compatible',
        baseURL: provider.baseURL,
        ...(apiKey ? { apiKey } : {})
      });
      return new AiSdkModelClient({ generate: generateText, model: compatible(provider.model) });
    }
    case 'ollama': {
      const baseURL = provider.baseURL || 'http://127.0.0.1:11434/v1';
      const ollama = createOpenAICompatible({
        name: 'ollama',
        baseURL,
        apiKey: apiKey || 'ollama'
      });
      return new AiSdkModelClient({ generate: generateText, model: ollama(provider.model) });
    }
    case 'local-cli':
      return new CliAgentClient(provider);
  }
}
