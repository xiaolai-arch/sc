import { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import { handleExportBackup, handleRestoreBackup } from './backup';
import { createAppContext } from './context';
import {
  APP_EVENT_CHANNELS,
  APP_IPC_CHANNELS,
  CONVERSATION_EVENT_CHANNELS,
  registerIpcHandlers,
  serializeError
} from './ipc';
import { applyLaunchAtLogin } from './login-item';
import { registerAppShortcuts } from './shortcuts';
import { createContextScheduler, planFirstEmptyWorkspace } from './scheduler';
import { DEFAULT_VAULT_DIRECTORY } from './settings/defaults';
import { createElectronNotificationSink, createElectronTray, isTaskForDay } from './tray';
import { formatLocalDate } from '../shared/date';
import {
  DEFAULT_WINDOW_STATE,
  readWindowState,
  writeWindowState,
  writeWindowStateSync,
  type WindowState
} from './window-state';

// Local development/e2e isolation hook. Normal launches keep a stable data
// folder across product renames so conversations, settings and credentials
// are not lost.
const userDataOverride = process.env['STUDY_COACH_USER_DATA_DIR']?.trim();
if (userDataOverride) {
  app.setPath('userData', userDataOverride);
} else {
  app.setPath('userData', join(app.getPath('appData'), 'study-coach'));
}

if (process.platform === 'win32') {
  // Keep notifications and the taskbar grouped under the same identity as the
  // Start Menu shortcut created by the NSIS installer (appId in
  // electron-builder.yml). Without this Windows may drop toast notifications.
  app.setAppUserModelId('com.studycoach.desktop');
}

let mainWindow: BrowserWindow | null = null;
// Restored once at startup; later windows (e.g. after the last one closes)
// start from the same placement instead of resetting to the default size.
let initialWindowState: WindowState = { ...DEFAULT_WINDOW_STATE };

function windowStateFile(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: initialWindowState.width,
    height: initialWindowState.height,
    ...(initialWindowState.x !== undefined && initialWindowState.y !== undefined
      ? { x: initialWindowState.x, y: initialWindowState.y }
      : {}),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  });
  if (initialWindowState.maximized) window.maximize();

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const snapshot = (): WindowState => {
    const bounds = window.getNormalBounds();
    return {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: window.isMaximized()
    };
  };
  const saveNow = () => {
    try {
      writeWindowStateSync(windowStateFile(), snapshot());
    } catch (error) {
      console.warn('ASAKI window state save failed:', serializeError(error).message);
    }
  };
  const scheduleSave = () => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      initialWindowState = snapshot();
      void writeWindowState(windowStateFile(), initialWindowState).catch((error: unknown) => {
        console.warn('ASAKI window state save failed:', serializeError(error).message);
      });
    }, 400);
  };
  window.on('resize', scheduleSave);
  window.on('move', scheduleSave);
  window.on('close', () => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (window.isDestroyed()) return;
    initialWindowState = snapshot();
    saveNow();
  });

  window.on('ready-to-show', () => {
    window.show();
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  const loading = rendererUrl
    ? window.loadURL(rendererUrl)
    : window.loadFile(join(__dirname, '../renderer/index.html'));
  void loading.catch((error: unknown) => {
    console.error('ASAKI renderer failed to load:', serializeError(error).message);
  });

  mainWindow = window;
  return window;
}

function showWindow(): void {
  if (mainWindow === null) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function openConversation(conversationId: string): void {
  showWindow();
  const send = () => {
    if (mainWindow === null) return;
    mainWindow.webContents.send(CONVERSATION_EVENT_CHANNELS.open, { conversationId });
  };
  if (mainWindow?.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(send, 300);
    });
  } else {
    send();
  }
}

function openQuickCapture(): void {
  showWindow();
  const send = () => {
    if (mainWindow === null) return;
    mainWindow.webContents.send(APP_EVENT_CHANNELS.quickCapture);
  };
  if (mainWindow?.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(send, 300);
    });
  } else {
    send();
  }
}

/** Opens a page the tray offers directly (review, settings). */
function openSection(target: 'review' | 'settings'): void {
  showWindow();
  const send = () => {
    if (mainWindow === null) return;
    mainWindow.webContents.send(APP_EVENT_CHANNELS.navigate, { target });
  };
  if (mainWindow?.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(send, 300);
    });
  } else {
    send();
  }
}

