import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { LocalCliAgent, ProviderConfig } from '../../shared/types';
import type { ModelClient, ModelRequest, ModelResponse } from './model-client';

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

function buildPrompt(request: ModelRequest): string {
  return request.messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join('\n\n');
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
    const text =
      this.provider.agent === 'codex' ? extractCodexAnswer(result.stdout) : raw;
    if (!text) {
      throw new Error(`本地 CLI agent ${this.provider.agent} 没有返回内容。`);
    }

    return { text, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
