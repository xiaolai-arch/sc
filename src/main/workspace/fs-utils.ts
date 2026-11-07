import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { renameWithRetry } from '../fs/rename';

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (err) {
    if (isENOENT(err)) return false;
    throw err;
  }
}

export async function readFileOrNull(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, 'utf8');
  } catch (err) {
    if (isENOENT(err)) return null;
    throw err;
  }
}

/**
 * All vault writes go through a temp file + rename so readers never observe a
 * half-written note, even if the process dies mid-write.
 */
export async function writeFileAtomic(absPath: string, content: string): Promise<void> {
  await fs.mkdir(dirname(absPath), { recursive: true });
  const tmpPath = `${absPath}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(tmpPath, content, 'utf8');
  await renameWithRetry(tmpPath, absPath);
}

/** Sorted `.md` file names inside a directory ([] when missing). */
export async function listMarkdownFiles(absDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch (err) {
    if (isENOENT(err)) return [];
    throw err;
  }
}

/** Sorted subdirectory names inside a directory ([] when missing). */
export async function listDirectories(absDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch (err) {
    if (isENOENT(err)) return [];
    throw err;
  }
}

/**
 * Serializes in-process read-modify-write cycles so concurrent service calls
 * cannot clobber each other. Cross-process races still resolve last-writer-wins
 * without torn files thanks to the atomic rename.
 */
export function createMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return function runExclusively<T>(fn: () => Promise<T>): Promise<T> {
    const next = tail.then(fn, fn);
    tail = next.catch(() => undefined);
    return next;
  };
}
