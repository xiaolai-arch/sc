import { applyLaunchAtLogin, type LoginItemRegistrar } from '../../src/main/login-item';

function registrar(): { value: LoginItemRegistrar; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    value: {
      setLoginItemSettings: (settings) => {
        calls.push({ ...settings });
      }
    }
  };
}

test('applies the persisted preference on macOS', () => {
  const { value, calls } = registrar();
  applyLaunchAtLogin(value, true, { platform: 'darwin' });
  expect(calls).toEqual([{ openAtLogin: true }]);
});

test('turns the login item off again', () => {
  const { value, calls } = registrar();
  applyLaunchAtLogin(value, false, { platform: 'darwin' });
  expect(calls).toEqual([{ openAtLogin: false }]);
});

test('points the Windows login item at the current executable', () => {
  const { value, calls } = registrar();
  applyLaunchAtLogin(value, true, { platform: 'win32', execPath: 'C:\\ASAKI\\ASAKI.exe' });
  expect(calls).toEqual([
    { openAtLogin: true, path: 'C:\\ASAKI\\ASAKI.exe' }
  ]);
});

test('points the portable build at its launcher instead of the temp copy', () => {
  const { value, calls } = registrar();
  applyLaunchAtLogin(value, true, {
    platform: 'win32',
    execPath: 'C:\\Users\\me\\AppData\\Local\\Temp\\ASAKI\\ASAKI.exe',
    env: { PORTABLE_EXECUTABLE_FILE: 'D:\\Apps\\ASAKI-portable.exe' }
  });
  expect(calls).toEqual([
    { openAtLogin: true, path: 'D:\\Apps\\ASAKI-portable.exe' }
  ]);
});

test('ignores platforms without login items', () => {
  const { value, calls } = registrar();
  applyLaunchAtLogin(value, true, { platform: 'linux' });
  expect(calls).toEqual([]);
});

test('never lets an OS failure escape', () => {
  const failing: LoginItemRegistrar = {
    setLoginItemSettings: () => {
      throw new Error('denied');
    }
  };
  expect(() => applyLaunchAtLogin(failing, true, { platform: 'win32' })).not.toThrow();
});