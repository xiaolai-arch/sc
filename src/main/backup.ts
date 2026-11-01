import { copyFile, cp, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { BackupResult } from '../shared/ipc';

export type { BackupCopied, BackupResult } from '../shared/ipc';

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
    await cp(vaultPath, join(target, 'vault'), { recursive: true });
  }

  const conversationsSource = join(userDataPath, 'conversations');
  const conversationsExists = await isDirectory(conversationsSource);
  if (conversationsExists) {
    await cp(conversationsSource, join(target, 'conversations'), { recursive: true });
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
    '恢复提示：将 vault/ 放回原 vault 路径；state.json 和 usage.json 可放回应用数据目录。',
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
