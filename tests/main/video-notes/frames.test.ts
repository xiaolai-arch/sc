import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  createAbortError,
  resolveFfmpegBinary,
  spawnFfmpeg,
  type FfmpegChild,
  type FfmpegSpawn
} from '../../../src/main/video-notes/frames';

interface FakeChild extends EventEmitter {
  pid: number;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
}

function createFakeChild(pid = 4_242): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
}

function fakeSpawn(child: FakeChild, calls: Array<{ command: string; args: string[] }>): FfmpegSpawn {
  return (command, args) => {
    calls.push({ command, args });
    return child as unknown as FfmpegChild;
  };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the promise to reject');
}

test('resolves the ffmpeg binary from ASAKI_FFMPEG_PATH first', () => {
  const previous = process.env.ASAKI_FFMPEG_PATH;
  try {
    process.env.ASAKI_FFMPEG_PATH = ' C:/tools/ffmpeg.exe ';
    expect(resolveFfmpegBinary()).toBe('C:/tools/ffmpeg.exe');
    delete process.env.ASAKI_FFMPEG_PATH;
    expect(resolveFfmpegBinary()).toBe('ffmpeg');
  } finally {
    if (previous === undefined) delete process.env.ASAKI_FFMPEG_PATH;
    else process.env.ASAKI_FFMPEG_PATH = previous;
  }
});

test('collects stdout as Buffers and keeps the stderr tail on success', async () => {
  const child = createFakeChild();
  const calls: Array<{ command: string; args: string[] }> = [];
  const promise = spawnFfmpeg(['-version'], { spawnFn: fakeSpawn(child, calls) });

  child.stdout.write(Buffer.from([0, 1, 2, 3]));
  child.stderr.write('first line\nsecond line\n');
  child.emit('close', 0);

  const result = await promise;
  expect(result.code).toBe(0);
  expect(Array.from(result.stdout)).toEqual([0, 1, 2, 3]);
  expect(result.stderrTail).toEqual(['first line', 'second line']);
  expect(calls).toHaveLength(1);
  expect(calls[0].command).toBe(resolveFfmpegBinary());
  expect(calls[0].args).toEqual(['-version']);
});

test('streams stdout chunks without buffering them when a callback is set', async () => {
  const child = createFakeChild();
  const chunks: Buffer[] = [];
  const promise = spawnFfmpeg(['-i', 'x'], {
    spawnFn: fakeSpawn(child, []),
    onStdout: (chunk) => chunks.push(chunk),
    onStderrLine: () => undefined
  });

  child.stdout.write(Buffer.from([9, 8]));
  child.stderr.write('n:   0 pts_time:0 s:320x180\n');
  child.emit('close', 0);

  const result = await promise;
  expect(chunks).toHaveLength(1);
  expect(Array.from(chunks[0])).toEqual([9, 8]);
  expect(result.stdout.length).toBe(0);
});

test('rejects with the exit code and the last stderr lines', async () => {
  const child = createFakeChild();
  const promise = spawnFfmpeg(['-i', 'broken.mp4'], { spawnFn: fakeSpawn(child, []) });

  child.stderr.write('Invalid data found when processing input\n');
  child.stderr.write('Conversion failed\n');
  child.emit('close', 1);

  const error = await rejection(promise);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain('退出码 1');
  expect(error.message).toContain('Invalid data found when processing input');
});

test('abort kills the child and rejects with an AbortError', async () => {
  const child = createFakeChild();
  const killTreeFn = vi.fn();
  const controller = new AbortController();
  const promise = spawnFfmpeg(['-i', 'x'], {
    signal: controller.signal,
    spawnFn: fakeSpawn(child, []),
    killTreeFn,
    killFallbackMs: 0
  });

  controller.abort();

  const error = await rejection(promise);
  expect(error.name).toBe('AbortError');
  expect(child.kill).toHaveBeenCalledTimes(1);

  if (process.platform === 'win32') {
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(killTreeFn).toHaveBeenCalledWith(4_242);
  }
});

test('an already-aborted signal rejects before spawning', async () => {
  const child = createFakeChild();
  const spawnFn = vi.fn(fakeSpawn(child, []));
  const controller = new AbortController();
  controller.abort();

  const error = await rejection(
    spawnFfmpeg(['-i', 'x'], {
      signal: controller.signal,
      spawnFn
    })
  );

  expect(error.name).toBe('AbortError');
  expect(spawnFn).not.toHaveBeenCalled();
});

test('createAbortError carries the AbortError name', () => {
  const error = createAbortError();
  expect(error.name).toBe('AbortError');
  expect(error).toBeInstanceOf(Error);
});
