import { readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * How many backup folders the auto-destination keeps (spec P4, aligned with
 * Logseq). The count includes the copy that was just created: it is protected
 * by explicit path identity and occupies one slot, so the ranked pool of
 * older copies keeps `RETAIN_AUTO_BACKUPS - 1` and the folder ends at exactly
 * 12 copies after every successful auto backup.
 */
export const RETAIN_AUTO_BACKUPS = 12;

/**
 * A folder counts as an auto backup only when the whole remainder of the name
 * is a backup stamp (`YYYY-MM-DD-HHMM`, what `createBackup` writes) optionally
 * followed by the collision suffix `-<n>` (`-2`, `-3`, …, never written as
 * `-1`). Anything else a user renamed or created — `study-coach-backup` bare,
 * `study-coach-backup-renamed`, `study-coach-backup-2026-11-02-1430-改` —
 * parses to null and is never a deletion candidate.
 */
const AUTO_BACKUP_NAME = /^study-coach-backup-(\d{4}-\d{2}-\d{2}-\d{4})(?:-(\d+))?$/;

export interface ParsedAutoBackupName {
  /** The embedded stamp, e.g. `2026-11-02-1430`. Fixed width, so stamps compare as strings. */
  stamp: string;
  /**
   * The collision suffix as a number; the unsuffixed first folder of a minute
   * counts as 1. Numeric so `-10` ranks newer than `-2` (a plain string
   * compare would not).
   */
  suffix: number;
}

export function parseAutoBackupName(name: string): ParsedAutoBackupName | null {
  const match = AUTO_BACKUP_NAME.exec(name);
  if (!match) return null;
  return { stamp: match[1]!, suffix: match[2] ? Number(match[2]) : 1 };
}

/**
 * The rotation ranking (spec: 按备份时间戳排序，含目录名后缀顺延). Age is the
 * directory name, never the mtime — a restore or antivirus can touch an old
 * folder's mtime, while the name stamp is written once at creation. Fixed
 * width stamps order correctly as strings, and the suffix orders numerically
 * within one stamp, which is exactly creation order: the unsuffixed folder
 * first, then `-2`, `-3`, …, each still older than the next minute's folder.
 *
 * Pure: returns the names to delete, oldest first, keeping the newest
 * `retain` of the parsed candidates. Names that do not parse never enter the
 * plan, so they can never be deleted here.
 */
export function planAutoBackupDeletions(names: readonly string[], retain: number): string[] {
  const ranked = names
    .map((name) => ({ name, parsed: parseAutoBackupName(name) }))
    .filter((entry): entry is { name: string; parsed: ParsedAutoBackupName } => entry.parsed !== null)
    .sort((a, b) =>
      a.parsed.stamp === b.parsed.stamp
        ? a.parsed.suffix - b.parsed.suffix
        : a.parsed.stamp < b.parsed.stamp
          ? -1
          : 1
    );
  const keep = Math.max(0, retain);
  return ranked.slice(0, Math.max(0, ranked.length - keep)).map((entry) => entry.name);
}

export interface AutoBackupPruneOutcome {
  /** Folders removed, oldest first. */
  deleted: string[];
  /** Folders that could not be removed this round; the next success retries them. */
  failed: string[];
}

export interface PruneAutoBackupsOptions {
  /** The auto backup destination (`backup.autoDestination`). */
  destinationRoot: string;
  /**
   * The copy this round just created. It is excluded by resolved path before
   * any ranking happens, so a clock rollback that makes its stamp sort oldest
   * still cannot put it in the deletion set (验收 26).
   */
  keepPath: string;
  /** Defaults to `RETAIN_AUTO_BACKUPS`. */
  retain?: number;
  /** Seam for tests: lists the directory names inside `root`. */
  listDirectories?: (root: string) => Promise<string[]>;
  /** Seam for tests: removes one directory tree. */
  removeDirectory?: (path: string) => Promise<void>;
}

function samePath(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function listDirectoriesDefault(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  // Only real directories are candidates: a stray file carrying a backup
  // name, or a symlink (readdir reports links as links), is never removed.
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function removeDirectoryDefault(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

/**
 * The P4 rotation: after a successful auto backup, trim `destinationRoot` to
 * the newest `RETAIN_AUTO_BACKUPS` copies. The deletion set is the
 * intersection of three conditions — the name parses as a backup folder, the
 * folder sits inside `destinationRoot`, and it ranks outside the newest
 * copies — so user folders, renamed exports and anything outside the
 * destination are never touched. The just-created copy is excluded by path
 * before ranking. Each removal is attempted on its own: one stuck folder
 * (占用/权限) lands in `failed`, the backup stays a success, and the next
 * successful auto backup tries again. This function never throws — an
 * unreadable destination resolves to an empty outcome — so a cleanup problem
 * can never surface to the renderer as a failed backup.
 */
export async function pruneAutoBackups(
  options: PruneAutoBackupsOptions
): Promise<AutoBackupPruneOutcome> {
  const retain = options.retain ?? RETAIN_AUTO_BACKUPS;
  const root = resolve(options.destinationRoot);
  const keepPath = resolve(options.keepPath);
  const list = options.listDirectories ?? listDirectoriesDefault;
  const remove = options.removeDirectory ?? removeDirectoryDefault;

  let names: string[];
  try {
    names = await list(root);
  } catch {
    // Nothing to clean (or nothing readable): best effort, never an error.
    return { deleted: [], failed: [] };
  }

  // The protected copy leaves the pool before any ranking (硬约束 1).
  const pool = names.filter((name) => !samePath(join(root, name), keepPath));
  // The protected copy occupies one of the retained slots, so the ranked
  // pool keeps one less and the folder ends at exactly `retain` copies.
  const deletions = planAutoBackupDeletions(pool, Math.max(0, retain - 1));

  const deleted: string[] = [];
  const failed: string[] = [];
  for (const name of deletions) {
    const path = join(root, name);
    try {
      await remove(path);
      deleted.push(name);
    } catch {
      // 占用/权限 this round; the next successful auto backup retries it.
      failed.push(name);
    }
  }
  return { deleted, failed };
}
