import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearBackupError,
  recordBackupFailure,
  recordBackupSuccess
} from '../../src/main/backup-state';
import { createDefaultAppState } from '../../src/main/context';
import { SettingsService } from '../../src/main/settings/settings-service';
import { JsonStateStore } from '../../src/main/state-store';
import type { BackupResult } from '../../src/shared/ipc';

function memoryService() {
  const state = new JsonStateStore({
    filePath: null,
    createDefault: () => createDefaultAppState('/tmp/study-vault')
  });
  return new SettingsService(state);
}

const NOW = () => new Date(2026, 10, 2, 14, 30, 45);

const RESULT: BackupResult = {
  path: 'D:/backups/study-coach-backup-2026-11-02-1430',
  copied: { vault: true, conversations: true, state: true, usage: true }
};

test('a success records the local time, path and outcome together', async () => {
  const service = memoryService();
  await recordBackupSuccess(service, RESULT, NOW);

  expect((await service.get()).backup).toEqual({
    lastBackupAt: '2026-11-02T14:30:45',
    lastBackupPath: RESULT.path,
    lastBackupOutcome: 'ok'
  });
});

test('a failure records only the outcome and keeps the last success', async () => {
  const service = memoryService();
  await recordBackupSuccess(service, RESULT, NOW);
  await recordBackupFailure(service);

  expect((await service.get()).backup).toEqual({
    lastBackupAt: '2026-11-02T14:30:45',
    lastBackupPath: RESULT.path,
    lastBackupOutcome: 'failed'
  });
});

test('a failure without a prior success stays minimal, never a fake date', async () => {
  const service = memoryService();
  await recordBackupFailure(service);

  expect((await service.get()).backup).toEqual({ lastBackupOutcome: 'failed' });
});

test('recording never clobbers the age line toggle and vice versa', async () => {
  const service = memoryService();
  await service.update({ backup: { ageLineEnabled: true } });
  await recordBackupSuccess(service, RESULT, NOW);
  expect((await service.get()).backup).toEqual({
    ageLineEnabled: true,
    lastBackupAt: '2026-11-02T14:30:45',
    lastBackupPath: RESULT.path,
    lastBackupOutcome: 'ok'
  });

  await recordBackupFailure(service);
  await service.update({ backup: { ageLineEnabled: false } });
  // The toggle leaves, the recorded facts stay.
  expect((await service.get()).backup).toEqual({
    lastBackupAt: '2026-11-02T14:30:45',
    lastBackupPath: RESULT.path,
    lastBackupOutcome: 'failed'
  });
});

test('a bad stored date reads as no record and a fresh success replaces it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-backup-state-'));
  try {
    const store = new JsonStateStore({
      filePath: join(dir, 'state.json'),
      createDefault: () => createDefaultAppState('/tmp/study-vault')
    });
    const service = new SettingsService(store);
    // Seed a hand-edited junk date; the tolerant read treats it as absent.
    await store.update((current) => ({
      ...current,
      settings: { ...current.settings, backup: { lastBackupAt: '上周' } as never }
    }));
    expect((await service.get()).backup).toBeUndefined();

    await recordBackupSuccess(service, RESULT, NOW);
    expect((await service.get()).backup).toEqual({
      lastBackupAt: '2026-11-02T14:30:45',
      lastBackupPath: RESULT.path,
      lastBackupOutcome: 'ok'
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- the P1 failure reason (D: persistence boundary) ---------------------------

test('a failure with a reason records the human phrase beside the outcome', async () => {
  const service = memoryService();
  await recordBackupSuccess(service, RESULT, NOW);
  await recordBackupFailure(service, '磁盘空间不足');

  expect((await service.get()).backup).toEqual({
    lastBackupAt: '2026-11-02T14:30:45',
    lastBackupPath: RESULT.path,
    lastBackupOutcome: 'failed',
    lastBackupError: '磁盘空间不足'
  });
});

test('a success never silences an unsaid failure (D: only the weekly read clears)', async () => {
  const service = memoryService();
  await recordBackupFailure(service, '磁盘空间不足');
  await recordBackupSuccess(service, RESULT, NOW);

  const backup = (await service.get()).backup;
  expect(backup).toMatchObject({
    lastBackupOutcome: 'ok',
    lastBackupAt: '2026-11-02T14:30:45',
    lastBackupError: '磁盘空间不足'
  });
});

test('clearBackupError clears a pending reason and keeps the outcome', async () => {
  const service = memoryService();
  await recordBackupSuccess(service, RESULT, NOW);
  await recordBackupFailure(service, '磁盘空间不足');

  await clearBackupError(service);
  expect((await service.get()).backup).toEqual({
    lastBackupAt: '2026-11-02T14:30:45',
    lastBackupPath: RESULT.path,
    lastBackupOutcome: 'failed'
  });

  // A second clear with nothing pending is a no-op (no settings write).
  await clearBackupError(service);
  expect((await service.get()).backup).toEqual({
    lastBackupAt: '2026-11-02T14:30:45',
    lastBackupPath: RESULT.path,
    lastBackupOutcome: 'failed'
  });
});
