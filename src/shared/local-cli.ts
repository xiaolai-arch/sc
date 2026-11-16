import type { LocalCliAgent } from './types';

/** Native capabilities reported by an installed CLI agent. */
export type LocalCliFeature =
  | 'streaming'
  | 'reasoning'
  | 'native-tools'
  | 'web'
  | 'sessions'
  | 'mcp'
  | 'skills'
  | 'models'
  | 'images'
  | 'sandbox';

export type LocalCliAuthStatus = 'ready' | 'missing' | 'unknown';

/** Where one model candidate came from. */
export type LocalCliModelOrigin = 'config' | 'catalog' | 'alias' | 'mapping' | 'cli';

/** One model the CLI (or its local config) already knows about. */
export interface LocalCliModelOption {
  /** Value passed to the CLI's model flag; shown as-is when there is no label. */
  id: string;
  /** Display name from the catalog, when one exists. */
  label?: string;
  origin: LocalCliModelOrigin;
  /** Config file or source description, e.g. `~/.codex/config.toml`. */
  source: string;
}

/**
 * Model choices discovered without writing to any CLI config. `defaultModel`
 * is what the CLI would use on its own, so "inherit" is never a guess.
 */
export interface LocalCliModelCatalog {
  defaultModel?: string;
  defaultEffort?: string;
  options: LocalCliModelOption[];
  /** Config files read successfully (display paths). */
  files: string[];
  /** Non-fatal parse problems; the CLI default stays available. */
  warnings: string[];
}

/** One locally installed (or missing) CLI agent. */
export interface LocalCliEntry {
  agent: LocalCliAgent;
  label: string;
  command: string;
  installed: boolean;
  path?: string;
  version?: string;
  auth: LocalCliAuthStatus;
  /** Human-readable login state; never contains a key or token. */
  authDetail?: string;
  features: LocalCliFeature[];
  /** Models advertised by the CLI, when it can list them without network access. */
  models?: string[];
  /** Models from the CLI's own local configuration, with their source. */
  modelCatalog?: LocalCliModelCatalog;
  error?: string;
  installHint?: string;
}

export interface LocalCliScanResult {
  /** Local ISO timestamp of the scan. */
  scannedAt: string;
  entries: LocalCliEntry[];
}
