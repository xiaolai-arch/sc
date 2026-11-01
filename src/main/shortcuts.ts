/**
 * Minimal surface of Electron's `globalShortcut` so registration can be
 * exercised without a display server.
 */
export interface ShortcutRegistrar {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface ShortcutDefinition {
  accelerator: string;
  run: () => void;
}

export interface RegisteredShortcuts {
  registered: string[];
  failed: string[];
  /** Unregisters the accelerators this call registered; safe to call twice. */
  dispose(): void;
}

export function registerAppShortcuts(
  registrar: ShortcutRegistrar,
  shortcuts: readonly ShortcutDefinition[]
): RegisteredShortcuts {
  const registered: string[] = [];
  const failed: string[] = [];
  const seen = new Set<string>();

  for (const shortcut of shortcuts) {
    if (seen.has(shortcut.accelerator)) continue;
    seen.add(shortcut.accelerator);

    let ok = false;
    try {
      ok = registrar.register(shortcut.accelerator, shortcut.run);
    } catch {
      ok = false;
    }
    (ok ? registered : failed).push(shortcut.accelerator);
  }

  return {
    registered,
    failed,
    dispose() {
      const pending = registered.splice(0, registered.length);
      for (const accelerator of pending) {
        try {
          registrar.unregister(accelerator);
        } catch {
          // Quitting must not be blocked by a failed unregister.
        }
      }
    }
  };
}
