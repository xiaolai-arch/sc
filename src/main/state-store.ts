import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isLocalDate } from '../shared/date';
import type { FocusSnapshotRecord } from '../shared/ipc';
import type { AppSettings } from '../shared/types';

/**
 * Everything the desktop shell persists outside of the vault itself. Learning
 * content (tasks, plans, reviews) lives in the vault; only onboarding status,
 * shell settings and the focus-session snapshot stay here.
 */
export interface AppState {
  onboarded: boolean;
  settings: AppSettings;
  /**
   * The single focus-session slot (iter33 P2b①). Machine-transient timing
   * state, deliberately not vault content. Absent means nothing to restore.
   */
  focusSession?: FocusSnapshotRecord;
}

export interface JsonStateStoreOptions {
  /** `null` keeps the store in memory; useful in tests and browser-less runs. */
  filePath: string | null;
  createDefault: () => AppState;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A small JSON-backed state store with serialized writes and atomic replaces.
 * The cache is hydrated once and then kept in sync with successful writes.
 */
export class JsonStateStore {
  private readonly filePath: string | null;
  private readonly createDefault: () => AppState;
  private cache: AppState | null = null;
  private queue: Promise<void> = Promise.resolve();
  private tempCounter = 0;

  constructor(options: JsonStateStoreOptions) {
    this.filePath = options.filePath;
    this.createDefault = options.createDefault;
  }

  async read(): Promise<AppState> {
    await this.queue;
    return clone(await this.readUnlocked());
  }

  async update(mutator: (current: AppState) => AppState | Promise<AppState>): Promise<AppState> {
    const task = this.queue.then(async () => {
      const current = await this.readUnlocked();
      const next = await mutator(clone(current));
      await this.writeUnlocked(next);
      return clone(next);
    });
    this.queue = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  }

  async reset(): Promise<AppState> {
    return this.update(() => this.createDefault());
  }

  /**
   * Discards the cached state and re-reads the file. Writers outside this
   * class — the restore handler adopting a backup's `state.json` with a direct
   * atomic write — are invisible to read/update, which only trust the cache;
   * without this entry a later `completeWorkspaceOnboarding` would write
   * `onboarded: true` over the in-memory defaults and erase the adopted
   * settings. The re-read queues behind any pending update (never bypassing
   * one) and future updates queue behind it, so the cache and the file
   * converge on whatever is finally on disk. A missing or corrupt file reads
   * as the defaults, like startup hydration.
   */
  async reloadFromDisk(): Promise<AppState> {
    const task = this.queue.then(async () => {
      if (this.filePath !== null) this.cache = null;
      return clone(await this.readUnlocked());
    });
    this.queue = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  }

  private async readUnlocked(): Promise<AppState> {
    if (this.cache) return this.cache;
    if (!this.filePath) {
      this.cache = this.createDefault();
      return this.cache;
    }
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      this.cache = this.hydrate(parsed);
    } catch {
      // A missing or corrupt state file must not prevent the app from starting.
      this.cache = this.createDefault();
    }
    return this.cache;
  }

  private async writeUnlocked(state: AppState): Promise<void> {
    const next = this.hydrate(state);
    if (this.filePath) {
      const directory = dirname(this.filePath);
      await mkdir(directory, { recursive: true });
      this.tempCounter += 1;
      const tempPath = join(directory, `.state-${process.pid}-${this.tempCounter}.tmp`);
      try {
        await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        await rename(tempPath, this.filePath);
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
    }
    this.cache = next;
  }

  private hydrate(value: unknown): AppState {
    const defaults = this.createDefault();
    if (!isRecord(value)) return defaults;
    const rawSettings = value.settings;
    const focusSession = parseFocusSnapshot(value.focusSession);
    return {
      onboarded: typeof value.onboarded === 'boolean' ? value.onboarded : false,
      settings: isRecord(rawSettings)
        ? {
            ...defaults.settings,
            ...(rawSettings as Partial<AppSettings>),
            // The provider is a discriminated union, so a partial block merges
            // over the defaults only when it is the same kind (a partial
            // local-cli entry still gets its `command` filled); a different or
            // unknown kind is taken as a whole, the way a full block always
            // was. Matches the notifications/budget deep merges.
            provider: hydrateProvider(rawSettings.provider, defaults.settings.provider),
            notifications: {
              ...defaults.settings.notifications,
              ...((rawSettings.notifications as Partial<AppSettings['notifications']>) ?? {})
            },
            budget: {
              ...defaults.settings.budget,
              ...((rawSettings.budget as Partial<AppSettings['budget']>) ?? {})
            }
          }
        : defaults.settings,
      // The focus slot rides along on every write (settings updates included),
      // so a regular settings write can never erase a live snapshot. A
      // malformed value — the 坏 JSON/坏形态 case — is dropped, not kept.
      ...(focusSession ? { focusSession } : {})
    };
  }
}

/**
 * Reads the persisted focus slot, keeping only a well-formed record. Every
 * field is checked by type: a hand-edited or half-written file must never
 * surface a session the restore rules cannot trust. Anything else reads as
 * "no snapshot", which the restore rules then discard.
 */
export function parseFocusSnapshot(value: unknown): FocusSnapshotRecord | undefined {
  if (!isRecord(value)) return undefined;
  const workspaceId = value.workspaceId;
  const session = value.session;
  if (typeof workspaceId !== 'string' || workspaceId.trim() === '') return undefined;
  if (!isRecord(session)) return undefined;
  if (typeof session.sessionId !== 'number' || !Number.isFinite(session.sessionId)) {
    return undefined;
  }
  if (typeof session.taskId !== 'string' || session.taskId === '') return undefined;
  if (typeof session.taskTitle !== 'string') return undefined;
  if (typeof session.remainingMs !== 'number' || !Number.isFinite(session.remainingMs)) {
    return undefined;
  }
  if (typeof session.running !== 'boolean' || typeof session.recorded !== 'boolean') {
    return undefined;
  }
  if (typeof session.lastTickAt !== 'number' || !Number.isFinite(session.lastTickAt)) {
    return undefined;
  }
  const savedAtLocalDate = value.savedAtLocalDate;
  if (!isLocalDate(savedAtLocalDate)) return undefined;
  return {
    workspaceId,
    session: {
      sessionId: session.sessionId,
      taskId: session.taskId,
      taskTitle: session.taskTitle,
      remainingMs: session.remainingMs,
      running: session.running,
      recorded: session.recorded,
      lastTickAt: session.lastTickAt
    },
    savedAtLocalDate
  };
}

/**
 * Fills a stored provider block over the defaults without mixing kinds. A
 * partial block of the default kind gets the defaults' missing fields (e.g. a
 * local-cli entry without `command`); anything else — absent, not an object,
 * or another kind — passes through whole, or falls back to the defaults.
 */
function hydrateProvider(
  stored: unknown,
  defaults: AppSettings['provider']
): AppSettings['provider'] {
  if (!isRecord(stored)) return defaults;
  if (stored.kind !== defaults.kind) return stored as AppSettings['provider'];
  return { ...defaults, ...stored } as AppSettings['provider'];
}
