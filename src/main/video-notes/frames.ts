import { spawn as nodeSpawn } from 'node:child_process';

/**
 * Minimal child-process surface used by the keyframe pipeline. Tests inject a
 * fake implementation, so only the members we actually touch are declared.
 */
export interface FfmpegChild {
  pid?: number;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface FfmpegSpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  windowsHide?: boolean;
  stdio: ['ignore', 'pipe', 'pipe'];
}

export type FfmpegSpawn = (
  command: string,
  args: string[],
  options: FfmpegSpawnOptions
) => FfmpegChild;

export interface SpawnFfmpegOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Overrides the binary resolved from ASAKI_FFMPEG_PATH / PATH. */
  ffmpegPath?: string;
  /** Injected for tests. */
  spawnFn?: FfmpegSpawn;
  /** Injected for tests; kills a whole process tree by pid. */
  killTreeFn?: (pid: number) => void;
  /** Grace period before the Windows taskkill fallback runs. */
  killFallbackMs?: number;
  /** Receives stdout chunks as Buffers; stdout is not collected when set. */
  onStdout?: (chunk: Buffer) => void;
  /** Receives complete stderr lines in arrival order. */
  onStderrLine?: (line: string) => void;
  /** Keep the whole stdout in the result. Defaults to !onStdout. */
  captureStdout?: boolean;
  /** How many stderr lines to keep for diagnostics. */
  stderrLineLimit?: number;
}

export interface FfmpegResult {
  code: number | null;
  stdout: Buffer;
  stderrTail: string[];
}

export const DEFAULT_KILL_FALLBACK_MS = 1_500;
export const DEFAULT_STDERR_LINE_LIMIT = 80;

/** Same resolution rule as media.ts, copied here so this module stands alone. */
export function resolveFfmpegBinary(): string {
  return process.env.ASAKI_FFMPEG_PATH?.trim() || 'ffmpeg';
}

export function createAbortError(): Error {
  const error = new Error('ffmpeg 已取消。');
  error.name = 'AbortError';
  return error;
}

/** Keeps the tail of stderr so failures can explain themselves. */
class StderrRing {
  private readonly lines: string[] = [];
  private partial = '';

  constructor(private readonly limit: number) {}

  push(chunk: string, onLine?: (line: string) => void): void {
    const parts = (this.partial + chunk).split(/\r?\n/);
    this.partial = parts.pop() ?? '';
    // A single log line should never be gigantic; keep a bounded tail.
    if (this.partial.length > 8_192) this.partial = this.partial.slice(-8_192);
    for (const line of parts) this.record(line, onLine);
  }

  flush(onLine?: (line: string) => void): void {
    if (!this.partial) return;
    const line = this.partial;
    this.partial = '';
    this.record(line, onLine);
  }

  tail(): string[] {
    return this.lines.slice();
  }

  private record(line: string, onLine?: (line: string) => void): void {
    this.lines.push(line);
    if (this.lines.length > this.limit) this.lines.shift();
    onLine?.(line);
  }
}

const defaultSpawn: FfmpegSpawn = (command, args, options) =>
  nodeSpawn(command, args, options) as unknown as FfmpegChild;

function defaultKillTree(pid: number): void {
  try {
    const killer = nodeSpawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    killer.on('error', () => undefined);
    killer.unref?.();
  } catch {
    // The direct child.kill() already ran; nothing else to do.
  }
}

function tailText(lines: string[], count = 10): string {
  if (lines.length === 0) return '';
  return `\n${lines.slice(-count).join('\n')}`;
}

/**
 * Runs ffmpeg once. Stdout is treated as opaque bytes (rawvideo frames), stderr
 * is kept as a line ring for diagnostics, and an abort kills the process.
 */
export async function spawnFfmpeg(
  args: string[],
  options: SpawnFfmpegOptions = {}
): Promise<FfmpegResult> {
  const {
    signal,
    timeoutMs,
    cwd,
    env,
    ffmpegPath,
    spawnFn = defaultSpawn,
    killTreeFn = defaultKillTree,
    killFallbackMs = DEFAULT_KILL_FALLBACK_MS,
    onStdout,
    onStderrLine,
    captureStdout = !onStdout,
    stderrLineLimit = DEFAULT_STDERR_LINE_LIMIT
  } = options;

  if (signal?.aborted) throw createAbortError();

  const command = ffmpegPath?.trim() || resolveFfmpegBinary();
  let child: FfmpegChild;
  try {
    child = spawnFn(command, args, {
      cwd,
      env: env ?? process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }

  return new Promise<FfmpegResult>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderr = new StderrRing(stderrLineLimit);
    let settled = false;
    let closed = false;
    let fallbackTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;

    const clearTimeoutTimer = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      clearTimeoutTimer();
      // Deliberately keep the taskkill fallback pending: the promise has
      // already rejected, but the process may still need to be killed.
      reject(error);
    };

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      clearTimeoutTimer();
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = undefined;
      }
      resolve({
        code,
        stdout: captureStdout ? Buffer.concat(stdoutChunks) : Buffer.alloc(0),
        stderrTail: stderr.tail()
      });
    };

    const scheduleKillFallback = () => {
      if (process.platform !== 'win32' || child.pid === undefined) return;
      if (fallbackTimer) return;
      fallbackTimer = setTimeout(() => {
        fallbackTimer = undefined;
        if (closed) return;
        try {
          killTreeFn(child.pid as number);
        } catch {
          // Ignore: this is already a best-effort cleanup path.
        }
      }, killFallbackMs);
      fallbackTimer.unref?.();
    };

    const killChild = () => {
      try {
        child.kill();
      } catch {
        // Ignore: the process may already be gone.
      }
      scheduleKillFallback();
    };

    function onAbort(): void {
      killChild();
      fail(createAbortError());
    }

    signal?.addEventListener('abort', onAbort, { once: true });

    if (timeoutMs !== undefined && timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timeoutTimer = undefined;
        killChild();
        fail(
          new Error(`ffmpeg 执行超时（${timeoutMs}ms）。${tailText(stderr.tail())}`)
        );
      }, timeoutMs);
      timeoutTimer.unref?.();
    }

    const stdout = child.stdout;
    const stderrStream = child.stderr;

    stdout?.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      try {
        onStdout?.(buffer);
      } catch (error) {
        killChild();
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (captureStdout) stdoutChunks.push(buffer);
    });
    stdout?.on('error', () => undefined);

    stderrStream?.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
      try {
        stderr.push(text, onStderrLine);
      } catch (error) {
        killChild();
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    stderrStream?.on('error', () => undefined);

    child.on('error', (error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });

    child.on('close', (code) => {
      closed = true;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = undefined;
      }
      if (settled) return;
      try {
        stderr.flush(onStderrLine);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (code === 0) {
        finish(code);
        return;
      }
      fail(
        new Error(
          `ffmpeg 执行失败（退出码 ${String(code)}）。${tailText(stderr.tail())}`
        )
      );
    });
  });
}
