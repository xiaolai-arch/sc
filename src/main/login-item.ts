/**
 * Minimal surface of Electron's login-item API so the setting can be applied
 * (and tested) without importing Electron in Node-based tests.
 */
export interface LoginItemRegistrar {
  setLoginItemSettings(settings: {
    openAtLogin: boolean;
    /** Windows needs the executable that should run at login. */
    path?: string;
  }): void;
}

export interface ApplyLaunchAtLoginOptions {
  /** Defaults to `process.platform`; injected by tests. */
  platform?: NodeJS.Platform;
  /** Defaults to `process.execPath`; injected by tests. */
  execPath?: string;
  /** Defaults to `process.env`; injected by tests. */
  env?: NodeJS.ProcessEnv;
}

/**
 * electron-builder's portable target runs from a temporary extraction directory.
 * A login item pointing at that copy would break after the app exits, so the
 * portable launcher's own path wins when it is set.
 */
function windowsExecutable(
  execPath: string,
  env: NodeJS.ProcessEnv
): string {
  const portable = env['PORTABLE_EXECUTABLE_FILE'];
  return typeof portable === 'string' && portable.trim().length > 0
    ? portable.trim()
    : execPath;
}

/**
 * Applies the persisted "开机自启" setting to the operating system. The call
 * is best-effort: a failure here must not fail saving settings or startup.
 * macOS and Windows support login items; other platforms ignore the setting.
 */
export function applyLaunchAtLogin(
  registrar: LoginItemRegistrar,
  openAtLogin: boolean,
  options: ApplyLaunchAtLoginOptions = {}
): void {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'win32') return;

  try {
    registrar.setLoginItemSettings({
      openAtLogin,
      // On Windows the login item is a registry Run entry pointing at the exe.
      ...(platform === 'win32'
        ? {
            path: windowsExecutable(
              options.execPath ?? process.execPath,
              options.env ?? process.env
            )
          }
        : {})
    });
  } catch {
    // Settings stay saved even when the OS refuses the login item.
  }
}