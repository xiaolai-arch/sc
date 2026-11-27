import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_AUTO_INTERVAL_DAYS,
  createAutoBackupRunner,
  describeAutoBackupError,
  inspectAutoBackupDirectory,
  isAutoBackupDue
} from '../../src/main/backup-auto';
import { createDefaultAppState } from '../../src/main/context';
import { pruneAutoBackups } from '../../src/main/backup-rotation';
import { SettingsService } from '../../src/main/settings/settings-service';
import { JsonStateStore } from '../../src/main/state-store';
import { formatLocalDateTimeSeconds } from '../../src/shared/date';

function memorySettings(vaultPath: string): SettingsService {
  return new SettingsService(
    new JsonStateStore({ filePath: null, createDefault: () => createDefaultAppState(vaultPath) })
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function tempDir(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `study-coach-auto-backup-${label}-`));
}

/** A vault with one file, so createBackup has something small to copy. */
async function seededVault(): Promise<string> {
  const vault = await tempDir('vault');
  await mkdir(vault, { recursive: true });
  await writeFile(join(vault, 'note.md'), '# 笔记', 'utf8');
  return vault;
}

const NOW = () => new Date(2026, 10, 23, 20, 0, 0);

/**
 * The runner test rig: the vault, the app-data directory and the backup
 * destination's parent must be three different directories — createBackup
 * rightly refuses a destination inside either source.
 */
