import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageStore } from '../../src/main/usage/usage-store';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'study-coach-usage-'));
}

test('merges calls for the same date, provider and model', async () => {
  const dir = await tempDir();
  try {
    const store = new UsageStore(join(dir, 'usage.json'), {
      now: () => new Date(2026, 10, 1, 10, 0, 0)
    });

    await store.record({ provider: 'anthropic', model: 'claude', inputTokens: 10, outputTokens: 5 });
    await store.record({ provider: 'anthropic', model: 'claude', inputTokens: 2, outputTokens: 3 });
    await store.record({
      provider: 'openai-compatible',
      model: 'other',
      inputTokens: 1,
      outputTokens: 1
    });

    const entries = await store.list();
    expect(entries).toHaveLength(2);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: '2026-11-01',
          provider: 'anthropic',
          model: 'claude',
          inputTokens: 12,
          outputTokens: 8,
          calls: 2
        }),
        expect.objectContaining({
          provider: 'openai-compatible',
          inputTokens: 1,
          outputTokens: 1,
          calls: 1
        })
      ])
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('prunes entries older than maxDays', async () => {
  const dir = await tempDir();
  try {
    let now = new Date(2026, 10, 1, 10, 0, 0);
    const store = new UsageStore(join(dir, 'usage.json'), {
      now: () => now,
      maxDays: 3
    });

    await store.record({ provider: 'anthropic', model: 'a', inputTokens: 1, outputTokens: 1 });
    now = new Date(2026, 10, 2, 10, 0, 0);
    await store.record({ provider: 'anthropic', model: 'b', inputTokens: 1, outputTokens: 1 });
    now = new Date(2026, 10, 5, 10, 0, 0);
    await store.record({ provider: 'anthropic', model: 'c', inputTokens: 1, outputTokens: 1 });

    expect((await store.list()).map((entry) => entry.date)).toEqual(['2026-11-05']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('clears the file and tolerates corrupt content', async () => {
  const dir = await tempDir();
  try {
    const filePath = join(dir, 'usage.json');
    const store = new UsageStore(filePath, { now: () => new Date(2026, 10, 1, 10, 0, 0) });

    await writeFile(filePath, '{not json', 'utf8');
    expect(await store.list()).toEqual([]);

    await store.record({ provider: 'anthropic', model: 'a', inputTokens: 3, outputTokens: 2 });
    expect(await store.list()).toHaveLength(1);

    await store.clear();
    expect(await store.list()).toEqual([]);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Windows reports 0o666 for writable files; POSIX permission bits are not
// meaningful there, so there is nothing to assert.
test.skipIf(process.platform === 'win32')('writes owner-only permissions', async () => {
  const dir = await tempDir();
  try {
    const filePath = join(dir, 'usage.json');
    const store = new UsageStore(filePath, { now: () => new Date(2026, 10, 1, 10, 0, 0) });

    await store.record({ provider: 'anthropic', model: 'a', inputTokens: 1, outputTokens: 1 });

    const stats = await stat(filePath);
    expect(stats.mode & 0o777).toBe(0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
