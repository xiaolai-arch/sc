import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultAppState } from '../../src/main/context';
import { JsonStateStore } from '../../src/main/state-store';

/**
 * Writes a hand-edited state.json and reads it back through the store, so the
 * startup hydration path (not the in-memory default) is what is under test.
 */
async function readSettings(settings: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-state-store-'));
  try {
    const filePath = join(dir, 'state.json');
    await writeFile(filePath, JSON.stringify({ onboarded: true, settings }), 'utf8');
    const store = new JsonStateStore({
      filePath,
      createDefault: () => createDefaultAppState('/tmp/study-vault')
    });
    return (await store.read()).settings;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('a partial provider block of the default kind is filled from the defaults (E)', async () => {
  const settings = await readSettings({
    vaultPath: '/tmp/vault',
    provider: { kind: 'local-cli', agent: 'codex' }
  });
  // `command` is filled like notifications/budget blocks are, instead of the
  // whole block replacing the defaults.
  expect(settings.provider).toEqual({ kind: 'local-cli', agent: 'codex', command: 'codex' });
});

test('a provider block of another kind passes through whole, without kind mixing', async () => {
  const settings = await readSettings({
    vaultPath: '/tmp/vault',
    provider: { kind: 'anthropic', model: 'claude-sonnet-5-5' }
  });
  // No junk local-cli fields leak in; the block stays coherent.
  expect(settings.provider).toEqual({ kind: 'anthropic', model: 'claude-sonnet-5-5' });
});

test('an absent or non-object provider falls back to the defaults', async () => {
  const absent = await readSettings({ vaultPath: '/tmp/vault' });
  expect(absent.provider).toEqual({ kind: 'local-cli', agent: 'codex', command: 'codex' });

  const junk = await readSettings({
    vaultPath: '/tmp/vault',
    provider: 'codex-cli'
  });
  expect(junk.provider).toEqual({ kind: 'local-cli', agent: 'codex', command: 'codex' });
});
