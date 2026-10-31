import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AppSettings, DailyPlan, ExamProfile, ReviewAnswers } from '../shared/types';

/** Everything the desktop shell persists outside of the vault itself. */
export interface AppState {
  profile: ExamProfile | null;
  onboarded: boolean;
  plan: DailyPlan | null;
  reviews: Record<string, ReviewAnswers>;
  settings: AppSettings;
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
    return {
      profile: value.profile === null || value.profile === undefined ? null : (value.profile as ExamProfile),
      onboarded:
        typeof value.onboarded === 'boolean'
          ? value.onboarded
          : value.profile !== null && value.profile !== undefined,
      plan: value.plan === null || value.plan === undefined ? null : (value.plan as DailyPlan),
      reviews: isRecord(value.reviews) ? (value.reviews as Record<string, ReviewAnswers>) : {},
      settings: isRecord(value.settings)
        ? {
            ...defaults.settings,
            ...(value.settings as Partial<AppSettings>),
            provider: (value.settings.provider as AppSettings['provider']) ?? defaults.settings.provider,
            notifications: {
              ...defaults.settings.notifications,
              ...((value.settings.notifications as Partial<AppSettings['notifications']>) ?? {})
            },
            budget: {
              ...defaults.settings.budget,
              ...((value.settings.budget as Partial<AppSettings['budget']>) ?? {})
            }
          }
        : defaults.settings
    };
  }
}
