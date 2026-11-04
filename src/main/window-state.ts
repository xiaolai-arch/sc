import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The part of the main window geometry worth restoring between launches.
 * `x`/`y` are only present when the window was last placed somewhere known.
 */
export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

/** A display's usable area, matching Electron's `screen.getAllDisplays()`. */
export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_WINDOW_WIDTH = 640;
export const MIN_WINDOW_HEIGHT = 480;

export const DEFAULT_WINDOW_STATE: WindowState = {
  width: 900,
  height: 680,
  maximized: false
};

// A window counts as reachable when at least this much of it sits on a
// display: enough to grab the title bar and drag it back.
const MIN_VISIBLE_WIDTH = 200;
const MIN_VISIBLE_HEIGHT = 120;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Turns whatever was on disk into a safe window state. Unusable input yields
 * `null` so the caller can fall back to the default placement.
 */
export function normalizeWindowState(value: unknown): WindowState | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!isFiniteNumber(record.width) || !isFiniteNumber(record.height)) return null;
  const state: WindowState = {
    width: Math.max(MIN_WINDOW_WIDTH, Math.round(record.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.round(record.height)),
    maximized: record.maximized === true
  };
  // A position is all-or-nothing: one missing coordinate would put the window
  // somewhere arbitrary on restore.
  if (isFiniteNumber(record.x) && isFiniteNumber(record.y)) {
    state.x = Math.round(record.x);
    state.y = Math.round(record.y);
  }
  return state;
}

/**
 * Whether enough of the window overlaps some display to still be usable.
 * A monitor that was unplugged since the last launch fails this check.
 */
export function isVisibleOnDisplays(
  state: WindowState,
  displays: DisplayBounds[]
): boolean {
  if (state.x === undefined || state.y === undefined) return true;
  for (const display of displays) {
    const overlapX =
      Math.min(state.x + state.width, display.x + display.width) -
      Math.max(state.x, display.x);
    const overlapY =
      Math.min(state.y + state.height, display.y + display.height) -
      Math.max(state.y, display.y);
    if (overlapX >= MIN_VISIBLE_WIDTH && overlapY >= MIN_VISIBLE_HEIGHT) {
      return true;
    }
  }
  return false;
}

/** Loads the persisted window state, falling back to the default placement. */
export async function readWindowState(
  filePath: string,
  displays: DisplayBounds[]
): Promise<WindowState> {
  const fallback = { ...DEFAULT_WINDOW_STATE };
  try {
    const raw = await readFile(filePath, 'utf8');
    const state = normalizeWindowState(JSON.parse(raw));
    if (state === null || !isVisibleOnDisplays(state, displays)) return fallback;
    return state;
  } catch {
    // A missing or corrupt file must never stop the window from opening.
    return fallback;
  }
}

// Every write gets its own temp file: a debounced save can still be in flight
// when the window closes and the synchronous writer runs.
let tempCounter = 0;

function nextTempPath(directory: string): string {
  tempCounter += 1;
  return join(directory, `.window-state-${process.pid}-${tempCounter}.tmp`);
}

/** Persists the window state atomically; failures are left to the caller. */
export async function writeWindowState(
  filePath: string,
  state: WindowState
): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = nextTempPath(directory);
  try {
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Synchronous variant used while the window closes: the process may exit
 * before an asynchronous write would finish.
 */
export function writeWindowStateSync(filePath: string, state: WindowState): void {
  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true });
  const tempPath = nextTempPath(directory);
  try {
    writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    renameSync(tempPath, filePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}
