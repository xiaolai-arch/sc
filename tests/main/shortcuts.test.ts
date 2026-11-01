import {
  registerAppShortcuts,
  type ShortcutRegistrar
} from '../../src/main/shortcuts';

function fakeRegistrar(options: { fail?: Set<string>; throws?: Set<string> } = {}) {
  const registered: string[] = [];
  const unregistered: string[] = [];
  const callbacks = new Map<string, () => void>();
  const registrar: ShortcutRegistrar = {
    register(accelerator, callback) {
      if (options.throws?.has(accelerator)) throw new Error('register failed');
      if (options.fail?.has(accelerator)) return false;
      registered.push(accelerator);
      callbacks.set(accelerator, callback);
      return true;
    },
    unregister(accelerator) {
      unregistered.push(accelerator);
      callbacks.delete(accelerator);
    }
  };
  return { registrar, registered, unregistered, callbacks };
}

test('registers every shortcut and reports failures', () => {
  const { registrar, registered, callbacks } = fakeRegistrar({
    fail: new Set(['CommandOrControl+X'])
  });
  const captured: string[] = [];

  const result = registerAppShortcuts(registrar, [
    { accelerator: 'CommandOrControl+Shift+Space', run: () => captured.push('capture') },
    { accelerator: 'CommandOrControl+X', run: () => captured.push('x') }
  ]);

  expect(result.registered).toEqual(['CommandOrControl+Shift+Space']);
  expect(result.failed).toEqual(['CommandOrControl+X']);
  expect(registered).toEqual(['CommandOrControl+Shift+Space']);

  callbacks.get('CommandOrControl+Shift+Space')?.();
  expect(captured).toEqual(['capture']);
});

test('treats a throwing registrar as a failed shortcut', () => {
  const { registrar } = fakeRegistrar({ throws: new Set(['Bad+Accelerator']) });

  const result = registerAppShortcuts(registrar, [
    { accelerator: 'Bad+Accelerator', run: () => undefined }
  ]);

  expect(result.registered).toEqual([]);
  expect(result.failed).toEqual(['Bad+Accelerator']);
});

test('dispose unregisters only successful shortcuts and is idempotent', () => {
  const { registrar, unregistered } = fakeRegistrar({ fail: new Set(['B']) });

  const result = registerAppShortcuts(registrar, [
    { accelerator: 'A', run: () => undefined },
    { accelerator: 'B', run: () => undefined }
  ]);

  result.dispose();
  expect(unregistered).toEqual(['A']);

  result.dispose();
  expect(unregistered).toEqual(['A']);
});

test('does not register the same accelerator twice', () => {
  const { registrar, registered } = fakeRegistrar();

  const result = registerAppShortcuts(registrar, [
    { accelerator: 'A', run: () => undefined },
    { accelerator: 'A', run: () => undefined },
    { accelerator: 'B', run: () => undefined }
  ]);

  expect(registered).toEqual(['A', 'B']);
  expect(result.registered).toEqual(['A', 'B']);
});
