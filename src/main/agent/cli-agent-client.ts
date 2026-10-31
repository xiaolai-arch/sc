import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { LocalCliAgent, ProviderConfig } from '../../shared/types';
import type {
  ModelClient,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
  ModelToolDefinition
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

type AgentConfig = {
  args: string[];
  stdin: boolean;
};

const AGENT_CONFIG: Record<LocalCliAgent, AgentConfig> = {
  codex: { args: ['exec', '--skip-git-repo-check', '-'], stdin: true },
  claude: { args: ['-p', '--output-format', 'text'], stdin: true },
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

/**
 * Runs a locally installed CLI agent (codex/claude/zcode/opencode) as a
 * one-shot model client. No API key is involved: the CLI uses its own local
 * credentials. The CLI runs in a temp directory, not in the app repo or vault.
 */
export class CliAgentClient implements ModelClient {
  constructor(
    private readonly provider: LocalCliProvider,
    private readonly options: {
      runner?: CliRunner;
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
}
