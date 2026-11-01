import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { LocalCliAgent, ProviderConfig } from '../../shared/types';
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

type LocalCliProvider = Extract<ProviderConfig, { kind: 'local-cli' }>;

export type CliRunResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

export type CliRunner = (
  command: string,
  args: string[],
  input: string,
  options: { cwd: string; timeoutMs: number }
) => Promise<CliRunResult>;

export type CliStreamRunner = (
  command: string,
  args: string[],
  input: string,
  options: { cwd: string; timeoutMs: number },
  onLine: (line: string) => void
) => Promise<CliRunResult>;

type AgentConfig = {
  args: string[];
  streamArgs?: string[];
  stdin: boolean;
};

const AGENT_CONFIG: Record<LocalCliAgent, AgentConfig> = {
  codex: {
    args: ['exec', '--skip-git-repo-check', '-'],
    streamArgs: [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '-c',
      'model_reasoning_effort=medium',
      '-'
    ],
    stdin: true
  },
  claude: {
    args: ['-p', '--output-format', 'text'],
    streamArgs: [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages'
    ],
    stdin: true
  },
  zcode: { args: ['-p'], stdin: false },
  opencode: { args: ['--prompt'], stdin: false }
};

const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Local CLI agents do not receive a native tool schema, so the protocol is
 * stated in the prompt: the agent may answer in text, or answer with a single
 * fenced JSON block that carries the visible text and any tool calls.
 */
const TOOL_PROTOCOL = [
  '## 工具调用协议',
  '你可以使用下面的工具。不需要工具时直接输出回答；需要调用工具时，只输出一个 fenced JSON 代码块（```json ... ```），格式如下：',
  '```json',
  '{"text":"给用户看的说明","toolCalls":[{"name":"工具名","arguments":{}}]}',
  '```',
  '- text：要展示给用户的文字，可以为空字符串。',
  '- toolCalls[].name：下面的工具名之一。',
  '- toolCalls[].arguments：JSON 对象，字段遵循对应工具的参数 schema。',
  '- 一次可以调用多个工具；不要编造工具结果，工具结果会由系统在下一轮提供。'
].join('\n');

function buildPrompt(request: ModelRequest): string {
  const parts = request.messages.map(renderMessage);
  if (request.tools?.length) {
    const systemIndex = request.messages.findIndex((message) => message.role === 'system');
    parts.splice(systemIndex >= 0 ? systemIndex + 1 : 0, 0, renderToolSection(request.tools));
  }
  return parts.join('\n\n');
}

function renderToolSection(tools: ModelToolDefinition[]): string {
  const lines = [TOOL_PROTOCOL, '', '### 可用工具'];
  for (const tool of tools) {
    lines.push(`- ${tool.name}：${tool.description}`);
    lines.push(`  参数 schema：${JSON.stringify(tool.parameters)}`);
  }
  return lines.join('\n');
}

function renderMessage(message: ModelMessage): string {
  if (message.role === 'tool') {
    return `TOOL RESULT (${message.toolName ?? 'tool'}):\n${message.content}`;
  }
  const parts = [`${message.role.toUpperCase()}:\n${message.content}`];
  if (message.role === 'assistant' && message.toolCalls?.length) {
    const calls = message.toolCalls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments
    }));
    parts.push(`ASSISTANT TOOL CALLS:\n${JSON.stringify(calls)}`);
  }
  return parts.join('\n\n');
}

export interface ParsedCliResponse {
  text: string;
  toolCalls?: ModelToolCall[];
}

/**
 * Parses an agent answer that may end with the structured JSON protocol
 * block. The last fenced block is authoritative: a malformed or unrelated
 * block means the whole answer is plain text, never a stale earlier call.
 */
