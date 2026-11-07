import { copyFile, cp, mkdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { BackupResult, RestoreResult } from '../shared/ipc';

export type { BackupCopied, BackupResult, RestoreResult } from '../shared/ipc';

export interface CreateBackupOptions {
  vaultPath: string;
  userDataPath: string;
  /** Directory the user picked; a timestamped folder is created inside it. */
  destinationRoot: string;
  now?: () => Date;
}

export interface ExportBackupOptions {
  /** Native directory picker; null means the user cancelled. */
  pickDirectory: () => Promise<string | null>;
  getPaths: () => Promise<{ vaultPath: string; userDataPath: string }>;
  now?: () => Date;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function backupStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}`;
}

function backupTimestamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function isInside(child: string, parent: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

/**
 * Resolves symlinks for the existing part of a path. Missing tail components
 * (e.g. the chosen folder does not exist yet) are appended to the resolved
 * parent so `/var` vs `/private/var` style aliases cannot defeat the check.
 */
async function realPathOrResolve(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) return resolve(path);
    return join(await realPathOrResolve(parent), basename(path));
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Copies the user's local data into a new timestamped folder. Secrets are never
 * read: only the vault, conversations, state.json and usage.json are included.
 */
export async function createBackup(options: CreateBackupOptions): Promise<BackupResult> {
  const now = (options.now ?? (() => new Date()))();
  const vaultPath = resolve(options.vaultPath);
  const userDataPath = resolve(options.userDataPath);
  const destinationRoot = resolve(options.destinationRoot);

  // Compare physical paths so a symlinked destination cannot point back into
  // the sources and turn the copy into a recursive self-copy.
  const [realVault, realUserData, realDestination] = await Promise.all([
    realPathOrResolve(vaultPath),
    realPathOrResolve(userDataPath),
    realPathOrResolve(destinationRoot)
  ]);
  if (isInside(realDestination, realVault) || isInside(realDestination, realUserData)) {
    throw new Error('备份目录不能位于 vault 或应用数据目录内。');
  }

  await mkdir(destinationRoot, { recursive: true });
  const baseName = `study-coach-backup-${backupStamp(now)}`;
  let target = join(destinationRoot, baseName);
  await (async () => {
    for (let suffix = 1; ; suffix += 1) {
      try {
        await mkdir(target, { recursive: false });
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (suffix >= 1000) throw new Error('备份目录名称冲突过多。');
        target = join(destinationRoot, `${baseName}-${suffix + 1}`);
      }
    }
  })();

  const vaultExists = await isDirectory(vaultPath);
  if (vaultExists) {
    // Dereference the vault root (and any links inside it) so an iCloud/Dropbox
    // symlinked vault is copied as real data, not a dangling link.
    await cp(vaultPath, join(target, 'vault'), { recursive: true, dereference: true });
  }

  const conversationsSource = join(userDataPath, 'conversations');
  const conversationsExists = await isDirectory(conversationsSource);
  if (conversationsExists) {
    await cp(conversationsSource, join(target, 'conversations'), {
      recursive: true,
      dereference: true
    });
  }

  const stateSource = join(userDataPath, 'state.json');
  const stateExists = await isFile(stateSource);
  if (stateExists) {
    await copyFile(stateSource, join(target, 'state.json'));
  }

  const usageSource = join(userDataPath, 'usage.json');
  const usageExists = await isFile(usageSource);
  if (usageExists) {
    await copyFile(usageSource, join(target, 'usage.json'));
  }

  const readme = [
    'ASAKI备份',
    `导出时间：${backupTimestamp(now)}（本地时间）`,
    '',
    '包含项：',
    `- vault/：${vaultExists ? '已包含' : '源目录不存在，已跳过'}`,
    `- conversations/：${conversationsExists ? '已包含' : '源目录不存在，已跳过'}`,
    `- state.json：${stateExists ? '已包含' : '源文件不存在，已跳过'}`,
    `- usage.json：${usageExists ? '已包含' : '源文件不存在，已跳过'}`,
    '',
    '不包含：API Key、secrets/ 或任何凭据。',
    '',
    '恢复提示：在「设置 → 数据与备份 → 从备份恢复…」选择本文件夹，可恢复 vault、对话和用量；当前设置与 API Key 保持不变。',
    '也可以手动将 vault/ 放回原 vault 路径；state.json 和 usage.json 可放回应用数据目录。',
    ''
  ].join('\n');
  await writeFile(join(target, 'README.txt'), readme, 'utf8');

  return {
    path: target,
    copied: {
      vault: vaultExists,
      conversations: conversationsExists,
      state: stateExists,
      usage: usageExists
    }
  };
}

/** Testable wrapper around the native directory picker. */
export async function handleExportBackup(
  options: ExportBackupOptions
): Promise<BackupResult | null> {
  const destinationRoot = await options.pickDirectory();
  if (destinationRoot === null) return null;
  const paths = await options.getPaths();
  return createBackup({
    vaultPath: paths.vaultPath,
    userDataPath: paths.userDataPath,
    destinationRoot,
    ...(options.now ? { now: options.now } : {})
  });
}

export interface RestoreBackupOptions {
  backupPath: string;
  vaultPath: string;
  userDataPath: string;
  now?: () => Date;
}

export type RestoreBackupResult = RestoreResult;

export interface RestoreBackupHandleOptions {
  pickDirectory: () => Promise<string | null>;
  getPaths: () => Promise<{ vaultPath: string; userDataPath: string }>;
  now?: () => Date;
}

function restoreStamp(date: Date): string {
  return `restore-safety-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Replaces `target` with `staged` without ever deleting the only copy first.
 * The existing target is renamed aside (same volume, atomic), then the staged
 * directory takes its place; if that rename fails, the old directory is put
 * back. Only after a successful swap is the old copy removed.
 */
export async function swapDirectory(staged: string, target: string): Promise<void> {
  const previous = `${target}.asaki-restore-old-${process.pid}-${randomUUID()}`;
  let movedAside = false;
  try {
    await rename(target, previous);
    movedAside = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  try {
    await rename(staged, target);
  } catch (error) {
    if (movedAside) {
      await rename(previous, target).catch(() => undefined);
    }
    throw error;
  }

  if (movedAside) {
    await rm(previous, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function copyFileAtomic(source: string, target: string): Promise<void> {
  const temp = `${target}.restore-tmp-${process.pid}-${randomUUID()}`;
  await copyFile(source, temp);
  const previous = `${target}.restore-old-${process.pid}-${randomUUID()}`;
  let movedAside = false;
  try {
    await rename(target, previous);
    movedAside = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  try {
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    if (movedAside) {
      await rename(previous, target).catch(() => undefined);
    }
    throw error;
  }

  if (movedAside) {
    await rm(previous, { force: true }).catch(() => undefined);
  }
}

/**
 * Restores a backup in place. The current vault, conversations, settings and
 * usage are snapshotted under `<userData>/restore-safety/<stamp>` first, so a
 * failed or regretted restore can be recovered by hand. `state.json` is
 * deliberately not restored: it carries the vault path and provider settings,
 * and overwriting them could point the app at a stale location. Secrets are
 * untouched.
 */
export async function restoreBackup(options: RestoreBackupOptions): Promise<RestoreBackupResult> {
  const now = (options.now ?? (() => new Date()))();
  const backupPath = resolve(options.backupPath);
  const vaultPath = resolve(options.vaultPath);
  const userDataPath = resolve(options.userDataPath);

  const [realBackup, realVault, realUserData] = await Promise.all([
    realPathOrResolve(backupPath),
    realPathOrResolve(vaultPath),
    realPathOrResolve(userDataPath)
  ]);
  if (isInside(realBackup, realVault) || isInside(realBackup, realUserData)) {
    throw new Error('备份目录不能位于当前 vault 或应用数据目录内。');
  }

  const sourceVault = join(realBackup, 'vault');
  if (!(await isDirectory(sourceVault))) {
    throw new Error('所选目录不是 ASAKI 备份：缺少 vault 文件夹。');
  }
  const realSourceVault = await realPathOrResolve(sourceVault);
  if (isInside(realSourceVault, realVault)) {
    throw new Error('备份目录不能位于当前 vault 或应用数据目录内。');
  }

  const conversationsSource = join(realBackup, 'conversations');
  const conversationsExists = await isDirectory(conversationsSource);
  const usageSource = join(realBackup, 'usage.json');
  const usageExists = await isFile(usageSource);

  const safetyPath = join(userDataPath, 'restore-safety', restoreStamp(now));
  await mkdir(safetyPath, { recursive: true });
  if (await isDirectory(vaultPath)) {
    await cp(vaultPath, join(safetyPath, 'vault'), { recursive: true, dereference: true });
  }
  const currentConversations = join(userDataPath, 'conversations');
  if (await isDirectory(currentConversations)) {
    await cp(currentConversations, join(safetyPath, 'conversations'), {
      recursive: true,
      dereference: true
    });
  }
  for (const name of ['state.json', 'usage.json']) {
    const source = join(userDataPath, name);
    if (await isFile(source)) await copyFile(source, join(safetyPath, name));
  }

  // Stage copies next to their targets so the swap is a same-volume rename.
  const realTargetVault = await realPathOrResolve(vaultPath);
  const restoreId = `${process.pid}-${randomUUID()}`;
  const vaultStage = join(dirname(realTargetVault), `.asaki-restore-vault-${restoreId}`);
  let conversationsStage: string | null = null;
  try {
    await rm(vaultStage, { recursive: true, force: true });
    await cp(sourceVault, vaultStage, { recursive: true, dereference: true });
    if (conversationsExists) {
      conversationsStage = join(userDataPath, `.asaki-restore-conversations-${restoreId}`);
      await rm(conversationsStage, { recursive: true, force: true });
      await cp(conversationsSource, conversationsStage, { recursive: true, dereference: true });
    }
  } catch (error) {
    await rm(vaultStage, { recursive: true, force: true });
    if (conversationsStage) await rm(conversationsStage, { recursive: true, force: true });
    throw error;
  }

  try {
    await swapDirectory(vaultStage, realTargetVault);
  } catch (error) {
    await rm(vaultStage, { recursive: true, force: true });
    if (conversationsStage) await rm(conversationsStage, { recursive: true, force: true });
    throw error;
  }

  if (conversationsStage) {
    try {
      await swapDirectory(conversationsStage, currentConversations);
    } catch (error) {
      // The vault was already replaced; point the user at the safety snapshot.
      throw new Error(
        `对话恢复失败，vault 已恢复。恢复前的数据保存在：${safetyPath}（${(error as Error).message}）`
      );
    }
  }

  if (usageExists) {
    await copyFileAtomic(usageSource, join(userDataPath, 'usage.json'));
  }

  return {
    path: realBackup,
    safetyPath,
    restored: {
      vault: true,
      conversations: conversationsExists,
      usage: usageExists
    }
  };
}

export async function handleRestoreBackup(
  options: RestoreBackupHandleOptions
): Promise<RestoreBackupResult | null> {
  const backupPath = await options.pickDirectory();
  if (backupPath === null) return null;
  const paths = await options.getPaths();
  return restoreBackup({
    backupPath,
    vaultPath: paths.vaultPath,
    userDataPath: paths.userDataPath,
    ...(options.now ? { now: options.now } : {})
  });
}
