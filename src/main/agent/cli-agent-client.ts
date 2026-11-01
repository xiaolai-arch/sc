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
  options: { cwd: string; timeoutMs: number; signal?: AbortSignal }
) => Promise<CliRunResult>;

export type CliStreamRunner = (
  command: string,
  args: string[],
  input: string,
  options: { cwd: string; timeoutMs: number; signal?: AbortSignal },
  onLine: (line: string) => void
) => Promise<CliRunResult>;

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

type AgentConfig = {
  args: string[];
  streamArgs?: string[];
  stdin: boolean;
};

const AGENT_CONFIG: Record<LocalCliAgent, AgentConfig> = {
  codex: {
    args: ['exec', '--skip-git-repo-check', '-'],
    streamArgs: ['exec', '--json', '--skip-git-repo-check', '-'],
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

/**
 * Native-agent arguments. Unlike the one-shot config above, these let the CLI
 * use its own tools and keep the process inside the user's vault instead of a
 * temp directory. Streaming output stays machine-readable where supported.
 */
const NATIVE_AGENT_CONFIG: Record<
  LocalCliAgent,
  { args: string[]; streamArgs?: string[]; stdin: boolean }
> = {
  codex: {
    args: ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-'],
    streamArgs: [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
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
  zcode: {
    args: ['-p', '--mode', 'edit'],
    streamArgs: ['-p', '--json', '--mode', 'edit'],
    stdin: false
  },
  opencode: {
    args: ['run', '--auto'],
    streamArgs: ['run', '--format', 'json', '--auto'],
    stdin: false
  }
};

const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Applies the provider's model/effort to the base CLI arguments.
 * - codex: model and reasoning effort go before the stdin placeholder `-`;
 *   effort defaults to `medium`, preserving the previous behavior.
 * - claude: `--model`/`--effort` only when configured; `--bare` when isolated.
 * - opencode: `--model provider/model`; the effort becomes the `#variant`
 *   suffix unless the model already names one.
 * - zcode: its model is chosen inside zcode; native mode adds `--cwd`.
 * - native mode also adds the workspace cwd and non-interactive sandbox flags.
 */
export function buildAgentArgs(
  provider: LocalCliProvider,
  baseArgs: readonly string[],
  options: { webTools?: boolean; nativeTools?: boolean; cwd?: string } = {}
): string[] {
  const args = [...baseArgs];
  const native = options.nativeTools === true;

  if (provider.agent === 'codex') {
    const model = provider.model?.trim();
    const effort = provider.effort ?? 'medium';
    const additions: string[] = [];
    if (model) additions.push('-m', model);
    additions.push('-c', `model_reasoning_effort=${effort}`);
    if (native && options.cwd) additions.push('-C', options.cwd);
    const stdinIndex = args.lastIndexOf('-');
    if (stdinIndex >= 0) {
      args.splice(stdinIndex, 0, ...additions);
    } else {
      args.push(...additions);
    }
    // `--search` is a global flag, so it must precede the `exec` subcommand.
    if (options.webTools) args.unshift('--search');
    return args;
  }

  if (provider.agent === 'claude') {
    const model = provider.model?.trim();
    if (model) args.push('--model', model);
    if (provider.effort) args.push('--effort', provider.effort);
    if (native) {
      if (options.cwd) args.push('--add-dir', options.cwd);
      // `--bare` would strip the native tools this mode depends on.
      args.push('--permission-mode', 'acceptEdits');
    } else if (provider.isolate) {
      args.push('--bare');
    }
    // Under `--bare` the web tools are only available when named explicitly.
    if (options.webTools) {
      args.push('--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch,WebFetch');
    }
  }

  if (provider.agent === 'opencode') {
    const model = provider.model?.trim();
    if (model) {
      const variant =
        model.includes('#') || !provider.effort ? model : `${model}#${provider.effort}`;
      args.push('--model', variant);
    }
  }

  if (provider.agent === 'zcode') {
    if (native && options.cwd) args.push('--cwd', options.cwd);
    if (options.webTools) args.push('--browser-use', 'headless');
  }

  return args;
}

/**
 * Local CLI agents do not receive a native tool schema, so the protocol is
 * stated in the prompt: the agent may answer in text, or answer with a single
 * fenced JSON block that carries the visible text and any tool calls.
 */
const ENVELOPE_PROTOCOL = 'asaki.butler.v1';

const TOOL_PROTOCOL = [
  '## 工具调用协议',
  '你可以使用下面的工具。不需要工具时直接输出回答；需要调用工具时，只输出一个 fenced JSON 代码块（```json ... ```），格式如下：',
  '```json',
  `{"protocol":"${ENVELOPE_PROTOCOL}","text":"给用户看的说明","toolCalls":[{"name":"工具名","arguments":{}}]}`,
  '```',
  `- protocol：固定为 "${ENVELOPE_PROTOCOL}"。`,
  '- text：要展示给用户的文字，可以为空字符串。',
  '- toolCalls[].name：下面的工具名之一。',
  '- toolCalls[].arguments：JSON 对象，字段遵循对应工具的参数 schema。',
  '- 一次可以调用多个工具；不要编造工具结果，工具结果会由系统在下一轮提供。',
  '- 调用工具时，整条回复必须只有这个 fenced JSON 代码块；代码块前后不要写任何文字、标题或解释。'
].join('\n');

function buildPrompt(request: ModelRequest): string {
  const parts = request.messages.map(renderMessage);
  if (request.tools?.length) {
    const systemIndex = request.messages.findIndex((message) => message.role === 'system');
    parts.splice(systemIndex >= 0 ? systemIndex + 1 : 0, 0, renderToolSection(request.tools));
  }
  return parts.join('\n\n');
}

/**
 * Native mode deliberately does not inject the JSON tool protocol: the CLI
 * uses its own file/search/shell/web tools, so the prompt is a normal
 * conversation plus the scope of the local workspace it may touch.
 */
function buildNativePrompt(request: ModelRequest, cwd: string): string {
  const systemIndex = request.messages.findIndex((message) => message.role === 'system');
  const environment = [
    '## 原生 agent 模式',
    `你正在 ASAKI 的本地工作区中运行，当前目录：${cwd}`,
    '你可以使用自己的原生文件、搜索、命令行和联网工具来完成任务。',
    '只读取或修改这个工作区以及 ASAKI 的 vault；不要读取密钥、SSH、浏览器历史等私人数据。',
    '如果修改 vault，保留现有 markdown/frontmatter 结构，不要重命名或删除无关文件。',
    '回答用中文，先给结论；如果修改了文件，简短说明改了哪些文件。'
  ].join('\n');
  const parts = request.messages.map(renderMessage);
  parts.splice(systemIndex >= 0 ? systemIndex + 1 : 0, 0, environment);
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
  // A marked envelope is authoritative. The markerless form is only accepted
  // when it is the entire response, so an example or a JSON snippet embedded in
  // prose can never execute real tools.
  if (
    envelope['protocol'] !== ENVELOPE_PROTOCOL &&
    !isSingleEnvelopeBlock(plain)
  ) {
    return fallback;
  }
  const text = typeof envelope['text'] === 'string' ? envelope['text'].trim() : '';
  const hasText = typeof envelope['text'] === 'string';
  const hasToolCalls = Array.isArray(envelope['toolCalls']);
  if (!hasText && !hasToolCalls) return fallback;

  const toolCalls = hasToolCalls ? normalizeToolCalls(envelope['toolCalls']) : [];
  if (!text && toolCalls.length === 0) return fallback;

  return { text, ...(toolCalls.length > 0 ? { toolCalls } : {}) };
}

function isSingleEnvelopeBlock(answer: string): boolean {
  const trimmed = answer.trim();
  if (/^```[ \t]*(?:json)?[ \t]*\r?\n?[\s\S]*?```$/i.test(trimmed)) return true;
  return trimmed.startsWith('{') && trimmed.endsWith('}') && !trimmed.includes('```');
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
  options: { cwd: string; timeoutMs: number; signal?: AbortSignal }
): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
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
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort);
    const finish = (result: CliRunResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      clearTimeout(timer);
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      clearTimeout(timer);
      reject(error);
    };
    const onAbort = () => {
      child.kill('SIGTERM');
      fail(abortError());
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
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
    // A CLI can exit before reading stdin (bad flag, auth failure, large paste).
    // Without this listener Node treats the resulting EPIPE as an unhandled
    // process-level error instead of rejecting the model turn.
    child.stdin?.on('error', (error) => fail(error));
    child.stdin?.end(input);
  });
}

function defaultStreamRunner(
  command: string,
  args: string[],
  input: string,
  options: { cwd: string; timeoutMs: number; signal?: AbortSignal },
  onLine: (line: string) => void
): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
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

    const cleanup = () => options.signal?.removeEventListener('abort', onAbort);
    const finish = (result: CliRunResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      clearTimeout(timer);
      flush('', true);
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      clearTimeout(timer);
      reject(error);
    };
    const onAbort = () => {
      child.kill('SIGTERM');
      fail(abortError());
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
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
    // A CLI can exit before reading stdin (bad flag, auth failure, large paste).
    // Without this listener Node treats the resulting EPIPE as an unhandled
    // process-level error instead of rejecting the model turn.
    child.stdin?.on('error', (error) => fail(error));
    child.stdin?.end(input);
  });
}

