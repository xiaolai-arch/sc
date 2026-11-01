export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'study-coach-theme';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

let stopSystemChanges: (() => void) | null = null;

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadThemePreference(storage?: StorageLike | null): ThemePreference {
  try {
    const value = resolveStorage(storage)?.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemePreference(
  preference: ThemePreference,
  storage?: StorageLike | null
): void {
  try {
    resolveStorage(storage)?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Private/quota-restricted storage must not block the in-memory choice.
  }
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';
  return prefersDark ? 'dark' : 'light';
}

export function applyTheme(resolved: ResolvedTheme, root?: HTMLElement | null): void {
  const target =
    root ?? (typeof document === 'undefined' ? null : document.documentElement);
  if (!target) return;
  target.classList.toggle('dark', resolved === 'dark');
  target.style.colorScheme = resolved;
}

function prefersDarkNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function stopSystemListener(): void {
  stopSystemChanges?.();
  stopSystemChanges = null;
}

function startSystemListener(): void {
  stopSystemListener();
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (event: { matches: boolean }) => {
    applyTheme(event.matches ? 'dark' : 'light');
  };
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange);
    stopSystemChanges = () => query.removeEventListener('change', onChange);
    return;
  }
  const legacy = query as MediaQueryList & {
    addListener?: (callback: (event: MediaQueryListEvent) => void) => void;
    removeListener?: (callback: (event: MediaQueryListEvent) => void) => void;
  };
  legacy.addListener?.(onChange);
  stopSystemChanges = () => legacy.removeListener?.(onChange);
}

/** Applies the stored preference and follows the OS while it is `system`. */
export function initTheme(): () => void {
  const preference = loadThemePreference();
  applyTheme(resolveTheme(preference, prefersDarkNow()));
  stopSystemListener();
  if (preference === 'system') startSystemListener();
  return () => stopSystemListener();
}

/** Saves the choice and applies it immediately; reconciles the OS listener. */
export function setThemePreference(preference: ThemePreference): void {
  saveThemePreference(preference);
  applyTheme(resolveTheme(preference, prefersDarkNow()));
  stopSystemListener();
  if (preference === 'system') startSystemListener();
}
