import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { prepareCliSpawn } from './cli-command';
import type { LocalCliAgent, ProviderConfig } from '../../shared/types';
import {
  ModelImageUnsupportedError,
  ModelTimeoutError,
  type ModelClient,
  type ModelImage,
  type ModelMessage,
  type ModelRequest,
  type ModelResponse,
  type ModelStreamEvent,
  type ModelToolCall,
  type ModelToolDefinition,
  type StreamingModelClient
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
  options: CliTimeoutOptions & { cwd: string; signal?: AbortSignal }
) => Promise<CliRunResult>;

export type CliStreamRunner = (
  command: string,
  args: string[],
  input: string,
  options: CliTimeoutOptions & { cwd: string; signal?: AbortSignal },
  onLine: (line: string) => void
) => Promise<CliRunResult>;

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

type KillableChild = Pick<ChildProcess, 'pid' | 'kill'>;

/**
 * Stops the CLI and everything it spawned. On Windows a `.cmd` launcher exits
 * long before its Node child, so killing only the direct child leaves a native
 * agent editing the vault after the turn was reported as timed out.
 */
export function terminateProcessTree(
  child: KillableChild,
  platform = process.platform
): void {
  try {
    child.kill('SIGTERM');
  } catch {
    // Already exited.
  }
  if (platform !== 'win32' || typeof child.pid !== 'number') return;
  try {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    killer?.on?.('error', () => undefined);
    killer?.unref?.();
  } catch {
    // The direct kill above is the fallback.
  }
}

type AgentConfig = {
  args: string[];
  streamArgs?: string[];
  stdin: boolean;
  /** CLI flag that takes the prompt as its value; appended right before it. */
  promptFlag?: string;
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
const NATIVE_AGENT_CONFIG: Record<LocalCliAgent, AgentConfig> = {
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
  zcode: {
    // `-p <text>` takes the prompt as its value, so it must come last: flags
    // placed after it would be swallowed as the prompt.
    args: ['--mode', 'edit'],
    streamArgs: ['--json', '--mode', 'edit'],
    stdin: false,
    promptFlag: '-p'
  },
  opencode: {
    args: ['run', '--auto'],
    streamArgs: ['run', '--format', 'json', '--auto'],
    stdin: false
  }
};

/** Overall ceiling for one CLI turn. A long answer may legitimately take this. */
const DEFAULT_TIMEOUT_MS = 900_000;
/**
 * Native agents edit files and run tools inside the vault, so a legitimate turn
 * can be much longer than a single one-shot answer.
 */
const NATIVE_TIMEOUT_MS = 1_800_000;
/** The CLI must say something (stdout or stderr) within this after spawning. */
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;
/** After the first output, this much silence means the CLI has stalled. */
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

function formatTimeout(ms: number): string {
  return ms % 60_000 === 0 ? `${ms / 60_000} 分钟` : `${Math.round(ms / 1000)} 秒`;
}

export type CliTimeoutOptions = {
  /** Total wall-clock ceiling for the whole turn. */
  timeoutMs: number;
  startupTimeoutMs?: number;
  idleTimeoutMs?: number;
};

type CliWatchdog = {
  /** Records output; the idle clock only starts once the CLI has spoken. */
  touch(): void;
  stop(): void;
};

/**
 * Three clocks instead of one: a process that starts and then keeps producing
 * output must not be killed for "taking too long", while a process that never
 * answers and one that stalls mid-answer need different messages.
 */
export function createCliWatchdog(
  options: CliTimeoutOptions,
  onTimeout: (error: ModelTimeoutError) => void
): CliWatchdog {
  const totalMs = options.timeoutMs;
  const startupMs = Math.min(options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS, totalMs);
  const idleMs = Math.min(options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS, totalMs);
  let active = true;
  let sawOutput = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    active = false;
    clearTimeout(totalTimer);
    clearTimeout(startupTimer);
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
  };
  const fire = (error: ModelTimeoutError) => {
    if (!active) return;
    stop();
    onTimeout(error);
  };

  const totalTimer = setTimeout(() => {
    fire(
      new ModelTimeoutError(
        totalMs,
        `本地 CLI agent 运行超过 ${formatTimeout(totalMs)}（总时长上限）。`
      )
    );
  }, totalMs);
  totalTimer.unref?.();

  const startupTimer = setTimeout(() => {
    if (sawOutput) return;
    fire(
      new ModelTimeoutError(
        startupMs,
        `本地 CLI agent 启动后 ${formatTimeout(startupMs)} 没有响应（启动超时）。`
      )
    );
  }, startupMs);
  startupTimer.unref?.();

  const armIdle = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      fire(
        new ModelTimeoutError(
          idleMs,
          `本地 CLI agent 超过 ${formatTimeout(idleMs)} 没有输出（无活动超时）。`
        )
      );
    }, idleMs);
    idleTimer.unref?.();
  };

  return {
    touch() {
      if (!active) return;
      sawOutput = true;
      armIdle();
    },
    stop
  };
}

