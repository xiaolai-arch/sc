import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  collectOverflows,
  decideRelayout,
  layoutScript,
  type SlideLayout,
  type SlideOverflow
} from './video-notes/deck/browser';

/**
 * Measures a rendered deck in a hidden `BrowserWindow` and exports it as a
 * PDF. The pipeline owns this through `DeckBrowserDeps` so unit tests can
 * inject a fake window; the real Electron `BrowserWindow` is only required
 * lazily inside the default factory, so importing this module from Vitest
 * never touches Electron's runtime.
 */

/** A4-landscape-free page size in inches: 13.333 x 7.5 is 1280 x 720 at 96dpi. */
export const DECK_PAGE_SIZE = { width: 13.333, height: 7.5 } as const;

/** Options for the measurement/print window: hidden, fixed stage size, no Node access. */
export interface DeckWindowOptions {
  show: false;
  width: number;
  height: number;
  webPreferences: {
    sandbox: true;
    contextIsolation: true;
    nodeIntegration: false;
  };
}

/** The options sent to `webContents.printToPDF`. */
export interface DeckPdfOptions {
  printBackground: boolean;
  pageSize: { width: number; height: number };
}

/**
 * The two load events this module needs. Electron calls `did-finish-load`
 * with just the event and `did-fail-load` with the code and description after
 * it; the listener only reads the last two arguments, which are `undefined`
 * for a successful load.
 */
export type DeckLoadListener = (
  event: unknown,
  errorCode?: number,
  errorDescription?: string
) => void;

/** The part of `webContents` a hidden deck window uses. */
export interface DeckWebContentsLike {
  executeJavaScript(code: string): Promise<unknown>;
  printToPDF(options: DeckPdfOptions): Promise<Buffer>;
  once(event: 'did-finish-load' | 'did-fail-load', listener: DeckLoadListener): void;
}

/** The part of `BrowserWindow` a hidden deck window uses. */
export interface BrowserWindowLike {
  loadFile(filePath: string): Promise<void>;
  readonly webContents: DeckWebContentsLike;
  isDestroyed(): boolean;
  destroy(): void;
}

/** Test seam for the Electron window and the temp document on disk. */
export interface DeckBrowserDeps {
  createWindow(options: DeckWindowOptions): BrowserWindowLike;
  writeTempFile(contents: string): Promise<string>;
  removeTempFile(path: string): Promise<void>;
}

/** The hidden window every measurement and print run uses. */
export const DECK_WINDOW_OPTIONS: DeckWindowOptions = {
  show: false,
  width: 1280,
  height: 720,
  webPreferences: {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false
  }
};

export interface DeckPdfResult {
  /** Page count measured in the print window before printing. */
  slides: number;
  /** Size of the written PDF file. */
  bytes: number;
}

export interface LayoutAndPrintOptions {
  html: string;
  pdfPath: string;
  /** Correction passes allowed; default 2, matching the design's two rounds. */
  maxRounds?: number;
  /**
   * Asks for a new HTML document after a measurement with overflows, with the
   * overflows and the zero-based pass number. Return `null` to stop correcting
   * and print the current HTML as-is.
   */
  onOverflow?: (overflows: SlideOverflow[], round: number) => Promise<string | null>;
  deps?: DeckBrowserDeps;
}

export interface LayoutAndPrintResult {
  /** Layout of the HTML that was printed last. */
  slides: SlideLayout[];
  /** Overflowing slides in that last layout; empty when everything fit. */
  overflows: SlideOverflow[];
  /** Correction passes actually run (0 when the first layout already fit). */
  rounds: number;
  /** Size of the written PDF file. */
  bytes: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The production window factory. `require` is lazy and cast through the
 * module type so Vitest, which imports this file in plain Node, never loads
 * Electron. Navigation and new windows are denied: this window exists only to
 * measure and print a local, self-contained document (design 4.4).
 */
function createElectronWindow(options: DeckWindowOptions): BrowserWindowLike {
  const electron = require('electron') as typeof import('electron');
  const BrowserWindow = electron.BrowserWindow as unknown as new (
    windowOptions: DeckWindowOptions
  ) => BrowserWindowLike & {
    webContents: DeckWebContentsLike & {
      setWindowOpenHandler(handler: () => { action: 'deny' }): void;
      on(event: 'will-navigate', listener: (event: { preventDefault(): void }) => void): void;
    };
  };
  const window = new BrowserWindow(options);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  return window;
}

/**
 * Each document gets its own `mkdtemp` directory (concurrent exports must not
 * collide), and removal drops that directory in one call.
 */
async function writeDeckTempFile(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'asaki-deck-'));
  const filePath = join(directory, 'deck.html');
  await writeFile(filePath, contents, 'utf8');
  return filePath;
}

async function removeDeckTempFile(filePath: string): Promise<void> {
  await rm(dirname(filePath), { recursive: true, force: true });
}

/** Production dependencies; only called when the caller passes no `deps`. */
function defaultDeckBrowserDeps(): DeckBrowserDeps {
  return {
    createWindow: createElectronWindow,
    writeTempFile: writeDeckTempFile,
    removeTempFile: removeDeckTempFile
  };
}

