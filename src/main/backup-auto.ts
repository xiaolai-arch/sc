import { isAbsolute } from 'node:path';
import { isLocalDate, isLocalDateTimeSeconds, localDaysBetween } from '../shared/date';
import type { BackupSettings } from '../shared/types';
import { createBackup } from './backup';
import { recordBackupFailure, recordBackupSuccess } from './backup-state';
import type { SettingsService } from './settings/settings-service';

/** Default cadence when `autoIntervalDays` is absent (spec P1). */
export const DEFAULT_AUTO_INTERVAL_DAYS = 7;

/**
 * Whether the weekly auto backup is due on local `date`. The formula is the
 * spec's: `lastBackupAt 的本地日期 + autoIntervalDays <= 今天` — i.e. the
 * whole local days between the last success and today reach the interval.
 * A missing or unreadable `lastBackupAt` means never backed up, which is due;
 * a future-dated one (clock skew) reads as a negative age and waits.
 *
 * Pure and deterministic: the check-in date comes from the weekly review's own
 * tick (already the local `YYYY-MM-DD` of the review), so tests inject the
 * date instead of a clock — there is no daily trigger point to fake.
 */
export function isAutoBackupDue(
  backup: Pick<BackupSettings, 'lastBackupAt'> | null | undefined,
  intervalDays: number | undefined,
  date: string
): boolean {
  if (!isLocalDate(date)) return false;
  const interval =
    typeof intervalDays === 'number' && intervalDays > 0 ? intervalDays : DEFAULT_AUTO_INTERVAL_DAYS;
  if (!isLocalDateTimeSeconds(backup?.lastBackupAt)) return true;
  const days = localDaysBetween(backup.lastBackupAt.slice(0, 10), date);
  return days >= interval;
}

const ERRNO_REASONS: Record<string, string> = {
  EACCES: '没有写入备份文件夹的权限',
  EPERM: '没有写入备份文件夹的权限',
  ENOSPC: '磁盘空间不足',
  EBUSY: '备份文件夹正被其他程序占用',
  EMFILE: '打开的文件太多，请稍后重试',
  ENFILE: '打开的文件太多，请稍后重试',
  ENOENT: '备份文件夹不存在',
  ENOTDIR: '备份文件夹路径无效',
  EISDIR: '备份路径是一个文件夹，无法覆盖',
  EROFS: '备份文件夹所在的磁盘是只读的'
};

/**
 * Maps a thrown auto-backup failure to one human sentence fragment, for the
 * settings card and the three-layer review copy. Known errno codes map to
 * short Chinese causes; the backup's own validation errors are already
 * Chinese and pass through; anything else stays vague on purpose — no stacks,
 * no English plumbing, and never the words 「损坏」 or 「数据可能丢失」.
 */
export function describeAutoBackupError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (typeof code === 'string' && ERRNO_REASONS[code]) return ERRNO_REASONS[code];
  if (error instanceof Error) {
    const message = error.message.replace(/[\r\n]+/g, ' ').trim();
    // Our own createBackup guards throw Chinese sentences; quote them as-is.
    if (message !== '' && /[一-鿿]/.test(message)) {
      return message.length > 200 ? message.slice(0, 200) : message;
    }
  }
  return '无法写入备份文件夹';
}

/** The auto backup the weekly review triggers; the runner owns 「是否到期」. */
export interface AutoBackupRunner {
  /**
   * Runs the auto backup when it is due on `date` (the triggering review's
   * local day). Resolves `true` when a backup was started and succeeded;
   * `false` when it was not due, not enabled, or it failed (a failure is
   * recorded in settings, never thrown).
   */
  runIfDue(date: string): Promise<boolean>;
}

export interface AutoBackupRunnerOptions {
  settings: SettingsService;
  /** The app data directory, copied into the backup like a manual export. */
  userDataPath: string;
  now?: () => Date;
}

/**
 * The weekly auto backup runner. All gates read live settings, so a settings
 * write takes effect on the next weekly review without any rebuild:
 *
 * 1. `weeklyEnabled` off → never (the auto backup rides the weekly review).
 * 2. `autoEnabled` off → never (默认关 is the owner's decision).
 * 3. no valid `autoDestination` → never, and never an error (验收 11).
 * 4. not due yet → never (验收 9; the due formula is the only dedupe).
 *
 * A success records the last-backup facts; a failure records the outcome plus
 * a human reason and resolves instead of throwing — the weekly message has
 * already been delivered and the renderer is never involved. An in-flight
 * guard keeps two overlapping triggers from racing, on top of the due formula.
 */
export function createAutoBackupRunner(options: AutoBackupRunnerOptions): AutoBackupRunner {
  let inFlight = false;
  const now = options.now ?? (() => new Date());
  return {
    async runIfDue(date: string): Promise<boolean> {
      if (inFlight) return false;
      const settings = await options.settings.get();
      const backup = settings.backup;
      if (backup?.autoEnabled !== true) return false;
      if (settings.notifications.weeklyEnabled === false) return false;
      const destination = backup.autoDestination;
      if (typeof destination !== 'string' || !isAbsolute(destination)) return false;
      if (!isAutoBackupDue(backup, backup.autoIntervalDays, date)) return false;
      inFlight = true;
      try {
        const result = await createBackup({
          vaultPath: settings.vaultPath,
          userDataPath: options.userDataPath,
          destinationRoot: destination,
          now
        });
        await recordBackupSuccess(options.settings, result, now);
        return true;
      } catch (error) {
        // The three-layer copy on the next review is the only reporter; this
        // must never reach the renderer as a rejected promise.
        await recordBackupFailure(options.settings, describeAutoBackupError(error)).catch(
          () => undefined
        );
        return false;
      } finally {
        inFlight = false;
      }
    }
  };
}
