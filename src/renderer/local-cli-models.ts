import { useSyncExternalStore } from 'react';
import type {
  LocalCliEntry,
  LocalCliModelCatalog,
  LocalCliModelOption,
  LocalCliScanResult
} from '../shared/local-cli';
import type { LocalCliAgent } from '../shared/types';

/**
 * One shared copy of the local CLI scan.
 *
 * Settings and the chat model picker must offer the same choices, and scanning
 * spawns real CLI processes, so the result is cached here at module scope and
 * every surface reads this store instead of scanning on its own.
 */
export type LocalCliModelsSnapshot = {
  version: number;
  scan: LocalCliScanResult | null;
  loading: boolean;
  error: string | null;
};

class LocalCliModelsStore {
  private state: LocalCliModelsSnapshot = {
    version: 0,
    scan: null,
    loading: false,
    error: null
  };
  private listeners = new Set<() => void>();
  private inflight: Promise<void> | null = null;
  /** The bridge the cached scan belongs to; a new bridge invalidates it. */
  private apiRef: unknown = null;
  /** Bumped to discard results from a superseded scan. */
  private generation = 0;

  getSnapshot = (): LocalCliModelsSnapshot => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(patch: Partial<LocalCliModelsSnapshot>): void {
    this.state = {
      ...this.state,
      ...patch,
      version: this.state.version + 1
    };
    for (const listener of this.listeners) listener();
  }

  get(agent: LocalCliAgent): LocalCliEntry | null {
    return this.state.scan?.entries.find((entry) => entry.agent === agent) ?? null;
  }

  catalog(agent: LocalCliAgent): LocalCliModelCatalog | null {
    return this.get(agent)?.modelCatalog ?? null;
  }

  /**
   * Loads the scan once; `force` rescans. Concurrent callers share one run so
   * a settings page and a chat picker never spawn two scans at the same time.
   */
  async load(force = false): Promise<void> {
    const api = typeof window !== 'undefined' ? window.studyCoach : undefined;
    if (!api || typeof api.scanLocalClis !== 'function') return;
    if (this.apiRef !== api) {
      // Tests and the browser prototype replace the bridge between renders;
      // a scan from the previous bridge never applies to the new one.
      this.apiRef = api;
      force = true;
      this.generation += 1;
      this.inflight = null;
      this.publish({ scan: null });
    }
    if (!force && this.state.scan) return;
    if (this.inflight && !force) return this.inflight;
    const generation = ++this.generation;
    this.publish({ loading: true, error: null });
    this.inflight = (async () => {
      try {
        const scan = await api.scanLocalClis();
        if (generation !== this.generation) return;
        this.publish({ scan, loading: false, error: null });
      } catch (cause) {
        if (generation !== this.generation) return;
        this.publish({
          loading: false,
          error: cause instanceof Error ? cause.message : '无法扫描本机 CLI'
        });
      } finally {
        // A superseded scan must not clear the newer run's handle.
        if (generation === this.generation) this.inflight = null;
      }
    })();
    return this.inflight;
  }

  /** Test/teardown seam; keeps subscribers attached. */
  reset(): void {
    this.generation += 1;
    this.apiRef = null;
    this.inflight = null;
    this.publish({ scan: null, loading: false, error: null });
  }
}

export const localCliModels = new LocalCliModelsStore();

export function useLocalCliModels(): LocalCliModelsSnapshot {
  return useSyncExternalStore(localCliModels.subscribe, localCliModels.getSnapshot);
}

/** Options in display order, default model first. */
export function catalogOptions(catalog: LocalCliModelCatalog | null): LocalCliModelOption[] {
  if (!catalog) return [];
  return catalog.options;
}

/**
 * The label for "inherit": the CLI's own default when the config reveals it,
 * otherwise a plain statement that ASAKI passes no model flag.
 */
export function inheritModelLabel(catalog: LocalCliModelCatalog | null): string {
  const model = catalog?.defaultModel;
  return model ? `继承 CLI 默认（${model}）` : '继承 CLI 默认';
}

export function optionLabel(option: LocalCliModelOption): string {
  return option.label ? `${option.id} · ${option.label}` : option.id;
}
