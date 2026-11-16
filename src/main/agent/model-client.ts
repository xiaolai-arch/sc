import type { ProviderConfig } from '../../shared/types';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, streamText } from 'ai';
import { AiSdkModelClient } from './ai-sdk-client';
import { CliAgentClient } from './cli-agent-client';

export type ModelRole = 'system' | 'user' | 'assistant' | 'tool';

/** Media types the providers are expected to accept for inline images. */
export type ModelImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * An image attached to a user message. `path` points at a local file; the
 * caller is responsible for producing it (screen-read frames, never renderer
 * supplied paths).
 */
export interface ModelImage {
  path: string;
  mediaType: ModelImageMediaType;
}

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
  /** Attached images. Only honoured on user messages; other roles ignore them. */
  images?: ModelImage[];
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
  /** Ask the provider to expose its native web search/fetch tools (CLI agents only). */
  webTools?: boolean;
  /** Allow the native agent to change files. Defaults to the CLI's own policy. */
  allowWrites?: boolean;
  /** Allow the native agent to run shell commands. Defaults to the CLI's policy. */
  allowShell?: boolean;
  /** Working directory for native local-CLI agents (the current vault workspace). */
  cwd?: string;
  signal?: AbortSignal;
  /**
   * Pure generation call: no tools are declared or loaded. CLI providers get
   * an empty tool set where they support it; AI SDK providers simply get no
   * tool declarations.
   */
  noTools?: boolean;
  /** Overrides the provider's default per-request timeout (CLI total cap: 15m). */
  timeoutMs?: number;
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
  | { type: 'text'; text: string }
  /**
   * A tool the CLI itself is running (Bash, file edits, web search…). Only
   * providers that really report tool lifecycles emit these; nothing is
   * invented when a CLI keeps its tools private.
   */
  | { type: 'tool-start'; id: string; name: string; label: string }
  | {
      type: 'tool-result';
      id: string;
      name: string;
      label: string;
      ok: boolean;
      detail?: string;
    };

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

/** Raised when a provider cannot read images instead of silently dropping them. */
export class ModelImageUnsupportedError extends Error {
  constructor(readonly provider: string) {
    super(`当前模型不支持读图：${provider}`);
    this.name = 'ModelImageUnsupportedError';
  }
}

/** Raised when a model call exceeds its per-request timeout. */
export class ModelTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    message = `模型调用超时（${timeoutMs}ms）。`
  ) {
    super(message);
    this.name = 'ModelTimeoutError';
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
      return new AiSdkModelClient({ generate: generateText, streamGenerate: streamText, model: anthropic(provider.model) });
    }
    case 'openai-compatible': {
      const compatible = createOpenAICompatible({
        name: 'openai-compatible',
        baseURL: provider.baseURL,
        ...(apiKey ? { apiKey } : {})
      });
      return new AiSdkModelClient({ generate: generateText, streamGenerate: streamText, model: compatible(provider.model) });
    }
    case 'ollama': {
      const baseURL = provider.baseURL || 'http://127.0.0.1:11434/v1';
      const ollama = createOpenAICompatible({
        name: 'ollama',
        baseURL,
        apiKey: apiKey || 'ollama'
      });
      return new AiSdkModelClient({ generate: generateText, streamGenerate: streamText, model: ollama(provider.model) });
    }
    case 'local-cli':
      return new CliAgentClient(provider);
  }
}
