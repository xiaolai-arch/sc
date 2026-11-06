import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import type { LocalCliAgent } from '../../shared/types';
import { prepareCliSpawn, resolveWindowsCommand } from './cli-command';
import type {
  LocalCliAuthStatus,
  LocalCliEntry,
  LocalCliFeature,
  LocalCliScanResult
} from '../../shared/local-cli';

type RunResult = { code: number | null; stdout: string; stderr: string };
type Runner = (
  command: string,
  args: string[],
  options: { timeoutMs: number }
) => Promise<RunResult>;
type Resolver = (name: string) => Promise<string | null>;

export interface LocalCliDiscoveryOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  /** Test seam; defaults to the running platform. */
  platform?: NodeJS.Platform;
  /** Extra directories to search before PATH. */
  pathDirs?: string[];
  /** Test seam; production spawns the real process. */
  run?: Runner;
  /** Test seam; production checks PATH and the login shell. */
  resolve?: Resolver;
  /** Test seam for the zcode credentials file. */
  readTextFile?: (path: string) => Promise<string>;
  now?: () => Date;
  timeoutMs?: number;
}

type AgentSpec = {
  agent: LocalCliAgent;
  label: string;
  binary: string;
  installHint: string;
};

const AGENTS: AgentSpec[] = [
  {
    agent: 'codex',
    label: 'Codex',
    binary: 'codex',
    installHint: 'npm install -g @openai/codex'
  },
  {
    agent: 'claude',
    label: 'Claude Code',
    binary: 'claude',
    installHint: 'npm install -g @anthropic-ai/claude-code'
  },
  {
    agent: 'zcode',
    label: 'ZCode',
    binary: 'zcode',
    installHint: '安装 zcode 后运行 zcode login'
  },
  {
    agent: 'opencode',
    label: 'OpenCode',
    binary: 'opencode',
    installHint: 'brew install opencode 或参阅 opencode.ai'
  }
];

const DEFAULT_TIMEOUT_MS = 4_000;
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

function firstLine(value: string, limit = 120): string {
  const line = stripAnsi(value)
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return (line ?? '').slice(0, limit);
}