/**
 * Buffers text until it can tell whether the CLI is emitting a plain answer
 * or the fenced JSON tool envelope. A fenced block or a JSON-looking answer is
 * held until `finish()` so raw JSON never reaches the user; long plain answers
 * start streaming once the hold window is exceeded.
 */
export class EnvelopeTextGate {
  private static readonly STREAM_THRESHOLD = 800;
  /** Keep enough tail to catch a fence split across CLI deltas. */
  private static readonly TAIL = 4;
  private raw = '';
  private pending = '';
  private forwarded = '';
  private inEnvelope = false;

  constructor(private readonly onEvent: (event: ModelStreamEvent) => void) {}

  private emit(text: string) {
    if (!text) return;
    this.forwarded += text;
    this.onEvent({ type: 'text', text });
  }

  push(delta: string) {
    this.raw += delta;
    if (this.inEnvelope) return;

    this.pending += delta;
    const fenceAt = this.pending.indexOf('```');
    if (fenceAt >= 0) {
      // A short preamble before a tool envelope is discarded (the envelope's
      // text is the answer). If prose was already streaming, keep showing it;
      // the final done event reconciles the message. Never forward the fence.
      if (this.forwarded) this.emit(this.pending.slice(0, fenceAt));
      this.pending = '';
      this.inEnvelope = true;
      return;
    }

    // A JSON-looking answer (with or without a fence) is held until finish.
    if (this.pending.trimStart().startsWith('{')) {
      this.inEnvelope = true;
      return;
    }

    if (this.pending.length <= EnvelopeTextGate.STREAM_THRESHOLD) return;
    const safeLength = this.pending.length - EnvelopeTextGate.TAIL;
    this.emit(this.pending.slice(0, safeLength));
    this.pending = this.pending.slice(safeLength);
  }

