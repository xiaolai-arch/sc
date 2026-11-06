import { access } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';

export type CliSpawnSpec =
  | { kind: 'direct'; command: string; args: string[] }
  | { kind: 'cmd'; command: string; args: string[] };

type PrepareOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
};

const DEFAULT_PATHEXT = ['.COM', '.EXE', '.BAT', '.CMD'];

/** PATHEXT entries normalized to start with a dot. */
export function windowsExtensions(env: NodeJS.ProcessEnv): string[] {
  const raw = env.PATHEXT?.trim();
  const entries = raw ? raw.split(';') : DEFAULT_PATHEXT;
  return [
    ...new Set(
      entries
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => (entry.startsWith('.') ? entry : `.${entry}`))
    )
  ];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a command the way cmd.exe would on Windows: PATH directories plus
 * PATHEXT. npm-installed CLIs are `.cmd` shims, which spawning without a shell
 * cannot find.
 */
export async function resolveWindowsCommand(
  command: string,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  const trimmed = command.trim();
  if (!trimmed) return null;
  if (isAbsolute(trimmed) || /[\\/]/.test(trimmed)) {
    return (await exists(trimmed)) ? trimmed : null;
  }
  const dirs = (env.PATH ?? env.Path ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const names = /\.[^.\\/]+$/.test(trimmed)
    ? [trimmed]
    : windowsExtensions(env).flatMap((extension) => [
        `${trimmed}${extension}`,
        `${trimmed}${extension.toLowerCase()}`
      ]);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (await exists(candidate)) return candidate;
    }
  }
  return null;
}

/** Quotes one argument for the command line cmd.exe will parse. */
export function quoteWindowsArgument(value: string): string {
  if (value.length === 0) return '""';
  if (!/[\s"&|<>^()%!]/u.test(value)) return value;
  let result = '"';
  let backslashes = 0;
  for (const char of value) {
    if (char === '\\') {
      backslashes += 1;
      continue;
    }
    if (char === '"') {
      result += `${'\\'.repeat(backslashes * 2 + 1)}"`;
      backslashes = 0;
      continue;
    }
    result += `${'\\'.repeat(backslashes)}${char}`;
    backslashes = 0;
  }
  result += `${'\\'.repeat(backslashes * 2)}"`;
  return result;
}

/**
 * Chooses how to start a local CLI. Native `.exe` files spawn directly; `.cmd`
 * shims (and bare command names that only cmd.exe can resolve) run through
 * `cmd /d /s /c`, with every argument quoted.
 */
export async function prepareCliSpawn(
  command: string,
  args: string[],
  options: PrepareOptions = {}
): Promise<CliSpawnSpec> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform !== 'win32') {
    return { kind: 'direct', command, args };
  }

  const resolved = await resolveWindowsCommand(command, env);
  const executable = resolved ?? command.trim();
  if (
    (resolved !== null && !/\.(cmd|bat)$/i.test(resolved)) ||
    /\.(exe|com)$/i.test(executable)
  ) {
    return { kind: 'direct', command: executable, args };
  }

  const line = [executable, ...args].map(quoteWindowsArgument).join(' ');
  return {
    kind: 'cmd',
    command: env.ComSpec?.trim() || 'cmd.exe',
    args: ['/d', '/s', '/c', line]
  };
}