app.whenReady().then(async () => {
  const context = await createAppContext({
    userDataPath: app.getPath('userData'),
    defaultVaultPath: join(app.getPath('documents'), DEFAULT_VAULT_DIRECTORY),
    onSettingsUpdated: (next) => {
      applyLaunchAtLogin(app, next.launchAtLogin);
    }
  });
  // Re-apply the stored preference so a state file edited outside the app (or
  // an OS reset) converges on the next launch.
  applyLaunchAtLogin(app, (await context.settings.get()).launchAtLogin);
  registerIpcHandlers(context.api, ipcMain);
  initialWindowState = await readWindowState(
    windowStateFile(),
    screen.getAllDisplays().map((display) => display.workArea)
  );
  createWindow();

  ipcMain.handle(APP_IPC_CHANNELS.exportBackup, async () => {
    try {
      return await handleExportBackup({
        pickDirectory: async () => {
          const options = {
            title: '选择备份保存位置',
            properties: ['openDirectory', 'createDirectory'] as const
          };
          const selection = mainWindow
            ? await dialog.showOpenDialog(mainWindow, {
                ...options,
                properties: [...options.properties]
              })
            : await dialog.showOpenDialog({
                ...options,
                properties: [...options.properties]
              });
          return selection.canceled ? null : (selection.filePaths[0] ?? null);
        },
        getPaths: async () => {
          const current = await context.settings.get();
          return { vaultPath: current.vaultPath, userDataPath: app.getPath('userData') };
        }
      });
    } catch (error) {
      // Same sanitized envelope as the regular IPC handlers.
      throw new Error(serializeError(error).message);
    }
  });

  ipcMain.handle(APP_IPC_CHANNELS.restoreBackup, async () => {
    try {
      return await handleRestoreBackup({
        pickDirectory: async () => {
          const options = {
            title: '选择 ASAKI 备份文件夹',
            properties: ['openDirectory'] as const
          };
          const selection = mainWindow
            ? await dialog.showOpenDialog(mainWindow, {
                ...options,
                properties: [...options.properties]
              })
            : await dialog.showOpenDialog({
                ...options,
                properties: [...options.properties]
              });
          return selection.canceled ? null : (selection.filePaths[0] ?? null);
        },
        getPaths: async () => {
          const current = await context.settings.get();
          return { vaultPath: current.vaultPath, userDataPath: app.getPath('userData') };
        }
      });
    } catch (error) {
      throw new Error(serializeError(error).message);
    }
  });

  ipcMain.handle(APP_IPC_CHANNELS.restartApp, () => {
    app.relaunch();
    app.quit();
  });

  const shortcuts = registerAppShortcuts(globalShortcut, [
    { accelerator: 'CommandOrControl+Shift+Space', run: openQuickCapture }
  ]);
  for (const accelerator of shortcuts.failed) {
    console.warn(`ASAKI shortcut unavailable: ${accelerator}`);
  }
  app.on('will-quit', () => shortcuts.dispose());

  let scheduler: ReturnType<typeof createContextScheduler> | null = null;
  let trayController: { destroy(): void } | null = null;

  try {
    const notify = await createElectronNotificationSink((notification) => {
      if (notification.conversationId) {
        openConversation(notification.conversationId);
      } else {
        showWindow();
      }
    });
    scheduler = createContextScheduler({
      context,
      notify,
      onError: (error) => {
        console.error('ASAKI scheduler error:', serializeError(error).message);
      }
    });
    scheduler.start();

    const { controller } = await createElectronTray({
      getTasks: async () => {
        const workspaces = await context.api.listWorkspaces();
        const snapshots = await Promise.all(
          workspaces.map((workspace) => context.api.getWorkspaceSnapshot(workspace.id))
        );
        const today = formatLocalDate(new Date());
        return snapshots
          .flatMap((snapshot) => snapshot.tasks)
          .filter((task) => isTaskForDay(task, today));
      },
      getSettings: () => context.settings.get(),
      actions: {
        onOpen: showWindow,
        onQuickCapture: openQuickCapture,
        onGeneratePlan: () => {
          void planFirstEmptyWorkspace(context)
            .then((planned) => {
              if (planned) return;
              const date = formatLocalDate(new Date());
              notify({
                key: `tray-plan-${date}`,
                kind: 'morning-plan',
                date,
                scheduledTime: '',
                title: 'ASAKI',
                body: '每个项目都已有任务，没有生成新计划。可以在「今日安排」里调整。'
              });
            })
            .catch((error: unknown) => {
              console.error('ASAKI tray plan failed:', serializeError(error).message);
            });
        },
        onEveningReview: () => openSection('review'),
        onOpenSettings: () => openSection('settings'),
        onQuit: () => app.quit()
      }
    });
    trayController = controller;
    controller.start();
  } catch (error) {
    // Background services are optional; the window and IPC stay usable.
    console.error('ASAKI background services failed:', serializeError(error).message);
  }

  app.on('before-quit', () => {
    scheduler?.stop();
    trayController?.destroy();
    scheduler = null;
    trayController = null;
    // Stops the vault search watcher; the app is already quitting, so this is
    // fire-and-forget (the resources are released with the process anyway).
    void context.dispose().catch(() => undefined);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showWindow();
    }
  });
}).catch((error: unknown) => {
  // Only the sanitized message is logged; API keys never reach this path.
  console.error('ASAKI failed to start:', serializeError(error).message);
  app.quit();
});

app.on('window-all-closed', () => {
  // Keep the scheduler alive in the tray so proactive check-ins can arrive.
  // Quitting is explicit through the tray menu.
});
