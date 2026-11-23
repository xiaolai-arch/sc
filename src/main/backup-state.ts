import { formatLocalDateTimeSeconds } from '../shared/date';
import type { BackupResult } from '../shared/ipc';
import type { SettingsService } from './settings/settings-service';

/**
 * The last-backup state (P0): what the settings card's status line and the
 * Sunday review's opt-in age line quote. A success records the local time,
 * the folder and `ok` together; a failure records only `failed`, leaving the
 * previous success's time and path in place for the 「上次成功」 line. A
 * cancelled picker records nothing, and neither write ever blocks a later
 * attempt — the outcome is a fact about the last try, not a lock.
 */
export async function recordBackupSuccess(
  settings: SettingsService,
  result: BackupResult,
  now: () => Date = () => new Date()
): Promise<void> {
  await settings.update({
    backup: {
      lastBackupAt: formatLocalDateTimeSeconds(now()),
      lastBackupPath: result.path,
      lastBackupOutcome: 'ok'
    }
  });
}

export async function recordBackupFailure(settings: SettingsService): Promise<void> {
  await settings.update({ backup: { lastBackupOutcome: 'failed' } });
}
