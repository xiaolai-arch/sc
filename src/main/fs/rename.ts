import { renameSync } from 'node:fs';
import { rename } from 'node:fs/promises';

// Windows refuses a rename while another writer is replacing the same target
// (or a virus scanner briefly holds it). POSIX renames are atomic, so the retry
// is only needed on Windows, but it is harmless everywhere.
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_ATTEMPTS = 20;
const RENAME_RETRY_DELAY_MS = 10;

function isTransientRenameError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return TRANSIENT_RENAME_CODES.has((error as NodeJS.ErrnoException).code ?? '');
}

/** Renames a temp file over its destination, retrying transient Windows locks. */
export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (!isTransientRenameError(error) || attempt >= RENAME_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS));
    }
  }
}

/** `Atomics.wait` is the only synchronous sleep available on the main thread. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Synchronous variant for shutdown paths that cannot await. */
export function renameSyncWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      if (!isTransientRenameError(error) || attempt >= RENAME_ATTEMPTS) throw error;
      sleepSync(RENAME_RETRY_DELAY_MS);
    }
  }
}