export function parseCliResponse(answer: string): ParsedCliResponse {
  const plain = answer.trim();
  const fallback: ParsedCliResponse = { text: plain };
  const candidate = lastJsonCandidate(plain);
  if (!candidate) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return fallback;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fallback;
  }

  const envelope = parsed as Record<string, unknown>;
  const text = typeof envelope['text'] === 'string' ? envelope['text'].trim() : '';
  const hasText = typeof envelope['text'] === 'string';
  const hasToolCalls = Array.isArray(envelope['toolCalls']);
  if (!hasText && !hasToolCalls) return fallback;

  const toolCalls = hasToolCalls ? normalizeToolCalls(envelope['toolCalls']) : [];
  if (!text && toolCalls.length === 0) return fallback;

  return { text, ...(toolCalls.length > 0 ? { toolCalls } : {}) };
}

/** Returns the body of the last fenced block (any language tag). */
function lastJsonCandidate(answer: string): string | undefined {
  let last: string | undefined;
  const blockPattern = /```[ \t]*(?:json)?[ \t]*([\s\S]*?)```/gi;
  for (const match of answer.matchAll(blockPattern)) {
    last = match[1] ?? '';
  }
  if (last !== undefined) {
    return last.trim();
  }
  // Tolerate an agent that emits the envelope without a code fence.
  if (answer.startsWith('{') && answer.endsWith('}')) {
    return answer;
  }
  return undefined;
}

function normalizeToolCalls(value: unknown): ModelToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: ModelToolCall[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
    if (!name) continue;
    const providedId = typeof record['id'] === 'string' ? record['id'].trim() : '';
    calls.push({
      id: providedId || `cli-call-${index + 1}`,
      name,
      arguments: record['arguments'] ?? {}
    });
  }
  return calls;
}

/**
 * Codex exec prints a banner, hook logs, the answer, and a final token summary
 * followed by the answer again. Keep only that final answer block.
 */
export function extractCodexAnswer(stdout: string): string {
  const marker = '\ntokens used\n';
  const markerIndex = stdout.lastIndexOf(marker);
  if (markerIndex >= 0) {
    const lines = stdout
      .slice(markerIndex + marker.length)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    // First non-empty line after "tokens used" is the token count.
    const answer = lines.slice(1).join('\n').trim();
    if (answer) return answer;
  }
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

function defaultRunner(
  command: string,
  args: string[],
  input: string,
  options: { cwd: string; timeoutMs: number }
): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: CliRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      fail(new Error(`本地 CLI agent 超时（${options.timeoutMs}ms）。`));
    }, options.timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => fail(error));
    child.on('close', (code) => finish({ stdout, stderr, code }));
    child.stdin?.end(input);
  });
}

function defaultStreamRunner(
  command: string,
  args: string[],
  input: string,
  options: { cwd: string; timeoutMs: number },
  onLine: (line: string) => void
): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let pending = '';
    let settled = false;

    const flush = (chunk: string, final: boolean) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      if (final) {
        pending = '';
        for (const line of lines) {
          if (line.trim()) onLine(line);
        }
        return;
      }
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    };

    const finish = (result: CliRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      flush('', true);
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      fail(new Error(`本地 CLI agent 超时（${options.timeoutMs}ms）。`));
    }, options.timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      flush(text, false);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => fail(error));
    child.on('close', (code) => finish({ stdout, stderr, code }));
    child.stdin?.end(input);
  });
}

/**
 * Buffers text until it can tell whether the CLI is emitting a plain answer
 * or the fenced JSON tool envelope. Plain text is forwarded immediately; an
 * envelope is held until `finish()` so raw JSON never reaches the user.
 */
export class EnvelopeTextGate {
  private buffer = '';
  private decided = false;
  private streaming = false;
  private forwarded = '';

  constructor(private readonly onEvent: (event: ModelStreamEvent) => void) {}

  push(delta: string) {
    if (this.decided) {
      if (this.streaming) {
        this.forwarded += delta;
        this.onEvent({ type: 'text', text: delta });
      } else {
        this.buffer += delta;
      }
      return;
    }

    this.buffer += delta;
    const first = this.buffer.trimStart()[0];
    if (first === undefined) return;
    if (first !== '{' && first !== '`') {
      this.decided = true;
      this.streaming = true;
      this.forwarded = this.buffer;
      this.onEvent({ type: 'text', text: this.buffer });
      this.buffer = '';
    }
  }

