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
  error?: string;
  installHint?: string;
}

export interface LocalCliScanResult {
  /** Local ISO timestamp of the scan. */
  scannedAt: string;
  entries: LocalCliEntry[];
}
