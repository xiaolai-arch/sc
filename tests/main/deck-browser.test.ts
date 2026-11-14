import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Mock } from 'vitest';

import {
  DECK_PAGE_SIZE,
  exportDeckPdf,
  layoutAndPrint,
  measureDeckHtml,
  type BrowserWindowLike,
  type DeckBrowserDeps,
  type DeckLoadListener,
  type DeckPdfOptions,
  type DeckWebContentsLike,
  type DeckWindowOptions
} from '../../src/main/deck-browser';
import { layoutScript, type SlideOverflow } from '../../src/main/video-notes/deck/browser';

// Guards the lazy-require contract: importing the module under test (or any
// static import it grows later) must not pull in Electron's runtime.
vi.mock('electron', () => {
  throw new Error('deck-browser must not load Electron under vitest');
});

interface FakeWindow extends BrowserWindowLike {
  options: DeckWindowOptions;
  destroyed: boolean;
  loadFile: Mock<(filePath: string) => Promise<void>>;
  executeJavaScript: Mock<(code: string) => Promise<unknown>>;
  printToPDF: Mock<(options: DeckPdfOptions) => Promise<Buffer>>;
  destroy: Mock<() => void>;
}

interface FakeDeckOptions {
  /** Result of the `n`-th `executeJavaScript` call; default is one slide at 400px. */
  layoutResults?: (call: number) => unknown;
  /** Make `executeJavaScript` reject with this error. */
  executeError?: Error;
  /** Custom PDF bytes. */
  printToPDF?: () => Promise<Buffer>;
  /** Fire `did-fail-load` instead of `did-finish-load`. */
  failLoad?: boolean;
}

interface FakeDeckEnv {
  deps: DeckBrowserDeps;
  windows: FakeWindow[];
  /** Every temp document written, in order. */
  writes: string[];
  /** Temp paths not yet removed. */
  pendingTempFiles: Map<string, string>;
  removedTempFiles: string[];
}

const DEFAULT_PDF = Buffer.from('%PDF-1.4 fake deck');

function createFakeDeck(options: FakeDeckOptions = {}): FakeDeckEnv {
  const windows: FakeWindow[] = [];
  const writes: string[] = [];
  const pendingTempFiles = new Map<string, string>();
  const removedTempFiles: string[] = [];
  let executeCalls = 0;

  const deps: DeckBrowserDeps = {
    createWindow(windowOptions) {
      const finishListeners: DeckLoadListener[] = [];
      const failListeners: DeckLoadListener[] = [];
      let destroyed = false;

      const executeJavaScript = vi.fn(async (_code: string): Promise<unknown> => {
        executeCalls += 1;
        if (options.executeError !== undefined) throw options.executeError;
        return (
          options.layoutResults?.(executeCalls - 1) ?? { slides: [{ index: 0, bottom: 400 }] }
        );
      });
      const printToPDF = vi.fn(async (_options: DeckPdfOptions): Promise<Buffer> =>
        options.printToPDF === undefined ? DEFAULT_PDF : options.printToPDF()
      );
      const webContents: DeckWebContentsLike = {
        executeJavaScript,
        printToPDF,
        once(event, listener) {
          if (event === 'did-finish-load') finishListeners.push(listener);
          else failListeners.push(listener);
        }
      };
      const loadFile = vi.fn(async (_filePath: string): Promise<void> => {
        // Resolve on the next microtask so the window's listeners are
        // registered before the fake says the document loaded.
        queueMicrotask(() => {
          if (options.failLoad === true) {
            for (const listener of failListeners) {
              listener({}, -105, 'ERR_CONNECTION_RESET');
            }
            return;
          }
          for (const listener of finishListeners) listener({});
        });
      });

      const fake: FakeWindow = {
        options: windowOptions,
        get destroyed() {
          return destroyed;
        },
        webContents,
        loadFile,
        executeJavaScript,
        printToPDF,
        isDestroyed: () => destroyed,
        destroy: vi.fn(() => {
          destroyed = true;
        })
      };
      windows.push(fake);
      return fake;
    },
    async writeTempFile(contents) {
      const filePath = join('C:\\temp', `deck-${writes.length}.html`);
      writes.push(contents);
      pendingTempFiles.set(filePath, contents);
      return filePath;
    },
    async removeTempFile(filePath) {
      removedTempFiles.push(filePath);
      pendingTempFiles.delete(filePath);
    }
  };

  return { deps, windows, writes, pendingTempFiles, removedTempFiles };
}

const overflowLayout = { slides: [{ index: 0, bottom: 420 }, { index: 1, bottom: 700 }] };
const fixedLayout = { slides: [{ index: 0, bottom: 420 }, { index: 1, bottom: 600 }] };