  finish(): { text: string; toolCalls?: ModelToolCall[]; streamed: boolean } {
    if (this.streaming) {
      return { text: this.forwarded, streamed: true };
    }
    const parsed = parseCliResponse(this.buffer);
    return {
      text: parsed.text,
      streamed: false,
      ...(parsed.toolCalls?.length ? { toolCalls: parsed.toolCalls } : {})
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readUsage(value: unknown): { inputTokens: number; outputTokens: number } | null {
  if (!isRecord(value)) return null;
  const input = value['input_tokens'] ?? value['inputTokens'] ?? value['prompt_tokens'] ?? value['promptTokens'];
  const output = value['output_tokens'] ?? value['outputTokens'] ?? value['completion_tokens'] ?? value['completionTokens'];
  return {
    inputTokens: typeof input === 'number' && Number.isFinite(input) ? input : 0,
    outputTokens: typeof output === 'number' && Number.isFinite(output) ? output : 0
  };
}

type StreamState = {
  emitted: boolean;
  text: string;
  finalResult: string;
  usage: { inputTokens: number; outputTokens: number };
  toolCalls?: ModelToolCall[];
  explicitFailure?: string;
};

/**
 * Runs a locally installed CLI agent (codex/claude/zcode/opencode) as a
 * one-shot model client. No API key is involved: the CLI uses its own local
 * credentials. The CLI runs in a temp directory, not in the app repo or vault.
 */
export class CliAgentClient implements StreamingModelClient {
  constructor(
    private readonly provider: LocalCliProvider,
    private readonly options: {
      runner?: CliRunner;
      streamRunner?: CliStreamRunner;
      cwd?: string;
      timeoutMs?: number;
    } = {}
  ) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const config = AGENT_CONFIG[this.provider.agent];
    const command = this.provider.command?.trim() || this.provider.agent;
    const prompt = buildPrompt(request);
    const args = [...config.args];
    if (!config.stdin) args.push(prompt);

    const result = await (this.options.runner ?? defaultRunner)(
      command,
      args,
      config.stdin ? prompt : '',
      {
        cwd: this.options.cwd ?? tmpdir(),
        timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      }
    );

    if (result.code !== 0) {
      const detail = result.stderr.trim().slice(0, 500);
      throw new Error(
        `本地 CLI agent ${this.provider.agent} 退出码 ${result.code ?? 'unknown'}${detail ? `：${detail}` : ''}`
      );
    }

    const raw = result.stdout.trim();
    const answer =
      this.provider.agent === 'codex' ? extractCodexAnswer(result.stdout) : raw;
    const parsed = parseCliResponse(answer);
    if (!parsed.text && !parsed.toolCalls?.length) {
      throw new Error(`本地 CLI agent ${this.provider.agent} 没有返回内容。`);
    }

    return {
      text: parsed.text,
      usage: { inputTokens: 0, outputTokens: 0 },
      ...(parsed.toolCalls?.length ? { toolCalls: parsed.toolCalls } : {})
    };
  }

  async stream(
    request: ModelRequest,
    onEvent: (event: ModelStreamEvent) => void
  ): Promise<ModelResponse> {
    const config = AGENT_CONFIG[this.provider.agent];
    if (!config.streamArgs) {
      const result = await this.complete(request);
      if (result.text.trim()) onEvent({ type: 'text', text: result.text.trim() });
      return result;
    }

    const command = this.provider.command?.trim() || this.provider.agent;
    const prompt = buildPrompt(request);
    const args = [...config.streamArgs];
    if (!config.stdin) args.push(prompt);

    const state: StreamState = {
      emitted: false,
      text: '',
      finalResult: '',
      usage: { inputTokens: 0, outputTokens: 0 }
    };
    const forward = (event: ModelStreamEvent) => {
      state.emitted = true;
      onEvent(event);
    };
    const gate =
      this.provider.agent === 'claude' ? new EnvelopeTextGate(forward) : null;

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (!isRecord(parsed)) return;
      if (this.provider.agent === 'claude') {
        this.handleClaudeEvent(parsed, gate!, forward, state);
      } else {
        this.handleCodexEvent(parsed, forward, state);
      }
    };

    const result = await (this.options.streamRunner ?? defaultStreamRunner)(
      command,
      args,
      config.stdin ? prompt : '',
      {
        cwd: this.options.cwd ?? tmpdir(),
        timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      },
      handleLine
    );

    const gateResult = gate?.finish();
    if (gateResult) {
      state.text = gateResult.text;
      if (gateResult.toolCalls?.length) state.toolCalls = gateResult.toolCalls;
    } else if (!state.text && state.finalResult) {
      state.text = state.finalResult;
    }

    if (state.explicitFailure) {
      throw new Error(state.explicitFailure);
    }

    if (result.code !== 0) {
      if (!state.emitted && !state.text.trim()) {
        return this.streamFallback(request, onEvent);
      }
      const detail = result.stderr.trim().slice(0, 500);
      throw new Error(
        `本地 CLI agent ${this.provider.agent} 退出码 ${result.code ?? 'unknown'}${detail ? `：${detail}` : ''}`
      );
    }

    if (!state.emitted && !state.text.trim()) {
      return this.streamFallback(request, onEvent);
    }

    return {
      text: state.text,
      usage: state.usage,
      ...(state.toolCalls?.length ? { toolCalls: state.toolCalls } : {})
    };
  }

  private async streamFallback(
    request: ModelRequest,
    onEvent: (event: ModelStreamEvent) => void
  ): Promise<ModelResponse> {
    const result = await this.complete(request);
    if (result.text.trim()) onEvent({ type: 'text', text: result.text.trim() });
    return result;
  }

  private handleClaudeEvent(
    event: Record<string, unknown>,
    gate: EnvelopeTextGate,
    forward: (event: ModelStreamEvent) => void,
    state: StreamState
  ) {
    if (event['type'] === 'stream_event') {
      const streamEvent = event['event'];
      if (!isRecord(streamEvent) || streamEvent['type'] !== 'content_block_delta') return;
      const delta = streamEvent['delta'];
      if (!isRecord(delta)) return;
      if (delta['type'] === 'thinking_delta' && typeof delta['thinking'] === 'string') {
        forward({ type: 'reasoning', text: delta['thinking'] });
        return;
      }
      if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
        gate.push(delta['text']);
      }
      return;
    }

    if (event['type'] === 'result') {
      if (event['is_error'] === true) {
        state.explicitFailure =
          typeof event['result'] === 'string' && event['result'].trim()
            ? event['result'].trim()
            : 'Claude CLI returned an error.';
      }
      if (typeof event['result'] === 'string') {
        state.finalResult = event['result'];
      }
      const usage = readUsage(event['usage']);
      if (usage) state.usage = usage;
    }
  }

