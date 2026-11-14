import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkpointPath,
  fingerprintOf,
  readCheckpoint,
  runStep,
  stableStringify,
  writeCheckpoint
} from '../../../src/main/video-notes/checkpoint';

const NOW = () => new Date('2026-11-15T03:00:00.000Z');

describe('video-note checkpoints', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'asaki-checkpoint-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('writes and reads a complete record atomically', async () => {
    const fingerprint = fingerprintOf({ upstream: 'x', promptVersion: 1 });

    await writeCheckpoint(root, 'probe', {
      version: 1,
      step: 'probe',
      fingerprint,
      output: { durationSeconds: 42 },
      usage: { inputTokens: 0, outputTokens: 0 },
      finishedAt: NOW().toISOString()
    });

    await expect(readCheckpoint<{ durationSeconds: number }>(root, 'probe')).resolves.toEqual({
      version: 1,
      step: 'probe',
      fingerprint,
      output: { durationSeconds: 42 },
      usage: { inputTokens: 0, outputTokens: 0 },
      finishedAt: NOW().toISOString()
    });

    const entries = await readdir(join(root, 'work'));
    expect(entries).toEqual(['probe.json']);
    const raw = JSON.parse(await readFile(checkpointPath(root, 'probe'), 'utf8'));
    expect(raw).toMatchObject({ version: 1, step: 'probe', fingerprint });
  });

  test('skips a step when the fingerprint is unchanged and reruns when it changes', async () => {
    const run = vi.fn(async () => ({ output: { value: 1 }, usage: { inputTokens: 3, outputTokens: 2 } }));

    const first = await runStep({
      lessonDir: root,
      step: 'render',
      fingerprint: fingerprintOf({ transcript: 'a' }),
      run,
      now: NOW
    });
    expect(first.skipped).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);

    const second = await runStep({
      lessonDir: root,
      step: 'render',
      fingerprint: fingerprintOf({ transcript: 'a' }),
      run,
      now: NOW
    });
    expect(second.skipped).toBe(true);
    expect(second.output).toEqual({ value: 1 });
    expect(second.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
    expect(run).toHaveBeenCalledTimes(1);

    const third = await runStep({
      lessonDir: root,
      step: 'render',
      fingerprint: fingerprintOf({ transcript: 'b' }),
      run,
      now: NOW
    });
    expect(third.skipped).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('force reruns a step even when the fingerprint matches', async () => {
    const run = vi.fn(async () => ({ output: 1 }));
    const fingerprint = fingerprintOf('same');
    await runStep({ lessonDir: root, step: 'probe', fingerprint, run, now: NOW });
    const forced = await runStep({
      lessonDir: root,
      step: 'probe',
      fingerprint,
      run,
      now: NOW,
      force: true
    });
    expect(forced.skipped).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('treats a half-written record as not run', async () => {
    // A truncated JSON document must never count as a finished step.
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, 'work'), { recursive: true });
    await writeFile(join(root, 'work', 'probe.json'), '{"version":1,"step":"probe"', 'utf8');
    await expect(readCheckpoint(root, 'probe')).resolves.toBeNull();

    const run = vi.fn(async () => ({ output: { durationSeconds: 9 } }));
    const result = await runStep({
      lessonDir: root,
      step: 'probe',
      fingerprint: fingerprintOf('x'),
      run,
      now: NOW
    });
    expect(result.skipped).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('rejects a record for a different step or version', async () => {
    await writeCheckpoint(root, 'probe', {
      version: 1,
      step: 'probe',
      fingerprint: 'f',
      output: {},
      usage: { inputTokens: 0, outputTokens: 0 },
      finishedAt: NOW().toISOString()
    });
    await expect(readCheckpoint(root, 'transcribe')).resolves.toBeNull();

    await writeFile(
      join(root, 'work', 'probe.json'),
      JSON.stringify({
        version: 99,
        step: 'probe',
        fingerprint: 'f',
        output: {},
        usage: { inputTokens: 0, outputTokens: 0 },
        finishedAt: NOW().toISOString()
      }),
      'utf8'
    );
    await expect(readCheckpoint(root, 'probe')).resolves.toBeNull();
  });

  test('stable stringify ignores object key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 })
    );
    expect(fingerprintOf({ a: 1, b: 2 })).toBe(fingerprintOf({ b: 2, a: 1 }));
    expect(fingerprintOf({ a: 1 })).not.toBe(fingerprintOf({ a: 2 }));
  });
});
