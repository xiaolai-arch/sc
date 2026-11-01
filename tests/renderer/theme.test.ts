// @vitest-environment jsdom
import {
  THEME_STORAGE_KEY,
  applyTheme,
  initTheme,
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
  setThemePreference
} from '../../src/renderer/theme';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: () => null,
    length: 0
  } as Storage;
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';
});

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia
  });
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

test('resolves explicit and system themes', () => {
  expect(resolveTheme('light', true)).toBe('light');
  expect(resolveTheme('dark', false)).toBe('dark');
  expect(resolveTheme('system', true)).toBe('dark');
  expect(resolveTheme('system', false)).toBe('light');
});

test('loads and saves the preference with a system fallback', () => {
  const storage = fakeStorage();
  expect(loadThemePreference(storage)).toBe('system');

  saveThemePreference('dark', storage);
  expect(loadThemePreference(storage)).toBe('dark');

  storage.setItem(THEME_STORAGE_KEY, 'sepia');
  expect(loadThemePreference(storage)).toBe('system');
});

test('applies the theme to a root element', () => {
  const root = document.createElement('div');

  applyTheme('dark', root);
  expect(root.classList.contains('dark')).toBe(true);
  expect(root.style.colorScheme).toBe('dark');

  applyTheme('light', root);
  expect(root.classList.contains('dark')).toBe(false);
  expect(root.style.colorScheme).toBe('light');
});

test('initTheme applies the stored preference without matchMedia', () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: undefined
  });
  saveThemePreference('dark');

  const cleanup = initTheme();
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe('dark');

  cleanup();
});

test('follows system changes while the preference is system', () => {
  const listeners: Array<(event: { matches: boolean }) => void> = [];
  let removed = false;
  const media = {
    matches: false,
    addEventListener: (_event: string, callback: (event: { matches: boolean }) => void) => {
      listeners.push(callback);
    },
    removeEventListener: () => {
      removed = true;
    }
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => media
  });
  saveThemePreference('system');

  const cleanup = initTheme();
  expect(document.documentElement.classList.contains('dark')).toBe(false);

  listeners[0]?.({ matches: true });
  expect(document.documentElement.classList.contains('dark')).toBe(true);

  listeners[0]?.({ matches: false });
  expect(document.documentElement.classList.contains('dark')).toBe(false);

  cleanup();
  expect(removed).toBe(true);
});

test('setThemePreference persists and applies immediately', () => {
  setThemePreference('dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

  setThemePreference('light');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
});