  private handleCodexEvent(
    event: Record<string, unknown>,
    forward: (event: ModelStreamEvent) => void,
    state: StreamState
  ) {
    if (event['type'] === 'item.completed') {
      const item = event['item'];
      if (!isRecord(item)) return;
      if (item['type'] === 'reasoning' && typeof item['text'] === 'string' && item['text'].trim()) {
        forward({ type: 'reasoning', text: item['text'] });
        return;
      }
      if (item['type'] === 'agent_message' && typeof item['text'] === 'string') {
        const parsed = parseCliResponse(item['text']);
        state.text = parsed.text;
        if (parsed.toolCalls?.length) {
          state.toolCalls = parsed.toolCalls;
        } else if (parsed.text.trim()) {
          forward({ type: 'text', text: parsed.text });
        }
        return;
      }
      if (item['type'] === 'error') {
        state.explicitFailure =
          typeof item['text'] === 'string'
            ? item['text']
            : 'Codex CLI returned an error.';
      }
      return;
    }

    if (event['type'] === 'turn.completed') {
      const usage = readUsage(event['usage']);
      if (usage) state.usage = usage;
      return;
    }

    if (event['type'] === 'turn.failed' || event['type'] === 'error') {
      const error = event['error'];
      state.explicitFailure =
        isRecord(error) && typeof error['message'] === 'string'
          ? error['message']
          : 'Codex CLI returned an error.';
    }
  }
}