/** Resolves once the window finished its main-frame load, rejects on failure. */
function loadDeckWindow(window: BrowserWindowLike, filePath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const succeed = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };

    window.webContents.once('did-finish-load', () => succeed());
    window.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
      const reason = (errorDescription ?? '').trim();
      fail(`课件页面加载失败：${reason === '' ? '未知错误' : reason}（${errorCode ?? -1}）`);
    });
    // `loadFile` also rejects on its own; race it against the events above so
    // a missing file or a crashed renderer still rejects once.
    void Promise.resolve(window.loadFile(filePath)).catch((error: unknown) => {
      fail(`课件页面加载失败：${errorMessage(error)}`);
    });
  });
}

/**
 * Turns the `JSON.stringify` output of `layoutScript()` into slide layouts.
 * Anything else (a missing script, a malformed entry) is an error rather than
 * a silently empty report.
 */
function parseLayout(raw: unknown): SlideLayout[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error('课件版面测量返回的不是 JSON');
    }
  }
  if (value === null || typeof value !== 'object') {
    throw new Error('课件版面测量返回了意外的结果');
  }
  const slides = (value as { slides?: unknown }).slides;
  if (!Array.isArray(slides)) {
    throw new Error('课件版面测量结果里没有 slides 列表');
  }

  return slides
    .map((entry, position) => {
      if (entry === null || typeof entry !== 'object') {
        throw new Error(`课件版面测量结果第 ${position} 页格式不正确`);
      }
      const { index, bottom } = entry as { index?: unknown; bottom?: unknown };
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
        throw new Error(`课件版面测量结果第 ${position} 页的 index 无效`);
      }
      if (typeof bottom !== 'number' || !Number.isFinite(bottom) || bottom < 0) {
        throw new Error(`课件版面测量结果第 ${position} 页的 bottom 无效`);
      }
      return { index, bottom };
    })
    .sort((left, right) => left.index - right.index);
}

/**
 * Runs `run` against a loaded hidden window and always cleans up: the window
 * is destroyed and the temp document removed on success and on failure alike.
 */
async function withDeckWindow<T>(
  html: string,
  deps: DeckBrowserDeps,
  run: (window: BrowserWindowLike) => Promise<T>
): Promise<T> {
  const tempPath = await deps.writeTempFile(html);
  let window: BrowserWindowLike | null = null;
  try {
    window = deps.createWindow({
      ...DECK_WINDOW_OPTIONS,
      webPreferences: { ...DECK_WINDOW_OPTIONS.webPreferences }
    });
    await loadDeckWindow(window, tempPath);
    return await run(window);
  } finally {
    try {
      if (window !== null && !window.isDestroyed()) window.destroy();
    } finally {
      await deps.removeTempFile(tempPath);
    }
  }
}

/** Loads `html` in a hidden 1280x720 window and returns each slide's content bottom. */
export async function measureDeckHtml(
  html: string,
  deps: DeckBrowserDeps = defaultDeckBrowserDeps()
): Promise<SlideLayout[]> {
  return withDeckWindow(html, deps, async (window) => {
    const raw = await window.webContents.executeJavaScript(layoutScript());
    return parseLayout(raw);
  });
}

/**
 * Loads `html` in a hidden window, counts its slides and prints it to
 * `pdfPath` as 13.333 x 7.5 inch pages with backgrounds. Printing happens in
 * its own freshly loaded window, never one that was just measured.
 */
export async function exportDeckPdf(
  html: string,
  pdfPath: string,
  deps: DeckBrowserDeps = defaultDeckBrowserDeps()
): Promise<DeckPdfResult> {
  return withDeckWindow(html, deps, async (window) => {
    const slides = parseLayout(await window.webContents.executeJavaScript(layoutScript()));
    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: { width: DECK_PAGE_SIZE.width, height: DECK_PAGE_SIZE.height }
    });
    await writeFile(pdfPath, pdf);
    return { slides: slides.length, bytes: pdf.byteLength };
  });
}

/**
 * Measures, asks `onOverflow` for a correction (at most `maxRounds` passes),
 * then prints the last HTML regardless of whether the overflows were fixed —
 * a too-dense page is reported, not scaled down.
 */
export async function layoutAndPrint(
  options: LayoutAndPrintOptions
): Promise<LayoutAndPrintResult> {
  const deps = options.deps ?? defaultDeckBrowserDeps();
  const maxRounds = options.maxRounds ?? 2;
  let html = options.html;
  let round = 0;
  let slides = await measureDeckHtml(html, deps);
  let overflows = collectOverflows(slides);

  while (decideRelayout(overflows, round, maxRounds) === 'retry') {
    const next = options.onOverflow === undefined ? null : await options.onOverflow(overflows, round);
    if (next === null) break;
    round += 1;
    html = next;
    slides = await measureDeckHtml(html, deps);
    overflows = collectOverflows(slides);
  }

  const pdf = await exportDeckPdf(html, options.pdfPath, deps);
  return { slides, overflows, rounds: round, bytes: pdf.bytes };
}
