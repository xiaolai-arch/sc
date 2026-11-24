import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultAppState } from '../../src/main/context';
import { restoreBackup } from '../../src/main/backup';
import { JsonStateStore } from '../../src/main/state-store';
import { SettingsService } from '../../src/main/settings/settings-service';

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

// --- item 51: reloadFromDisk（丢弃缓存、从盘重读的入口）-------------------------

const OLD_MACHINE_SETTINGS = {
  displayName: '换机的同学',
  vaultPath: 'D:\\old-machine\\StudyCoachVault',
  provider: { kind: 'anthropic', model: 'claude-sonnet-5-5' },
  notifications: {
    enabled: true,
    morning: '07:30',
    evening: '22:00',
    weekly: '20:00',
    weeklyEnabled: false,
    behindSchedule: '20:30',
    behindScheduleEnabled: true,
    dndStart: '23:00',
    dndEnd: '07:30'
  },
  budget: { proactiveSessionsPerDay: 6, dailyTokens: 300000 },
  launchAtLogin: true,
  strictMastery: true,
  // The old machine's auto-backup folder cannot exist here; adoption drops it
  // and keeps the switch (验收 32's carried rules, exercised on this path).
  backup: { autoEnabled: true, autoDestination: 'E:\\old-machine\\StudyCoachBackups' }
};

/** A backup folder whose state.json is adoptable, inside `dir`. */
async function backupFixture(dir: string, vault: string) {
  const backup = join(dir, 'backup');
  await mkdir(join(backup, 'vault', 'workspaces', 'kaoyan'), { recursive: true });
  await writeFile(join(backup, 'vault', 'workspaces', 'kaoyan', 'workspace.md'), 'restored', 'utf8');
  await writeFile(
    join(backup, 'state.json'),
    JSON.stringify({ onboarded: true, settings: OLD_MACHINE_SETTINGS }),
    'utf8'
  );
  return backup;
}

test('reloadFromDisk makes an external state.json write visible to read()', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-reload-'));
  try {
    const filePath = join(dir, 'state.json');
    const store = new JsonStateStore({
      filePath,
      createDefault: () => createDefaultAppState('/tmp/study-vault')
    });
    // The cache hydrates once: a machine without state.json reads the defaults.
    expect((await store.read()).onboarded).toBe(false);

    // Something outside the class writes the file (the restore adoption).
    await writeFile(
      filePath,
      JSON.stringify({ onboarded: true, settings: { vaultPath: '/tmp/study-vault' } }),
      'utf8'
    );
    // read() trusts the cache, so the file alone changes nothing…
    expect((await store.read()).onboarded).toBe(false);
    // …and reloadFromDisk is the only door back to the disk.
    const reloaded = await store.reloadFromDisk();
    expect(reloaded.onboarded).toBe(true);
    expect((await store.read()).onboarded).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reloadFromDisk queues behind a pending update instead of bypassing it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-reload-queue-'));
  try {
    const filePath = join(dir, 'state.json');
    await writeFile(filePath, JSON.stringify({ onboarded: false, settings: {} }), 'utf8');
    const store = new JsonStateStore({
      filePath,
      createDefault: () => createDefaultAppState('/tmp/study-vault')
    });
    await store.read();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const update = store.update(async (current) => {
      await gate;
      return { ...current, onboarded: true };
    });
    // Requested while the update is still in flight: it must run after the
    // update's write lands, never racing it on a stale cache.
    const reload = store.reloadFromDisk();

    release();
    await update;
    expect((await reload).onboarded).toBe(true);
    expect(JSON.parse(await readFile(filePath, 'utf8')).onboarded).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reloadFromDisk keeps an in-memory store intact (no file to re-read)', async () => {
  const store = new JsonStateStore({
    filePath: null,
    createDefault: () => createDefaultAppState('/tmp/study-vault')
  });
  await store.update((current) => ({ ...current, onboarded: true }));
  expect((await store.reloadFromDisk()).onboarded).toBe(true);
});

test('first-run restore then complete onboarding keeps every adopted field (验收 28/29/32)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-first-run-restore-'));
  try {
    const userData = join(dir, 'user-data');
    const vault = join(dir, 'vault');
    await mkdir(vault, { recursive: true });
    const backup = await backupFixture(dir, vault);

    // A fresh machine: the running process cached the defaults, no state.json.
    const statePath = join(userData, 'state.json');
    const store = new JsonStateStore({
      filePath: statePath,
      createDefault: () => createDefaultAppState(vault)
    });
    expect((await store.read()).onboarded).toBe(false);

    // The first-run entry restores before onboarding writes state.json; the
    // adoption rewrites the old machine's vault path to this machine's vault.
    const result = await restoreBackup({
      backupPath: backup,
      vaultPath: vault,
      userDataPath: userData
    });
    expect(result.restored.state).toBe(true);
    // The cache still hides the adoption — exactly the gap reloadFromDisk closes.
    expect((await store.read()).settings.displayName).toBe('xiaolai');

    // The handler's order: reload the cache before the renderer is told.
    await store.reloadFromDisk();
    const adopted = await store.read();
    expect(adopted.onboarded).toBe(true);
    expect(adopted.settings.vaultPath).toBe(vault);

    // completeWorkspaceOnboarding: `update` must build on the adopted
    // settings, not the stale in-memory defaults.
    await store.update((current) => ({ ...current, onboarded: true }));

    // 逐字段：落盘 state.json = 已采纳设置（vaultPath 已改写、autoDestination
    // 已丢弃、autoEnabled 保留、weeklyEnabled=false 保留）+ onboarded:true。
    const onDisk = JSON.parse(await readFile(statePath, 'utf8'));
    expect(onDisk).toEqual({
      onboarded: true,
      settings: { ...OLD_MACHINE_SETTINGS, vaultPath: vault, backup: { autoEnabled: true } }
    });

    // 同会话即生效：no restart, getSettings returns the adopted values.
    const settingsService = new SettingsService(store);
    const sameSession = await settingsService.get();
    expect(sameSession.displayName).toBe('换机的同学');
    expect(sameSession.provider).toEqual({ kind: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(sameSession.notifications.weeklyEnabled).toBe(false);
    expect(sameSession.backup).toEqual({ autoEnabled: true });

    // 重启后：a fresh store reads the file — onboarded true, settings intact,
    // so needsOnboarding=false and the first-run dialog stays gone.
    const relaunched = await new JsonStateStore({
      filePath: statePath,
      createDefault: () => createDefaultAppState(vault)
    }).read();
    expect(relaunched.onboarded).toBe(true);
    expect(relaunched.settings.displayName).toBe('换机的同学');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
