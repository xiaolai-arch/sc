import { watch } from 'chokidar';

export type VaultFileEvent = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface VaultWatcherHandlers {
  onFileEvent(event: VaultFileEvent, absPath: string): void;
  onError(error: unknown): void;
}

/** Minimal watcher contract so tests can inject a fake instead of chokidar. */
export interface VaultWatcher {
  close(): Promise<void>;
}

export type WatcherFactory = (
  vaultRoot: string,
  handlers: VaultWatcherHandlers
) => VaultWatcher | Promise<VaultWatcher>;

function isHiddenSegment(segment: string): boolean {
  return segment.startsWith('.');
}

/** True when any path segment (on either separator) is dot-hidden. */
export function hasHiddenSegment(absPath: string): boolean {
  return absPath.split(/[\\/]/).some(isHiddenSegment);
}

/**
 * Real watcher: chokidar on the vault root. Symlinks are never followed, the
 * initial tree is skipped (the service's own scan covers it), and dotfiles
 * (`.obsidian`, `.trash`, `.DS_Store`, …) are ignored.
 */
export function createChokidarWatcher(vaultRoot: string, handlers: VaultWatcherHandlers): VaultWatcher {
  const watcher = watch(vaultRoot, {
    ignoreInitial: true,
    followSymlinks: false,
    persistent: true,
    ignored: (path: string) => hasHiddenSegment(path),
    // Vault writes are atomic renames, but user editors (Obsidian) are not;
    // this waits for writes to settle before we re-parse the file.
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 }
  });
  const fileEvents: readonly VaultFileEvent[] = ['add', 'change', 'unlink', 'addDir', 'unlinkDir'];
  for (const event of fileEvents) {
    watcher.on(event, (absPath: string) => handlers.onFileEvent(event, absPath));
  }
  watcher.on('error', (error: unknown) => handlers.onError(error));
  return {
    close(): Promise<void> {
      return watcher.close();
    }
  };
}