async function rig() {
  const vault = await seededVault();
  const userData = await tempDir('userdata');
  const root = await tempDir('root');
  return {
    vault,
    userData,
    root,
    destination: join(root, 'backups'),
    async dispose() {
      await rm(vault, { recursive: true, force: true });
      await rm(userData, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  };
}

function runnerFor(settings: SettingsService, userData: string, now: () => Date = NOW) {
  return createAutoBackupRunner({ settings, userDataPath: userData, now });
}

// --- the due formula (验收 7, boundaries via the injected date) ----------------

test('isAutoBackupDue: never backed up or an unreadable record is due', () => {
  expect(isAutoBackupDue(undefined, DEFAULT_AUTO_INTERVAL_DAYS, '2026-11-23')).toBe(true);
  expect(isAutoBackupDue({}, 7, '2026-11-23')).toBe(true);
  expect(isAutoBackupDue({ lastBackupAt: '上周' }, 7, '2026-11-23')).toBe(true);
  expect(isAutoBackupDue({ lastBackupAt: '2026-02-30T10:00:00' }, 7, '2026-11-23')).toBe(true);
});

test('isAutoBackupDue: the default 7-day interval (验收 9 boundary)', () => {
  const sevenDaysAgo = { lastBackupAt: '2026-11-16T09:00:00' };
  const sixDaysAgo = { lastBackupAt: '2026-11-17T23:59:59' };
  expect(isAutoBackupDue(sevenDaysAgo, undefined, '2026-11-23')).toBe(true);
  expect(isAutoBackupDue(sixDaysAgo, 7, '2026-11-23')).toBe(false);
});

test('isAutoBackupDue: interval 1 and yesterday is due (验收 7 边界)', () => {
  expect(isAutoBackupDue({ lastBackupAt: '2026-11-22T23:59:59' }, 1, '2026-11-23')).toBe(true);
});

test('isAutoBackupDue: interval 30, 29 days waits and 30 days runs (验收 7 边界)', () => {
  const stamp = (month: number, day: number) => ({
    lastBackupAt: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00`
  });
  expect(isAutoBackupDue(stamp(10, 25), 30, '2026-11-23')).toBe(false); // 29 天
  expect(isAutoBackupDue(stamp(10, 24), 30, '2026-11-23')).toBe(true); // 30 天
});

test('isAutoBackupDue: a future record (clock skew) waits and a bad date never runs', () => {
  expect(isAutoBackupDue({ lastBackupAt: '2026-11-24T00:00:00' }, 7, '2026-11-23')).toBe(false);
  expect(isAutoBackupDue({ lastBackupAt: '2026-11-01T00:00:00' }, 7, 'not-a-date')).toBe(false);
});

// --- the errno → 人话 mapping (C) ---------------------------------------------

test('describeAutoBackupError maps common errnos to short Chinese causes', () => {
  expect(describeAutoBackupError({ code: 'EACCES' })).toBe('没有写入备份文件夹的权限');
  expect(describeAutoBackupError({ code: 'EPERM' })).toBe('没有写入备份文件夹的权限');
  expect(describeAutoBackupError({ code: 'ENOSPC' })).toBe('磁盘空间不足');
  expect(describeAutoBackupError({ code: 'EBUSY' })).toBe('备份文件夹正被其他程序占用');
  expect(describeAutoBackupError({ code: 'ENOENT' })).toBe('备份文件夹不存在');
});

test('describeAutoBackupError keeps our own Chinese sentences and hides everything else', () => {
  const ours = new Error('备份目录不能位于 vault 或应用数据目录内。');
  expect(describeAutoBackupError(ours)).toBe('备份目录不能位于 vault 或应用数据目录内。');
  // English plumbing never leaks: no stack, no raw OS message.
  expect(describeAutoBackupError(new Error("EPERM: operation not permitted, open 'D:\\x'"))).toBe(
    '无法写入备份文件夹'
  );
  expect(describeAutoBackupError('boom')).toBe('无法写入备份文件夹');
  expect(describeAutoBackupError(undefined)).toBe('无法写入备份文件夹');
  // A multi-line error cannot smuggle a line break into the one-line copy.
  expect(describeAutoBackupError(new Error('磁盘满了\nEIO: something else'))).toBe(
    '磁盘满了 EIO: something else'
  );
});

// --- the runner ----------------------------------------------------------------

test('the runner runs a due backup into the destination and records success (验收 7)', async () => {
  const paths = await rig();
  try {
    const settings = memorySettings(paths.vault);
    await settings.update({
      backup: { autoEnabled: true, autoDestination: paths.destination }
    });
    const runner = runnerFor(settings, paths.userData);

    expect(await runner.runIfDue('2026-11-23')).toBe(true);

    const folders = await readdir(paths.destination);
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatch(/^study-coach-backup-/);
    const backup = (await settings.get()).backup;
    expect(backup).toMatchObject({
      autoEnabled: true,
      autoDestination: paths.destination,
      lastBackupAt: '2026-11-23T20:00:00',
      lastBackupOutcome: 'ok'
    });
    expect(backup?.lastBackupPath).toBe(join(paths.destination, folders[0]!));
  } finally {
    await paths.dispose();
  }
});

test('the runner does not start a second backup inside the interval (验收 9)', async () => {
  const paths = await rig();
  try {
    const settings = memorySettings(paths.vault);
    await settings.update({
      backup: {
        autoEnabled: true,
        autoDestination: paths.destination,
        lastBackupAt: formatLocalDateTimeSeconds(new Date(2026, 10, 20, 9, 0, 0))
      }
    });
    const runner = runnerFor(settings, paths.userData);

    expect(await runner.runIfDue('2026-11-23')).toBe(false);
    await expect(readdir(paths.destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await settings.get()).backup?.lastBackupOutcome).toBeUndefined();
  } finally {
    await paths.dispose();
  }
});

test('the runner never deletes an earlier auto backup (验收 14)', async () => {
  const paths = await rig();
  try {
    const settings = memorySettings(paths.vault);
    await settings.update({
      backup: { autoEnabled: true, autoDestination: paths.destination }
    });
    const runner = runnerFor(settings, paths.userData);

    expect(await runner.runIfDue('2026-11-23')).toBe(true);
    // A week later the next weekly review runs again; the first folder stays.
    expect(await runner.runIfDue('2026-12-01')).toBe(true);
    // Six days after the second success the next review finds it not due, so
    // the count stays at two folders and nothing is deleted.
    expect(await runner.runIfDue('2026-11-29')).toBe(false);

    const folders = (await readdir(paths.destination)).sort();
    expect(folders).toHaveLength(2);
    expect(folders.every((name) => name.startsWith('study-coach-backup-'))).toBe(true);
    const first = await readdir(join(paths.destination, folders[0]!));
    expect(first.length).toBeGreaterThan(0);
  } finally {
    await paths.dispose();
  }
});

test('no destination: no export attempt, no error, no folder (验收 11)', async () => {
  const paths = await rig();
  try {
    const settings = memorySettings(paths.vault);
    await settings.update({ backup: { autoEnabled: true } });
    const runner = runnerFor(settings, paths.userData);

    expect(await runner.runIfDue('2026-11-23')).toBe(false);
    // Nothing was attempted: no destination folder anywhere and no failure
    // facts written into the settings block.
    expect((await settings.get()).backup).toEqual({ autoEnabled: true });
    await expect(readdir(paths.destination)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await paths.dispose();
  }
});

test('a relative destination reads as no destination (验收 11)', async () => {
  const paths = await rig();
  try {
    // The tolerant settings read would drop a relative path already; write it
    // through the raw document and prove the runner refuses whatever remains.
    const state = new JsonStateStore({
      filePath: null,
      createDefault: () => ({
        ...createDefaultAppState(paths.vault),
        settings: {
          ...createDefaultAppState(paths.vault).settings,
          backup: { autoEnabled: true, autoDestination: 'relative/path' } as never
        }
      })
    });
    const settings = new SettingsService(state);
    const runner = runnerFor(settings, paths.userData);

    expect(await runner.runIfDue('2026-11-23')).toBe(false);
    await expect(readdir(paths.destination)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await paths.dispose();
  }
});

test('weeklyEnabled=false: the auto backup never runs (验收 12)', async () => {
  const paths = await rig();
  try {
    const settings = memorySettings(paths.vault);
    await settings.update({
      backup: { autoEnabled: true, autoDestination: paths.destination },
      notifications: { weeklyEnabled: false }
    });
    const runner = runnerFor(settings, paths.userData);

    expect(await runner.runIfDue('2026-11-23')).toBe(false);
    await expect(readdir(paths.destination)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await paths.dispose();
  }
});

test('autoEnabled off: nothing runs even when due with a destination', async () => {
  const paths = await rig();
  try {
    const settings = memorySettings(paths.vault);
    // 默认关: an absent switch is off and never serialized; only true runs.
    await settings.update({ backup: { autoDestination: paths.destination } });
    const runner = runnerFor(settings, paths.userData);

    expect(await runner.runIfDue('2026-11-23')).toBe(false);
    await expect(readdir(paths.destination)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await paths.dispose();
  }
});

test('a failure records the outcome and a human reason, never a throw (验收 10 + C)', async () => {
  const paths = await rig();
  try {
    const settings = memorySettings(paths.vault);
    // The one failure createBackup can produce without OS tricks: a target
    // inside the vault, rejected by its own guard with a Chinese sentence.
    const destination = join(paths.vault, 'inside-vault');
    await settings.update({ backup: { autoEnabled: true, autoDestination: destination } });
    const runner = runnerFor(settings, paths.userData);

    // Resolves false; the renderer is never involved.
    expect(await runner.runIfDue('2026-11-23')).toBe(false);
    const backup = (await settings.get()).backup;
    expect(backup?.lastBackupOutcome).toBe('failed');
    expect(backup?.lastBackupError).toBe('备份目录不能位于 vault 或应用数据目录内。');
    expect(backup?.lastBackupAt).toBeUndefined();
    // The human phrase: no stacks, no scare words.
    expect(backup?.lastBackupError).not.toMatch(/Error|at \w+|数据可能丢失|损坏/);
    // No folder was created inside the vault by the failed attempt.
    await expect(readdir(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await paths.dispose();
  }
});

// --- P4 rotation: the runner trims the destination after each success ----------

const rotationStamp = (day: number): string =>
  `2026-10-${String(day).padStart(2, '0')}-0900`;

async function seedOldBackups(destination: string, days: number[]): Promise<void> {
  for (const day of days) {
    const dir = join(destination, `study-coach-backup-${rotationStamp(day)}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'README.txt'), rotationStamp(day), 'utf8');
  }
}

test('after a successful auto backup exactly 12 copies remain (验收 22)', async () => {
  const paths = await rig();
  try {
    const settings = memorySettings(paths.vault);
    await settings.update({
      backup: { autoEnabled: true, autoDestination: paths.destination }
    });
    // 14 folders older than the copy this run will create.
    await seedOldBackups(paths.destination, Array.from({ length: 14 }, (_, i) => i + 1));
    const runner = runnerFor(settings, paths.userData);

    expect(await runner.runIfDue('2026-11-23')).toBe(true);

    const folders = (await readdir(paths.destination)).sort();
    // Exactly 12, counting the fresh copy; the oldest seeds are gone.
    expect(folders).toHaveLength(12);
    expect(folders).not.toContain(`study-coach-backup-${rotationStamp(1)}`);
    expect(folders).not.toContain(`study-coach-backup-${rotationStamp(2)}`);
    expect(folders).not.toContain(`study-coach-backup-${rotationStamp(3)}`);
    // The fresh copy is inside the kept 12, alongside the 11 newest seeds.
    expect(folders).toContain('study-coach-backup-2026-11-23-2000');
    expect(folders.filter((name) => name.startsWith('study-coach-backup-2026-10-'))).toHaveLength(
      11
    );
    // The success facts were written before any cleanup ran.
    expect((await settings.get()).backup?.lastBackupOutcome).toBe('ok');
  } finally {
    await paths.dispose();
  }
});

test('a stuck folder: the backup still succeeds and the next success retries the deletion (验收 24)', async () => {
  const paths = await rig();
  try {
    const settings = memorySettings(paths.vault);
    await settings.update({
      backup: { autoEnabled: true, autoDestination: paths.destination }
    });
    await seedOldBackups(paths.destination, Array.from({ length: 14 }, (_, i) => i + 1));
    const busy = join(paths.destination, `study-coach-backup-${rotationStamp(1)}`);
    let busyReleased = false;
    // The real rotation logic runs underneath; only the removal of the busy
    // folder fails, the way a file opened by another program fails on Windows.
    const runner = createAutoBackupRunner({
      settings,
      userDataPath: paths.userData,
      now: NOW,
      prune: (input) =>
        pruneAutoBackups({
          ...input,
          removeDirectory: async (path) => {
            if (path === busy && !busyReleased) {
              throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
            }
            await rm(path, { recursive: true, force: true });
          }
        })
    });

    // First success: the busy folder could not be removed, yet the run
    // resolves true and stays `ok` — cleanup never becomes a backup failure.
    expect(await runner.runIfDue('2026-11-23')).toBe(true);
    let backup = (await settings.get()).backup;
    expect(backup?.lastBackupOutcome).toBe('ok');
    expect(backup?.lastBackupError).toBeUndefined();
    expect(await exists(busy)).toBe(true);
    // The two next-oldest folders were still removed this round.
    expect(await readdir(paths.destination)).toHaveLength(13);

    // The program closes and the folder is no longer occupied; next week's
    // success retries the deletion and finishes the job.
    busyReleased = true;
    expect(await runner.runIfDue('2026-11-30')).toBe(true);
    backup = (await settings.get()).backup;
    expect(backup?.lastBackupOutcome).toBe('ok');
    expect(await exists(busy)).toBe(false);
    expect(await readdir(paths.destination)).toHaveLength(12);
  } finally {
    await paths.dispose();
  }
});


// --- item 66 P2-2: the settings card's directory stat -------------------------

test('inspectAutoBackupDirectory reads existence and type without throwing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-backup-stat-'));
  try {
    await writeFile(join(dir, 'a-file'), 'x');

    expect(await inspectAutoBackupDirectory(dir)).toEqual({
      exists: true,
      isDirectory: true
    });
    // The destination was replaced by a file — the state the warning names.
    expect(await inspectAutoBackupDirectory(join(dir, 'a-file'))).toEqual({
      exists: true,
      isDirectory: false
    });
    expect(await inspectAutoBackupDirectory(join(dir, 'missing'))).toEqual({
      exists: false,
      isDirectory: false
    });
    // A relative or empty path is invalid by definition, never a crash.
    expect(await inspectAutoBackupDirectory('backups')).toEqual({
      exists: false,
      isDirectory: false
    });
    expect(await inspectAutoBackupDirectory('')).toEqual({
      exists: false,
      isDirectory: false
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
