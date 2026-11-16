import { EventEmitter, getEventListeners } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import {
  CliAgentClient,
  terminateProcessTree,
  type CliRunner
} from '../../../src/main/agent/cli-agent-client';
import { ModelTimeoutError } from '../../../src/main/agent/model-client';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  kill: (signal?: string) => boolean;
};

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
}

async function withFakeExecutable(run: (exe: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'asaki-cli-timeout-'));
  try {
    const exe = join(root, 'fake.exe');
    await writeFile(exe, '');
    await run(exe);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.mocked(spawn).mockReset();
});

describe('terminateProcessTree', () => {
  test('also stops grandchildren on Windows', () => {
    const child = { pid: 1234, kill: vi.fn(() => true) };
    terminateProcessTree(child, 'win32');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawn).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', '1234', '/t', '/f'],
      expect.objectContaining({ windowsHide: true })
    );
  });
});

describe('CLI per-request timeout', () => {
  test('defaults to a 15 minute total ceiling and lets the request override it', async () => {
    const timeouts: number[] = [];
    const runner: CliRunner = async (_command, _args, _input, options) => {
      timeouts.push(options.timeoutMs);
      return { stdout: 'ok', stderr: '', code: 0 };
    };
    const client = new CliAgentClient({ kind: 'local-cli', agent: 'codex' }, { runner });

    await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 300_000
    });

    expect(timeouts).toEqual([900_000, 300_000]);
  });

  test('native agents get a longer ceiling for vault work', async () => {
    const timeouts: number[] = [];
    const runner: CliRunner = async (_command, _args, _input, options) => {
      timeouts.push(options.timeoutMs);
      return { stdout: 'ok', stderr: '', code: 0 };
    };
    const client = new CliAgentClient(
      { kind: 'local-cli', agent: 'claude', nativeTools: true },
      { runner }
    );

    await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      cwd: 'C:\\vault'
    });

    expect(timeouts).toEqual([1_800_000]);
  });

  test('a constructor timeout is the fallback between default and request', async () => {
    const timeouts: number[] = [];
    const windows: Array<[number | undefined, number | undefined]> = [];
    const runner: CliRunner = async (_command, _args, _input, options) => {
      timeouts.push(options.timeoutMs);
      windows.push([options.startupTimeoutMs, options.idleTimeoutMs]);
      return { stdout: 'ok', stderr: '', code: 0 };
    };
    const client = new CliAgentClient(
      { kind: 'local-cli', agent: 'codex' },
      {
        runner,
        timeoutMs: 240_000,
        startupTimeoutMs: 30_000,
        idleTimeoutMs: 90_000
      }
    );

    await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 1_000
    });

    expect(timeouts).toEqual([240_000, 1_000]);
    expect(windows).toEqual([
      [30_000, 90_000],
      [30_000, 90_000]
    ]);
  });

  test('kills a silent child and reports a startup timeout', async () => {
    await withFakeExecutable(async (exe) => {
      const child = fakeChild();
      vi.mocked(spawn).mockReturnValueOnce(child as never);
      const client = new CliAgentClient(
        { kind: 'local-cli', agent: 'claude', command: exe },
        { startupTimeoutMs: 20, idleTimeoutMs: 60_000 }
      );

      await expect(
        client.complete({ messages: [{ role: 'user', content: 'hi' }], timeoutMs: 60_000 })
      ).rejects.toBeInstanceOf(ModelTimeoutError);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      const second = fakeChild();
      vi.mocked(spawn).mockReturnValueOnce(second as never);
      await expect(
        client.complete({ messages: [{ role: 'user', content: 'hi' }], timeoutMs: 60_000 })
      ).rejects.toThrow('启动超时');
      expect(second.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  test('caller abort still kills the child and removes its listener', async () => {
    await withFakeExecutable(async (exe) => {
      const controller = new AbortController();
      const child = fakeChild();
      const client = new CliAgentClient({ kind: 'local-cli', agent: 'claude', command: exe });

      // Abort once the runner has attached its listener to the signal.
      vi.mocked(spawn).mockImplementation(() => {
        queueMicrotask(() => controller.abort());
        return child as never;
      });

      await expect(
        client.complete({
          messages: [{ role: 'user', content: 'hi' }],
          signal: controller.signal
        })
      ).rejects.toMatchObject({ name: 'AbortError' });

      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    });
  });
});