  finish(): {
    text: string;
    toolCalls?: ModelToolCall[];
    streamed: boolean;
    fenced: boolean;
  } {
    if (this.inEnvelope) {
      const parsed = parseCliResponse(this.raw);
      return {
        text: parsed.text,
        streamed: this.forwarded.length > 0,
        fenced: true,
        ...(parsed.toolCalls?.length ? { toolCalls: parsed.toolCalls } : {})
      };
    }

    // A plain answer: flush the small fence-detection tail, then return the
    // complete text so a done event can reconcile anything already streamed.
    this.emit(this.pending);
    this.pending = '';
    return {
      text: this.raw.trim(),
      streamed: this.forwarded.length > 0,
      fenced: false
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
 * Runs a locally installed CLI agent (codex/claude/zcode/opencode). No API key
 * is involved: the CLI uses its own local credentials. One-shot mode runs in a
 * temp directory; native mode runs inside the vault workspace and lets the CLI
 * use its own file, shell and web tools.
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
    const native = this.isNative(request);
    const config = native
      ? NATIVE_AGENT_CONFIG[this.provider.agent]
      : AGENT_CONFIG[this.provider.agent];
    const command = this.provider.command?.trim() || this.provider.agent;
    const prompt = native ? buildNativePrompt(request, request.cwd!) : buildPrompt(request);
    const args = buildAgentArgs(this.provider, config.args, {
      ...(request.webTools ? { webTools: true } : {}),
      ...(native ? { nativeTools: true, cwd: request.cwd! } : {})
    });
    if (!config.stdin) args.push(prompt);

    const result = await (this.options.runner ?? defaultRunner)(
      command,
      args,
      config.stdin ? prompt : '',
      {
        cwd: native ? request.cwd! : (this.options.cwd ?? tmpdir()),
        timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(request.signal ? { signal: request.signal } : {})
      }
    );

    if (request.signal?.aborted) throw abortError();

    if (result.code !== 0) {
      const detail = result.stderr.trim().slice(0, 500);
      throw new Error(
        `本地 CLI agent ${this.provider.agent} 退出码 ${result.code ?? 'unknown'}${detail ? `：${detail}` : ''}`
      );
    }

    const raw = result.stdout.trim();
    const answer =
      this.provider.agent === 'codex' ? extractCodexAnswer(result.stdout) : raw;
    if (native) {
      if (!answer) {
        throw new Error(`本地 CLI agent ${this.provider.agent} 没有返回内容。`);
      }
      return { text: answer, usage: { inputTokens: 0, outputTokens: 0 } };
    }
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

  private isNative(request: ModelRequest): boolean {
    return this.provider.nativeTools === true && Boolean(request.cwd);
  }

  async stream(
    request: ModelRequest,
    onEvent: (event: ModelStreamEvent) => void
  ): Promise<ModelResponse> {
    const native = this.isNative(request);
    const config = native
      ? NATIVE_AGENT_CONFIG[this.provider.agent]
      : AGENT_CONFIG[this.provider.agent];
    if (
      !config.streamArgs ||
      (native &&
        (this.provider.agent === 'opencode' || this.provider.agent === 'zcode'))
    ) {
      const result = await this.complete(request);
      if (result.text.trim()) onEvent({ type: 'text', text: result.text.trim() });
      return result;
    }

    const command = this.provider.command?.trim() || this.provider.agent;
    const prompt = native ? buildNativePrompt(request, request.cwd!) : buildPrompt(request);
    const args = buildAgentArgs(this.provider, config.streamArgs, {
      ...(request.webTools ? { webTools: true } : {}),
      ...(native ? { nativeTools: true, cwd: request.cwd! } : {})
    });
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
      this.provider.agent === 'claude' && !native ? new EnvelopeTextGate(forward) : null;

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
        this.handleClaudeEvent(parsed, gate, forward, state, native);
      } else {
        this.handleCodexEvent(parsed, forward, state, native);
      }
    };

    const result = await (this.options.streamRunner ?? defaultStreamRunner)(
      command,
      args,
      config.stdin ? prompt : '',
      {
        cwd: native ? request.cwd! : (this.options.cwd ?? tmpdir()),
        timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(request.signal ? { signal: request.signal } : {})
      },
      handleLine
    );

    if (request.signal?.aborted) throw abortError();

    const gateResult = gate?.finish();
    if (gateResult) {
      state.text = gateResult.text;
      if (gateResult.toolCalls?.length) state.toolCalls = gateResult.toolCalls;
    }

    // Some CLIs emit the final answer only in the terminal `result` event and
    // never produce text deltas. Parse it here instead of spawning the CLI a
    // second time through the fallback path.
    if (!state.text.trim() && !state.toolCalls?.length && state.finalResult) {
      if (native) {
        state.text = state.finalResult;
      } else {
        const parsed = parseCliResponse(state.finalResult);
        state.text = parsed.text;
        if (parsed.toolCalls?.length) state.toolCalls = parsed.toolCalls;
      }
    }

    if (state.explicitFailure) {
      throw new Error(state.explicitFailure);
    }

    if (
      !state.emitted &&
      state.text.trim() &&
      !state.toolCalls?.length &&
      !gateResult?.fenced
    ) {
      forward({ type: 'text', text: state.text });
    }

    const hasPayload = Boolean(
      state.emitted || state.text.trim() || state.toolCalls?.length
    );

    if (result.code !== 0) {
      if (!hasPayload) {
        return this.streamFallback(request, onEvent);
      }
      const detail = result.stderr.trim().slice(0, 500);
      throw new Error(
        `本地 CLI agent ${this.provider.agent} 退出码 ${result.code ?? 'unknown'}${detail ? `：${detail}` : ''}`
      );
    }

    if (!hasPayload) {
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
    gate: EnvelopeTextGate | null,
    forward: (event: ModelStreamEvent) => void,
    state: StreamState,
    native = false
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
        if (gate) gate.push(delta['text']);
        else forward({ type: 'text', text: delta['text'] });
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
    state: StreamState,
    native = false
  ) {
    if (event['type'] === 'item.completed') {
      const item = event['item'];
      if (!isRecord(item)) return;
      if (item['type'] === 'reasoning' && typeof item['text'] === 'string' && item['text'].trim()) {
        forward({ type: 'reasoning', text: item['text'] });
        return;
      }
      if (item['type'] === 'agent_message' && typeof item['text'] === 'string') {
        if (native) {
          state.text = item['text'];
          if (item['text'].trim()) forward({ type: 'text', text: item['text'] });
          return;
        }
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
