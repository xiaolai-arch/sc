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

/**
 * Records a failed attempt. The outcome is display-only; the optional reason
 * (P1, auto backup only) is the human-readable cause that persists until the
 * next Sunday review has spoken it once — a later success never clears it,
 * because an unsaid failure must still be said. A cancelled picker and a
 * failure without a reason write only the outcome, exactly as P0 did.
 */
export async function recordBackupFailure(
  settings: SettingsService,
  reason?: string
): Promise<void> {
  await settings.update({
    backup: {
      lastBackupOutcome: 'failed',
      ...(typeof reason === 'string' && reason.trim() !== '' ? { lastBackupError: reason } : {})
    }
  });
}

/**
 * Clears a spoken auto-backup failure reason (P1). The Sunday review calls
 * this after the three-layer copy has landed, so the sentence is said exactly
 * once; `lastBackupOutcome` stays for the settings card. Clearing is an empty
 * patch value, which removes the key like the mute-date keys do.
 */
export async function clearBackupError(settings: SettingsService): Promise<void> {
  const current = await settings.get();
  if (!current.backup?.lastBackupError) return;
  await settings.update({ backup: { lastBackupError: '' } });
}