function parseVersion(value: string): string | undefined {
  const text = stripAnsi(value);
  const match = /(?:^|[^\d])(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(text);
  if (match?.[1]) return match[1];
  const line = firstLine(value, 80);
  return line.length > 0 ? line : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function defaultRunner(
  command: string,
  args: string[],
  options: { timeoutMs: number }
): Promise<RunResult> {
  // On Windows npm-installed CLIs are `.cmd` shims; execFile cannot start one
  // without cmd.exe, so probes go through the same resolver as agent runs.
  const spec = await prepareCliSpawn(command, args);
  return new Promise((resolve) => {
    execFile(
      spec.command,
      spec.args,
      {
        timeout: options.timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        env: process.env
      },
      (error, stdout, stderr) => {
        const code =
          error === null
            ? 0
            : typeof (error as { code?: unknown }).code === 'number'
              ? ((error as { code: number }).code)
              : 1;
        resolve({
          code,
          stdout: String(stdout ?? ''),
          stderr: `${String(stderr ?? '')}${error?.killed ? 'timed out' : ''}`
        });
      }
    );
  });
}

async function isExecutable(
  path: string,
  platform: NodeJS.Platform
): Promise<boolean> {
  try {
    // Windows has no executable bit; PATHEXT resolution already chose the file.
    await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commonPathDirs(home: string, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return [join(home, 'AppData', 'Roaming', 'npm')];
  }
  return [
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.asdf', 'shims'),
    join(home, '.local', 'share', 'mise', 'shims'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin'
  ];
}

function pathDirsFromEnv(
  env: NodeJS.ProcessEnv,
  home: string,
  platform: NodeJS.Platform
): string[] {
  const fromPath = (env.PATH ?? env.Path ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set([...fromPath, ...commonPathDirs(home, platform)])];
}

const SAFE_BINARY = /^[A-Za-z0-9._-]+$/;

/**
 * Resolves a CLI binary. GUI-launched Electron apps often do not inherit the
 * user's shell PATH (nvm, asdf, mise, Homebrew), so a login-shell lookup is the
 * fallback when the direct PATH search misses.
 */
async function defaultResolve(
  name: string,
  env: NodeJS.ProcessEnv,
  home: string,
  pathDirs: string[],
  run: Runner,
  platform: NodeJS.Platform
): Promise<string | null> {
  if (name.includes('/') || name.includes('\\') || isAbsolute(name)) {
    return (await isExecutable(name, platform)) ? name : null;
  }
  if (!SAFE_BINARY.test(name)) return null;

  if (platform === 'win32') {
    const resolved = await resolveWindowsCommand(name, {
      ...env,
      PATH: pathDirs.join(delimiter)
    });
    if (resolved !== null) return resolved;
    // `where` also finds App Execution Aliases that are not plain files.
    const where = await run('where', [name], { timeoutMs: 2_500 });
    if (where.code === 0) {
      const found = stripAnsi(where.stdout)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => isAbsolute(line));
      if (found && (await isExecutable(found, platform))) return found;
    }
    return null;
  }

  for (const dir of pathDirs) {
    const candidate = join(dir, name);
    if (await isExecutable(candidate, platform)) return candidate;
  }
  const shell = env.SHELL?.trim() || '/bin/zsh';
  const probe = await run(shell, ['-lc', `command -v -- ${name}`], {
    timeoutMs: 2_500
  });
  if (probe.code !== 0) return null;
  const path = stripAnsi(probe.stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .reverse()
    .find((line) => isAbsolute(line));
  return path && (await isExecutable(path, platform)) ? path : null;
}

function hasFeature(help: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(help));
}

function detectFeatures(agent: LocalCliAgent, help: string): LocalCliFeature[] {
  const features = new Set<LocalCliFeature>();
  features.add('native-tools');
  if (agent === 'codex') {
    if (hasFeature(help, [/--json\b/])) features.add('streaming');
    // Codex accepts -c model_reasoning_effort even when --help does not show it.
    features.add('reasoning');
    if (hasFeature(help, [/\bresume\b/])) features.add('sessions');
    if (hasFeature(help, [/--sandbox\b/])) features.add('sandbox');
    if (hasFeature(help, [/--search\b|web_search|web-search/i])) features.add('web');
    if (hasFeature(help, [/--image\b/])) features.add('images');
    return [...features];
  }
  if (agent === 'claude') {
    if (hasFeature(help, [/stream-json\b/])) features.add('streaming');
    if (hasFeature(help, [/--effort\b|thinking/i])) features.add('reasoning');
    if (hasFeature(help, [/--resume\b/])) features.add('sessions');
    if (hasFeature(help, [/\bmcp\b/i])) features.add('mcp');
    if (hasFeature(help, [/skills|plugins?|--plugin-dir\b/i])) features.add('skills');
    if (hasFeature(help, [/WebSearch|WebFetch|--tools\b/])) features.add('web');
    if (hasFeature(help, [/--add-dir\b|--permission-mode\b/])) features.add('sandbox');
    return [...features];
  }
  if (agent === 'zcode') {
    if (hasFeature(help, [/--json\b/])) features.add('streaming');
    if (hasFeature(help, [/\bresume\b|--continue\b/])) features.add('sessions');
    if (hasFeature(help, [/\bmcp\b/i])) features.add('mcp');
    if (hasFeature(help, [/\bskills?\b/i])) features.add('skills');
    if (hasFeature(help, [/browser-use|WebFetch|WebSearch/i])) features.add('web');
    if (hasFeature(help, [/--mode\b/])) features.add('sandbox');
    return [...features];
  }
  if (hasFeature(help, [/--format\b/]) && hasFeature(help, [/\bjson\b/])) {
    features.add('streaming');
  }
  if (hasFeature(help, [/--thinking\b|thinking/i])) features.add('reasoning');
  if (hasFeature(help, [/--session\b|\bsession\b/])) features.add('sessions');
  if (hasFeature(help, [/\bmcp\b/i])) features.add('mcp');
  if (hasFeature(help, [/\bmodels?\b/])) features.add('models');
  return [...features];
}

function authFromCodexStatus(value: string, code: number | null): {
  auth: LocalCliAuthStatus;
  detail: string;
} {
  const text = stripAnsi(value);
  if (/not logged in|no credentials|not authenticated/i.test(text)) {
    return { auth: 'missing', detail: '未登录' };
  }
  if (/logged in|api key configured|access token/i.test(text)) {
    return { auth: 'ready', detail: '已登录' };
  }
  return code === 0
    ? { auth: 'unknown', detail: '无法确认登录状态' }
    : { auth: 'unknown', detail: '无法确认登录状态' };
}

function authFromClaudeStatus(value: string): {
  auth: LocalCliAuthStatus;
  detail: string;
} {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) throw new Error('not an object');
    if (parsed['loggedIn'] === true) {
      const method = typeof parsed['authMethod'] === 'string' ? parsed['authMethod'] : '';
      return {
        auth: 'ready',
        detail: method === 'oauth_token' ? 'OAuth 已登录' : method ? `已登录（${method}）` : '已登录'
      };
    }
    return { auth: 'missing', detail: '未登录' };
  } catch {
    return { auth: 'unknown', detail: '无法确认登录状态' };
  }
}

function authFromOpencodeStatus(value: string): {
  auth: LocalCliAuthStatus;
  detail: string;
} {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    let connections = 0;
    for (const provider of parsed) {
      if (!isRecord(provider)) continue;
      const list = provider['connections'];
      if (Array.isArray(list)) connections += list.length;
    }
    return connections > 0
      ? { auth: 'ready', detail: `${connections} 个可用凭据` }
      : { auth: 'missing', detail: '未登录' };
  } catch {
    return { auth: 'unknown', detail: '无法确认登录状态' };
  }
}