/** Images attached to any user message in the conversation. */
function collectImages(request: ModelRequest): ModelImage[] {
  const images: ModelImage[] = [];
  for (const message of request.messages) {
    // Images belong to user turns; assistant/tool/system messages ignore them.
    if (message.role === 'user' && message.images?.length) {
      images.push(...message.images);
    }
  }
  return images;
}

async function encodeImages(
  images: ModelImage[]
): Promise<Array<{ mediaType: string; data: string }>> {
  const encoded: Array<{ mediaType: string; data: string }> = [];
  for (const image of images) {
    const bytes = await readFile(image.path);
    encoded.push({ mediaType: image.mediaType, data: bytes.toString('base64') });
  }
  return encoded;
}

/**
 * The single stream-json user message a claude CLI call reads from stdin.
 * Claude expects one JSON object per line; text comes before the image blocks.
 */
export function buildClaudeStreamJsonInput(
  text: string,
  images: Array<{ mediaType: string; data: string }>
): string {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text }];
  for (const image of images) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.data }
    });
  }
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
}

/**
 * Adds the provider's image flags. claude carries images in its stdin payload,
 * so only codex (`-i`) and opencode (`--file`) add arguments here.
 */
function addImageArgs(
  agent: LocalCliAgent,
  args: string[],
  images: ModelImage[]
): string[] {
  if (images.length === 0) return args;
  if (agent === 'claude') return args;
  if (agent === 'codex') {
    const next = [...args];
    const additions = images.flatMap((image) => ['-i', image.path]);
    const stdinIndex = next.lastIndexOf('-');
    if (stdinIndex >= 0) next.splice(stdinIndex, 0, ...additions);
    else next.push(...additions);
    return next;
  }
  if (agent === 'opencode') {
    return [...args, ...images.flatMap((image) => ['--file', image.path])];
  }
  // zcode
  throw new ModelImageUnsupportedError(agent);
}

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
  options: {
    webTools?: boolean;
    nativeTools?: boolean;
    cwd?: string;
    noTools?: boolean;
    allowWrites?: boolean;
    allowShell?: boolean;
  } = {}
): string[] {
  const args = [...baseArgs];
  const native = options.nativeTools === true;
  const noTools = options.noTools === true;

  if (provider.agent === 'codex') {
    const model = provider.model?.trim();
    const effort = provider.effort ?? 'medium';
    const additions: string[] = [];
    if (model) additions.push('-m', model);
    additions.push('-c', `model_reasoning_effort=${effort}`);
    if (native && options.cwd) {
      additions.push('-C', options.cwd);
      additions.push('--sandbox', options.allowWrites === false ? 'read-only' : 'workspace-write');
    }
    // `allowShell === false` cannot be enforced for codex: its sandbox levels
    // gate writes, not command execution, and no public flag disables the
    // shell tool. The ASAKI tool envelope stays permission-guarded; only
    // codex's own native commands can still run.
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
    // Native mode keeps its full file toolset; permissions only subtract from
    // it. One-shot mode gets an explicit web-only toolset instead.
    const disallowed: string[] = [];
    if (native && options.allowWrites === false) {
      disallowed.push('Edit', 'Write', 'MultiEdit', 'NotebookEdit');
    }
    if (native && options.allowShell === false) {
      disallowed.push('Bash', 'BashOutput');
    }
    if (noTools) {
      args.push('--tools', '');
    } else if (options.webTools) {
      if (native) {
        // `--tools` would also replace the native file/search tools, so in
        // native mode web access is granted without narrowing the toolset.
        args.push('--allowedTools', 'WebSearch,WebFetch');
      } else {
        args.push('--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch,WebFetch');
      }
    }
    if (disallowed.length > 0) {
      args.push('--disallowedTools', disallowed.join(','));
    }
  }

  // opencode and zcode have no permission flags; when they run with tools
  // enabled, only the ASAKI envelope's permission guard limits writes.

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
  // A no-tools request must not even advertise the tool protocol, otherwise
  // the CLI may answer with tool calls the caller cannot execute.
  if (request.tools?.length && !request.noTools) {
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
  const withTools = Boolean(request.tools?.length) && !request.noTools;
  const environment = [
    '## 原生 agent 模式',
    `你正在 ASAKI 的本地项目中运行，当前目录：${cwd}`,
    '你可以使用自己的原生联网、搜索、读文件工具来查资料和了解上下文。',
    '只读取或修改这个项目以及 ASAKI 的 vault；不要读取密钥、SSH、浏览器历史等私人数据。',
    withTools
      ? [
          'ASAKI 的记录（项目、任务、长期计划、笔记、提醒、复盘、知识、记忆、档案）',
          '必须通过下面的「工具调用协议」写入，由 ASAKI 落盘到它自己的数据结构；',
          '不要用原生文件工具自创目录（如 projects/、tasks/）来保存这些记录，',
          '也不要手写 frontmatter 来表达任务或计划——应用只读取通过工具写入的结构。',
          '原生文件工具只用于：联网查资料、读取参考文件、以及用户明确要求整理的自由文档。'
        ].join('\n')
      : '如果修改 vault，保留现有 markdown/frontmatter 结构，不要重命名或删除无关文件。',
    '回答用中文，先给结论；如果修改了数据，简短说明改了哪些内容。'
  ].join('\n');
  const parts = request.messages.map(renderMessage);
  parts.splice(systemIndex >= 0 ? systemIndex + 1 : 0, 0, environment);
  // Native agents see the same tool protocol: ASAKI records must go through
  // the envelope, or the app can never read what the CLI wrote.
  if (withTools) {
    parts.splice(
      systemIndex >= 0 ? systemIndex + 2 : 1,
      0,
      renderToolSection(request.tools ?? [])
    );
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

async function defaultRunner(
  command: string,
  args: string[],
  input: string,
  options: CliTimeoutOptions & { cwd: string; signal?: AbortSignal }
): Promise<CliRunResult> {
  if (options.signal?.aborted) throw abortError();
  const spec = await prepareCliSpawn(command, args);
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(spec.command, spec.args, {
        cwd: options.cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let watchdog: CliWatchdog | null = null;
    const cleanup = () => {
      options.signal?.removeEventListener('abort', onAbort);
      watchdog?.stop();
    };
    const finish = (result: CliRunResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      terminateProcessTree(child);
      fail(abortError());
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    watchdog = createCliWatchdog(options, (error) => {
      terminateProcessTree(child);
      fail(error);
    });

    child.stdout?.on('data', (chunk: Buffer | string) => {
      watchdog?.touch();
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      watchdog?.touch();
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

async function defaultStreamRunner(
  command: string,
  args: string[],
  input: string,
  options: CliTimeoutOptions & { cwd: string; signal?: AbortSignal },
  onLine: (line: string) => void
): Promise<CliRunResult> {
  if (options.signal?.aborted) throw abortError();
  const spec = await prepareCliSpawn(command, args);
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(spec.command, spec.args, {
        cwd: options.cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let pending = '';
    let settled = false;
    let watchdog: CliWatchdog | null = null;

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

    const cleanup = () => {
      options.signal?.removeEventListener('abort', onAbort);
      watchdog?.stop();
    };
    const finish = (result: CliRunResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      flush('', true);
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      terminateProcessTree(child);
      fail(abortError());
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    watchdog = createCliWatchdog(options, (error) => {
      terminateProcessTree(child);
      fail(error);
    });

    child.stdout?.on('data', (chunk: Buffer | string) => {
      watchdog?.touch();
      const text = chunk.toString();
      stdout += text;
      flush(text, false);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      watchdog?.touch();
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
  /** Thinking text already forwarded, used to avoid duplicating full blocks. */
  reasoningText: string;
  finalResult: string;
  usage: { inputTokens: number; outputTokens: number };
  toolCalls?: ModelToolCall[];
  explicitFailure?: string;
  /** Native tool ids already announced, so start/complete events pair up once. */
  startedTools: Set<string>;
  toolNames: Map<string, string>;
};

/** Chinese labels for the tools local CLIs report natively. */
const NATIVE_TOOL_LABELS: Record<string, string> = {
  Bash: '执行命令',
  BashOutput: '读取命令输出',
  Read: '读取文件',
  Write: '写入文件',
  Edit: '修改文件',
  MultiEdit: '修改文件',
  NotebookEdit: '修改笔记本',
  Glob: '查找文件',
  Grep: '搜索内容',
  WebFetch: '读取网页',
  WebSearch: '联网搜索',
  TodoWrite: '更新待办',
  Task: '调用子任务',
  command_execution: '执行命令',
  file_change: '修改文件',
  mcp_tool_call: '调用 MCP 工具',
  web_search: '联网搜索',
  todo_list: '更新待办'
};

function nativeToolLabel(name: string): string {
  return NATIVE_TOOL_LABELS[name] ?? name;
}

/** Announces a native tool once, even if several events describe it. */
function announceTool(
  state: StreamState,
  forward: (event: ModelStreamEvent) => void,
  id: string,
  name: string,
  label?: string
) {
  if (!id || state.startedTools.has(id)) return;
  state.startedTools.add(id);
  state.toolNames.set(id, name);
  forward({ type: 'tool-start', id, name, label: label ?? nativeToolLabel(name) });
}

function finishTool(
  state: StreamState,
  forward: (event: ModelStreamEvent) => void,
  id: string,
  ok: boolean,
  detail?: string
) {
  if (!id) return;
  const name = state.toolNames.get(id) ?? id;
  forward({
    type: 'tool-result',
    id,
    name,
    label: nativeToolLabel(name),
    ok,
    ...(detail ? { detail } : {})
  });
}

/** Keeps tool rows to one readable line; the full output stays with the CLI. */
function summarizeDetail(text: string): string | undefined {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return undefined;
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
}

function toolResultDetail(content: unknown): string | undefined {
  if (typeof content === 'string') return summarizeDetail(content);
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((item) => (isRecord(item) && typeof item['text'] === 'string' ? item['text'] : ''))
    .filter(Boolean)
    .join('\n');
  return text ? summarizeDetail(text) : undefined;
}

const CODEX_TOOL_ITEMS = new Set([
  'command_execution',
  'file_change',
  'mcp_tool_call',
  'web_search',
  'todo_list'
]);

function codexToolItem(item: Record<string, unknown>): boolean {
  return typeof item['type'] === 'string' && CODEX_TOOL_ITEMS.has(item['type']);
}

function codexToolLabel(item: Record<string, unknown>): string {
  if (item['type'] === 'mcp_tool_call') {
    const server = typeof item['server'] === 'string' ? item['server'] : '';
    const tool = typeof item['tool'] === 'string' ? item['tool'] : '';
    if (server || tool) return `${server}${server && tool ? ' · ' : ''}${tool}`;
  }
  return nativeToolLabel(String(item['type']));
}

function codexToolDetail(item: Record<string, unknown>): string | undefined {
  if (typeof item['aggregated_output'] === 'string') {
    const output = summarizeDetail(item['aggregated_output']);
    if (output) return output;
  }
  if (typeof item['command'] === 'string') return summarizeDetail(item['command']);
  if (Array.isArray(item['changes'])) {
    const changes = item['changes']
      .filter(isRecord)
      .map((change) => {
        const kind = typeof change['kind'] === 'string' ? `${change['kind']} ` : '';
        const path = typeof change['path'] === 'string' ? change['path'] : '';
        return `${kind}${path}`.trim();
      })
      .filter(Boolean);
    if (changes.length > 0) return summarizeDetail(changes.join('，'));
  }
  if (isRecord(item['error']) && typeof item['error']['message'] === 'string') {
    return summarizeDetail(item['error']['message']);
  }
  if (typeof item['query'] === 'string') return summarizeDetail(item['query']);
  if (Array.isArray(item['items'])) return `${item['items'].length} 项`;
  return undefined;
}

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
      /** Total ceiling; startup and idle windows derive from it. */
      timeoutMs?: number;
      startupTimeoutMs?: number;
      idleTimeoutMs?: number;
    } = {}
  ) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const native = this.isNative(request);
    const config = native
      ? NATIVE_AGENT_CONFIG[this.provider.agent]
      : AGENT_CONFIG[this.provider.agent];
    const command = this.provider.command?.trim() || this.provider.agent;
    const prompt = native ? buildNativePrompt(request, request.cwd!) : buildPrompt(request);
    const images = collectImages(request);
    const noTools = request.noTools === true;
    const args = addImageArgs(
      this.provider.agent,
      buildAgentArgs(this.provider, config.args, {
        ...(request.webTools && !noTools ? { webTools: true } : {}),
        ...(native ? { nativeTools: true, cwd: request.cwd! } : {}),
        ...(native && request.allowWrites !== undefined
          ? { allowWrites: request.allowWrites }
          : {}),
        ...(native && request.allowShell !== undefined
          ? { allowShell: request.allowShell }
          : {}),
        ...(noTools ? { noTools: true } : {})
      }),
      images
    );
    let input = config.stdin ? prompt : '';
    if (images.length > 0 && this.provider.agent === 'claude') {
      // Claude reads a stream-json user message from stdin when it carries
      // images; there must be no positional prompt in this mode.
      args.push('--input-format', 'stream-json');
      input = buildClaudeStreamJsonInput(prompt, await encodeImages(images));
    }
    if (!config.stdin) {
      if (config.promptFlag) args.push(config.promptFlag, prompt);
      else args.push(prompt);
    }

    const result = await (this.options.runner ?? defaultRunner)(
      command,
      args,
      input,
      {
        cwd: native ? request.cwd! : (this.options.cwd ?? tmpdir()),
        ...this.timeoutOptions(request, native),
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
      // With the tool protocol advertised, the final answer may be a tool
      // envelope the butler must execute; only plain answers stay verbatim.
      if (request.tools?.length && !request.noTools) {
        const parsed = parseCliResponse(answer);
        if (parsed.text || parsed.toolCalls?.length) {
          return {
            text: parsed.text,
            usage: { inputTokens: 0, outputTokens: 0 },
            ...(parsed.toolCalls?.length ? { toolCalls: parsed.toolCalls } : {})
          };
        }
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

  private timeoutOptions(request: ModelRequest, native: boolean): CliTimeoutOptions {
    return {
      timeoutMs: this.resolveTimeoutMs(request, native),
      ...(this.options.startupTimeoutMs !== undefined
        ? { startupTimeoutMs: this.options.startupTimeoutMs }
        : {}),
      ...(this.options.idleTimeoutMs !== undefined
        ? { idleTimeoutMs: this.options.idleTimeoutMs }
        : {})
    };
  }

  private resolveTimeoutMs(request: ModelRequest, native: boolean): number {
    return (
      request.timeoutMs ??
      this.options.timeoutMs ??
      (native ? NATIVE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)
    );
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
        (this.provider.agent === 'opencode' || this.provider.agent === 'zcode')) ||
      // Images travel through the one-shot stdin payload; the text-output path
      // already reads that shape and tells the caller clearly when the
      // provider cannot read images at all.
      collectImages(request).length > 0
    ) {
      const result = await this.complete(request);
      if (result.text.trim()) onEvent({ type: 'text', text: result.text.trim() });
      return result;
    }

    const command = this.provider.command?.trim() || this.provider.agent;
    const prompt = native ? buildNativePrompt(request, request.cwd!) : buildPrompt(request);
    const noTools = request.noTools === true;
    const args = buildAgentArgs(this.provider, config.streamArgs, {
      ...(request.webTools && !noTools ? { webTools: true } : {}),
      ...(native ? { nativeTools: true, cwd: request.cwd! } : {}),
      ...(native && request.allowWrites !== undefined
        ? { allowWrites: request.allowWrites }
        : {}),
      ...(native && request.allowShell !== undefined
        ? { allowShell: request.allowShell }
        : {}),
      ...(noTools ? { noTools: true } : {})
    });
    if (!config.stdin) {
      if (config.promptFlag) args.push(config.promptFlag, prompt);
      else args.push(prompt);
    }

    const state: StreamState = {
      emitted: false,
      text: '',
      reasoningText: '',
      finalResult: '',
      usage: { inputTokens: 0, outputTokens: 0 },
      startedTools: new Set(),
      toolNames: new Map()
    };
    const forward = (event: ModelStreamEvent) => {
      state.emitted = true;
      onEvent(event);
    };
    // Native agents that were advertised the ASAKI tool protocol can also end
    // with an envelope, so the gate must hold fenced JSON back for them too.
    const withTools = Boolean(request.tools?.length) && !request.noTools;
    const gate =
      this.provider.agent === 'claude' && (!native || withTools)
        ? new EnvelopeTextGate(forward)
        : null;

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
        ...this.timeoutOptions(request, native),
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
      if (native && !withTools) {
        state.text = state.finalResult;
      } else {
        const parsed = parseCliResponse(state.finalResult);
        state.text = parsed.text;
        if (parsed.toolCalls?.length) state.toolCalls = parsed.toolCalls;
      }
    }

    // A native codex streams its answer verbatim; if that answer turns out to
    // be a tool envelope, strip it and hand the calls to the butler.
    if (native && withTools && !state.toolCalls?.length && state.text.trim()) {
      const parsed = parseCliResponse(state.text);
      if (parsed.toolCalls?.length) {
        state.text = parsed.text;
        state.toolCalls = parsed.toolCalls;
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
      if (!isRecord(streamEvent)) return;
      if (streamEvent['type'] === 'content_block_start') {
        const block = streamEvent['content_block'];
        if (isRecord(block) && block['type'] === 'tool_use') {
          const id = typeof block['id'] === 'string' ? block['id'] : '';
          const name = typeof block['name'] === 'string' ? block['name'] : 'tool';
          announceTool(state, forward, id, name);
        }
        return;
      }
      if (streamEvent['type'] !== 'content_block_delta') return;
      const delta = streamEvent['delta'];
      if (!isRecord(delta)) return;
      if (delta['type'] === 'thinking_delta' && typeof delta['thinking'] === 'string') {
        state.reasoningText += delta['thinking'];
        forward({ type: 'reasoning', text: delta['thinking'] });
        return;
      }
      if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
        if (gate) gate.push(delta['text']);
        else forward({ type: 'text', text: delta['text'] });
      }
      return;
    }

    // Full assistant/user messages carry the tool lifecycle as well; the start
    // and result are deduplicated by tool id.
    if (event['type'] === 'assistant' || event['type'] === 'user') {
      const message = event['message'];
      if (!isRecord(message) || !Array.isArray(message['content'])) return;
      for (const block of message['content']) {
        if (!isRecord(block)) continue;
        if (block['type'] === 'thinking') {
          // Deltas may be absent (or the provider may only expose the final
          // thinking block); forward only the part not streamed already.
          const thinking =
            typeof block['thinking'] === 'string'
              ? block['thinking']
              : typeof block['text'] === 'string'
                ? block['text']
                : '';
          if (thinking && thinking.startsWith(state.reasoningText)) {
            const suffix = thinking.slice(state.reasoningText.length);
            state.reasoningText = thinking;
            if (suffix) forward({ type: 'reasoning', text: suffix });
          } else if (thinking && !state.reasoningText) {
            state.reasoningText = thinking;
            forward({ type: 'reasoning', text: thinking });
          }
          continue;
        }
        if (block['type'] === 'tool_use') {
          const id = typeof block['id'] === 'string' ? block['id'] : '';
          const name = typeof block['name'] === 'string' ? block['name'] : 'tool';
          announceTool(state, forward, id, name);
        } else if (block['type'] === 'tool_result') {
          const id = typeof block['tool_use_id'] === 'string' ? block['tool_use_id'] : '';
          finishTool(
            state,
            forward,
            id,
            block['is_error'] !== true,
            toolResultDetail(block['content'])
          );
        }
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
    if (event['type'] === 'item.started' || event['type'] === 'item.updated') {
      const item = event['item'];
      if (!isRecord(item) || !codexToolItem(item)) return;
      const id = typeof item['id'] === 'string' ? item['id'] : '';
      const kind = typeof item['type'] === 'string' ? item['type'] : 'tool';
      announceTool(state, forward, id, kind, codexToolLabel(item));
      return;
    }

    if (event['type'] === 'item.completed') {
      const item = event['item'];
      if (!isRecord(item)) return;
      if (codexToolItem(item)) {
        const id = typeof item['id'] === 'string' ? item['id'] : '';
        const kind = typeof item['type'] === 'string' ? item['type'] : 'tool';
        announceTool(state, forward, id, kind, codexToolLabel(item));
        const status = typeof item['status'] === 'string' ? item['status'] : '';
        const exitCode = item['exit_code'];
        const ok =
          status !== 'failed' &&
          status !== 'declined' &&
          (typeof exitCode !== 'number' || exitCode === 0);
        finishTool(state, forward, id, ok, codexToolDetail(item));
        return;
      }
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
