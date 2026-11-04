import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_WINDOW_STATE,
  isVisibleOnDisplays,
  normalizeWindowState,
  readWindowState,
  writeWindowState,
  writeWindowStateSync
} from '../../src/main/window-state';

const display = { x: 0, y: 0, width: 1440, height: 900 };

test('normalizes saved bounds and drops unusable values', () => {
  expect(
    normalizeWindowState({ width: 1200, height: 800, x: 20, y: 40, maximized: true })
  ).toEqual({ width: 1200, height: 800, x: 20, y: 40, maximized: true });

  expect(normalizeWindowState({ width: 1200, height: 800 })).toEqual({
    width: 1200,
    height: 800,
    maximized: false
  });
  expect(normalizeWindowState(null)).toBeNull();
  expect(normalizeWindowState({ width: 'wide', height: 800 })).toBeNull();
  expect(normalizeWindowState({ width: 1200, height: 800, x: 'left' })).toEqual({
    width: 1200,
    height: 800,
    maximized: false
  });
});

test('keeps the window at a usable size when the saved size is too small', () => {
  expect(normalizeWindowState({ width: 100, height: 80 })).toEqual({
    width: 640,
    height: 480,
    maximized: false
  });
});

test('treats a window as visible when enough of it sits on a display', () => {
  expect(isVisibleOnDisplays({ width: 900, height: 680, maximized: false }, [display])).toBe(true);
  expect(
    isVisibleOnDisplays({ width: 900, height: 680, x: 100, y: 100, maximized: false }, [display])
  ).toBe(true);
  // Mostly off-screen to the right: only a sliver remains.
  expect(
    isVisibleOnDisplays({ width: 900, height: 680, x: 1400, y: 100, maximized: false }, [display])
  ).toBe(false);
  // A monitor that was unplugged.
  expect(
    isVisibleOnDisplays({ width: 900, height: 680, x: -2000, y: 100, maximized: false }, [display])
  ).toBe(false);
});

test('returns defaults when the file is missing, corrupt or off-screen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-window-state-'));
  try {
    const file = join(dir, 'window-state.json');
    expect(await readWindowState(file, [display])).toEqual(DEFAULT_WINDOW_STATE);

    await writeFile(file, 'not json', 'utf8');
    expect(await readWindowState(file, [display])).toEqual(DEFAULT_WINDOW_STATE);

    await writeFile(
      file,
      JSON.stringify({ width: 900, height: 680, x: -3000, y: 0 }),
      'utf8'
    );
    expect(await readWindowState(file, [display])).toEqual(DEFAULT_WINDOW_STATE);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('round-trips bounds through the state file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-window-state-'));
  try {
    const file = join(dir, 'nested', 'window-state.json');
    await writeWindowState(file, {
      width: 1180,
      height: 760,
      x: 40,
      y: 60,
      maximized: true
    });

    expect(await readWindowState(file, [display])).toEqual({
      width: 1180,
      height: 760,
      maximized: true,
      x: 40,
      y: 60
    });
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ width: 1180 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writes synchronously so a quit cannot lose the last bounds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-window-state-'));
  try {
    const file = join(dir, 'window-state.json');
    writeWindowStateSync(file, { width: 920, height: 700, x: 12, y: 24, maximized: false });

    expect(await readWindowState(file, [display])).toEqual({
      width: 920,
      height: 700,
      maximized: false,
      x: 12,
      y: 24
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