async function zcodeAuth(
  home: string,
  readTextFile: (path: string) => Promise<string>
): Promise<{ auth: LocalCliAuthStatus; detail: string }> {
  const candidates = [
    join(home, '.zcode', 'v2', 'credentials.json'),
    join(home, '.zcode', 'credentials.json')
  ];
  for (const path of candidates) {
    try {
      const raw = await readTextFile(path);
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed) && Object.keys(parsed).length > 0) {
        return { auth: 'ready', detail: '已保存登录凭据' };
      }
    } catch {
      // Try the next location; a missing file is the normal signed-out state.
    }
  }
  return { auth: 'unknown', detail: '在 zcode 内运行 /login 确认' };
}

function parseModels(output: string): string[] {
  const models = [
    ...new Set(
      stripAnsi(output)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^[A-Za-z0-9._-]+\/[A-Za-z0-9._#/-]+$/.test(line))
    )
  ];
  return models.slice(0, 200);
}

function helpArgs(agent: LocalCliAgent): string[][] {
  switch (agent) {
    case 'codex':
      return [['--help'], ['exec', '--help']];
    case 'claude':
      return [['--help']];
    case 'zcode':
      return [['--help']];
    case 'opencode':
      return [['--help'], ['run', '--help']];
  }
}

async function probeAuth(
  spec: AgentSpec,
  path: string,
  run: Runner,
  timeoutMs: number,
  home: string,
  readTextFile: (path: string) => Promise<string>
): Promise<{ auth: LocalCliAuthStatus; detail: string }> {
  if (spec.agent === 'codex') {
    const result = await run(path, ['login', 'status'], { timeoutMs });
    return authFromCodexStatus(`${result.stdout}\n${result.stderr}`, result.code);
  }
  if (spec.agent === 'claude') {
    const result = await run(path, ['auth', 'status', '--json'], { timeoutMs });
    return authFromClaudeStatus(result.stdout || result.stderr);
  }
  if (spec.agent === 'opencode') {
    const result = await run(path, ['auth', 'list', '--format', 'json'], { timeoutMs });
    return authFromOpencodeStatus(result.stdout || result.stderr);
  }
  return zcodeAuth(home, readTextFile);
}

async function probeAgent(
  spec: AgentSpec,
  resolve: Resolver,
  run: Runner,
  timeoutMs: number,
  home: string,
  readTextFile: (path: string) => Promise<string>
): Promise<LocalCliEntry> {
  const path = await resolve(spec.binary);
  if (!path) {
    return {
      agent: spec.agent,
      label: spec.label,
      command: spec.binary,
      installed: false,
      auth: 'unknown',
      features: [],
      installHint: spec.installHint
    };
  }

  const [versionResult, ...helpResults] = await Promise.all([
    run(path, ['--version'], { timeoutMs }),
    ...helpArgs(spec.agent).map((args) => run(path, args, { timeoutMs }))
  ]);
  const help = helpResults.map((result) => `${result.stdout}\n${result.stderr}`).join('\n');
  const version = parseVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
  const auth = await probeAuth(spec, path, run, timeoutMs, home, readTextFile);
  const features = detectFeatures(spec.agent, help);

  let models: string[] | undefined;
  if (features.includes('models')) {
    const modelResult = await run(path, ['models'], { timeoutMs });
    if (modelResult.code === 0) {
      const parsed = parseModels(modelResult.stdout);
      if (parsed.length > 0) models = parsed;
    }
  }

  return {
    agent: spec.agent,
    label: spec.label,
    command: spec.binary,
    installed: true,
    path,
    ...(version ? { version } : {}),
    auth: auth.auth,
    ...(auth.detail ? { authDetail: auth.detail } : {}),
    features,
    ...(models ? { models } : {})
  };
}

/**
 * Scans the local machine for supported CLI agents. No network calls are made:
 * version/help/auth probes are local commands, and only login *state* is kept
 * (never keys, tokens, or raw credential files).
 */
export async function scanLocalClis(
  options: LocalCliDiscoveryOptions = {}
): Promise<LocalCliScanResult> {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const run = options.run ?? defaultRunner;
  const pathDirs = [
    ...(options.pathDirs ?? []),
    ...pathDirsFromEnv(env, home, platform)
  ];
  const resolve =
    options.resolve ??
    ((name: string) => defaultResolve(name, env, home, pathDirs, run, platform));
  const readTextFile = options.readTextFile ?? ((path: string) => readFile(path, 'utf8'));

  const entries = await Promise.all(
    AGENTS.map((spec) =>
      probeAgent(spec, resolve, run, timeoutMs, home, readTextFile).catch(
        (error: unknown): LocalCliEntry => ({
          agent: spec.agent,
          label: spec.label,
          command: spec.binary,
          installed: false,
          auth: 'unknown',
          features: [],
          installHint: spec.installHint,
          error: error instanceof Error ? error.message : '扫描失败'
        })
      )
    )
  );

  return {
    scannedAt: (options.now ?? (() => new Date()))().toISOString(),
    entries
  };
}
