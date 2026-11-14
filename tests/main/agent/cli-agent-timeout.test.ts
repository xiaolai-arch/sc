import { EventEmitter, getEventListeners } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { CliAgentClient, type CliRunner } from '../../../src/main/agent/cli-agent-client';
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

describe('CLI per-request timeout', () => {
  test('defaults to 180s and lets the request override it', async () => {
    const timeouts: number[] = [];
    const runner: CliRunner = async (_command, _args, _input, options) => {
      timeouts.push(options.timeoutMs);
      return { stdout: 'ok', stderr: '', code: 0 };
    };
    const client = new CliAgentClient({ kind: 'local-cli', agent: 'codex' }, { runner });

    await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 900_000
    });

    expect(timeouts).toEqual([180_000, 900_000]);
  });

  test('a constructor timeout is the fallback between default and request', async () => {
    const timeouts: number[] = [];
    const runner: CliRunner = async (_command, _args, _input, options) => {
      timeouts.push(options.timeoutMs);
      return { stdout: 'ok', stderr: '', code: 0 };
    };
    const client = new CliAgentClient(
      { kind: 'local-cli', agent: 'codex' },
      { runner, timeoutMs: 240_000 }
    );

    await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 1_000
    });

    expect(timeouts).toEqual([240_000, 1_000]);
  });

  test('kills the child and rejects with a timeout error', async () => {
    await withFakeExecutable(async (exe) => {
      const child = fakeChild();
      vi.mocked(spawn).mockReturnValueOnce(child as never);
      const client = new CliAgentClient({ kind: 'local-cli', agent: 'claude', command: exe });

      await expect(
        client.complete({ messages: [{ role: 'user', content: 'hi' }], timeoutMs: 20 })
      ).rejects.toBeInstanceOf(ModelTimeoutError);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      const second = fakeChild();
      vi.mocked(spawn).mockReturnValueOnce(second as never);
      await expect(
        client.complete({ messages: [{ role: 'user', content: 'hi' }], timeoutMs: 20 })
      ).rejects.toThrow('本地 CLI agent 超时（20ms）');
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