let tempDir: string;
let pdfCounter = 0;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'deck-browser-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function pdfPath(): string {
  pdfCounter += 1;
  return join(tempDir, `slides-${pdfCounter}.pdf`);
}

describe('measureDeckHtml', () => {
  it('loads the document in a hidden sandboxed window and returns the slides', async () => {
    const env = createFakeDeck({
      layoutResults: () => ({ slides: [{ index: 0, bottom: 412.5 }, { index: 1, bottom: 700 }] })
    });

    const slides = await measureDeckHtml('<html>deck</html>', env.deps);

    expect(slides).toEqual([
      { index: 0, bottom: 412.5 },
      { index: 1, bottom: 700 }
    ]);
    expect(env.windows).toHaveLength(1);
    const window = env.windows[0]!;
    expect(window.options).toMatchObject({
      show: false,
      width: 1280,
      height: 720,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    expect('preload' in window.options.webPreferences).toBe(false);
    expect(env.writes).toEqual(['<html>deck</html>']);
    expect(window.loadFile).toHaveBeenCalledTimes(1);
    expect(window.executeJavaScript).toHaveBeenCalledWith(layoutScript());
    expect(window.loadFile.mock.invocationCallOrder[0]).toBeLessThan(
      window.executeJavaScript.mock.invocationCallOrder[0]!
    );
  });

  it('destroys the window and deletes the temp file after a successful measurement', async () => {
    const env = createFakeDeck();

    const slides = await measureDeckHtml('<html>deck</html>', env.deps);

    expect(slides).toHaveLength(1);
    expect(env.windows[0]!.destroyed).toBe(true);
    expect(env.windows[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(env.pendingTempFiles.size).toBe(0);
    expect(env.removedTempFiles).toHaveLength(1);
  });

  it('rejects with a readable error when the document fails to load', async () => {
    const env = createFakeDeck({ failLoad: true });

    await expect(measureDeckHtml('<html>deck</html>', env.deps)).rejects.toThrow(
      /课件页面加载失败.*ERR_CONNECTION_RESET/
    );
    expect(env.windows[0]!.executeJavaScript).not.toHaveBeenCalled();
    expect(env.windows[0]!.destroyed).toBe(true);
    expect(env.pendingTempFiles.size).toBe(0);
  });

  it('destroys the window and deletes the temp file when executeJavaScript rejects', async () => {
    const env = createFakeDeck({ executeError: new Error('renderer exploded') });

    await expect(measureDeckHtml('<html>deck</html>', env.deps)).rejects.toThrow(
      'renderer exploded'
    );
    expect(env.windows[0]!.destroyed).toBe(true);
    expect(env.windows[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(env.pendingTempFiles.size).toBe(0);
    expect(env.removedTempFiles).toHaveLength(1);
  });

  it('rejects a malformed layout instead of reporting empty slides', async () => {
    const env = createFakeDeck({ layoutResults: () => ({ slides: [{ index: 0 }] }) });

    await expect(measureDeckHtml('<html>deck</html>', env.deps)).rejects.toThrow(/bottom/);
    expect(env.windows[0]!.destroyed).toBe(true);
    expect(env.pendingTempFiles.size).toBe(0);
  });
});

describe('exportDeckPdf', () => {
  it('prints with backgrounds at 13.333 x 7.5 inches and writes the bytes', async () => {
    const pdf = Buffer.from('%PDF-1.7 real-ish bytes');
    const env = createFakeDeck({
      printToPDF: async () => pdf,
      layoutResults: () => ({ slides: [{ index: 0, bottom: 400 }, { index: 1, bottom: 410 }] })
    });
    const target = pdfPath();

    const result = await exportDeckPdf('<html>deck</html>', target, env.deps);

    expect(result).toEqual({ slides: 2, bytes: pdf.byteLength });
    expect(readFileSync(target)).toEqual(pdf);

    const window = env.windows[0]!;
    expect(window.printToPDF).toHaveBeenCalledWith({
      printBackground: true,
      pageSize: { width: 13.333, height: 7.5 }
    });
    expect(DECK_PAGE_SIZE).toEqual({ width: 13.333, height: 7.5 });
    expect(window.options.webPreferences).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    });
    expect(window.destroyed).toBe(true);
    expect(env.pendingTempFiles.size).toBe(0);
  });
});

describe('layoutAndPrint', () => {
  it('prints the first layout when nothing overflows', async () => {
    const env = createFakeDeck({ layoutResults: () => fixedLayout });
    const onOverflow = vi.fn(async () => null);
    const target = pdfPath();

    const result = await layoutAndPrint({
      html: '<html>1</html>',
      pdfPath: target,
      onOverflow,
      deps: env.deps
    });

    expect(result.rounds).toBe(0);
    expect(result.overflows).toEqual([]);
    expect(result.slides).toEqual(fixedLayout.slides);
    expect(onOverflow).not.toHaveBeenCalled();
    expect(env.windows).toHaveLength(2); // measure, then print
    expect(existsSync(target)).toBe(true);
    expect(env.writes).toEqual(['<html>1</html>', '<html>1</html>']);
  });

  it('re-measures the corrected HTML and prints that version', async () => {
    const env = createFakeDeck({
      layoutResults: (call) => (call === 0 ? overflowLayout : fixedLayout)
    });
    const onOverflow = vi.fn(async (_overflows: SlideOverflow[], round: number) => {
      expect(round).toBe(0);
      return '<html>2</html>';
    });

    const result = await layoutAndPrint({
      html: '<html>1</html>',
      pdfPath: pdfPath(),
      onOverflow,
      deps: env.deps
    });

    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(onOverflow.mock.calls[0]![0]).toEqual([
      { index: 1, bottom: 700, excessPx: 44 }
    ]);
    expect(result.rounds).toBe(1);
    expect(result.overflows).toEqual([]);
    expect(result.slides).toEqual(fixedLayout.slides);
    expect(env.windows).toHaveLength(3); // measure, re-measure, print
    expect(env.writes).toEqual(['<html>1</html>', '<html>2</html>', '<html>2</html>']);
  });

  it('stops at the default two correction passes and prints the last HTML', async () => {
    const env = createFakeDeck({ layoutResults: () => overflowLayout });
    const onOverflow = vi.fn(async (_overflows: SlideOverflow[], round: number) => {
      return `<html>pass${round}</html>`;
    });

    const result = await layoutAndPrint({
      html: '<html>1</html>',
      pdfPath: pdfPath(),
      onOverflow,
      deps: env.deps
    });

    expect(onOverflow).toHaveBeenCalledTimes(2);
    expect(onOverflow.mock.calls.map((call) => call[1])).toEqual([0, 1]);
    expect(result.rounds).toBe(2);
    expect(result.overflows).toEqual([{ index: 1, bottom: 700, excessPx: 44 }]);
    expect(env.windows).toHaveLength(4); // three measurements plus the print
    expect(env.writes).toEqual([
      '<html>1</html>',
      '<html>pass0</html>',
      '<html>pass1</html>',
      '<html>pass1</html>'
    ]);
  });

  it('honours a custom maxRounds', async () => {
    const env = createFakeDeck({ layoutResults: () => overflowLayout });
    const onOverflow = vi.fn(async () => '<html>2</html>');

    const result = await layoutAndPrint({
      html: '<html>1</html>',
      pdfPath: pdfPath(),
      maxRounds: 1,
      onOverflow,
      deps: env.deps
    });

    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(result.rounds).toBe(1);
    expect(result.overflows).toHaveLength(1);
  });

  it('prints the current HTML when the callback returns null', async () => {
    const env = createFakeDeck({ layoutResults: () => overflowLayout });
    const target = pdfPath();

    const result = await layoutAndPrint({
      html: '<html>1</html>',
      pdfPath: target,
      onOverflow: async () => null,
      deps: env.deps
    });

    expect(result.rounds).toBe(0);
    expect(result.overflows).toHaveLength(1);
    expect(env.windows).toHaveLength(2);
    expect(env.writes).toEqual(['<html>1</html>', '<html>1</html>']);
    expect(existsSync(target)).toBe(true);
  });

  it('prints the current HTML when no callback is given', async () => {
    const env = createFakeDeck({ layoutResults: () => overflowLayout });

    const result = await layoutAndPrint({
      html: '<html>1</html>',
      pdfPath: pdfPath(),
      deps: env.deps
    });

    expect(result.rounds).toBe(0);
    expect(env.windows).toHaveLength(2);
  });

  it('cleans up and writes no PDF when the callback throws', async () => {
    const env = createFakeDeck({ layoutResults: () => overflowLayout });
    const target = pdfPath();

    await expect(
      layoutAndPrint({
        html: '<html>1</html>',
        pdfPath: target,
        onOverflow: async () => {
          throw new Error('compose failed');
        },
        deps: env.deps
      })
    ).rejects.toThrow('compose failed');

    expect(env.windows).toHaveLength(1);
    expect(env.windows[0]!.destroyed).toBe(true);
    expect(env.pendingTempFiles.size).toBe(0);
    expect(existsSync(target)).toBe(false);
  });
});

describe('module loading', () => {
  it('imports without ever touching Electron', async () => {
    vi.resetModules();
    await expect(import('../../src/main/deck-browser')).resolves.toBeDefined();
  });
});
