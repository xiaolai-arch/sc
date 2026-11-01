import { app, BrowserWindow, dialog, globalShortcut, ipcMain } from 'electron';
import { join } from 'node:path';
import { handleExportBackup } from './backup';
import { createAppContext } from './context';
import {
  APP_EVENT_CHANNELS,
  APP_IPC_CHANNELS,
  CONVERSATION_EVENT_CHANNELS,
  registerIpcHandlers,
  serializeError
} from './ipc';
import { registerAppShortcuts } from './shortcuts';
import { createContextScheduler, planFirstEmptyWorkspace } from './scheduler';
import { DEFAULT_VAULT_DIRECTORY } from './settings/defaults';
import { createElectronNotificationSink, createElectronTray } from './tray';

// Local development/e2e isolation hook. Normal launches leave this unset and
// keep Electron's platform default userData directory.
const userDataOverride = process.env['STUDY_COACH_USER_DATA_DIR']?.trim();
if (userDataOverride) {
  app.setPath('userData', userDataOverride);
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 900,
    height: 680,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
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
    console.error('Study Coach renderer failed to load:', serializeError(error).message);
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


app.whenReady().then(async () => {
  const context = await createAppContext({
    userDataPath: app.getPath('userData'),
    defaultVaultPath: join(app.getPath('documents'), DEFAULT_VAULT_DIRECTORY)
  });
  registerIpcHandlers(context.api, ipcMain);
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

  const shortcuts = registerAppShortcuts(globalShortcut, [
    { accelerator: 'CommandOrControl+Shift+Space', run: openQuickCapture }
  ]);
  for (const accelerator of shortcuts.failed) {
    console.warn(`Study Coach shortcut unavailable: ${accelerator}`);
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
        console.error('Study Coach scheduler error:', serializeError(error).message);
      }
    });
    scheduler.start();

    const { controller } = await createElectronTray({
      getTasks: async () => {
        const workspaces = await context.api.listWorkspaces();
        const snapshots = await Promise.all(
          workspaces.map((workspace) => context.api.getWorkspaceSnapshot(workspace.id))
        );
        return snapshots.flatMap((snapshot) => snapshot.tasks);
      },
      getSettings: () => context.settings.get(),
      actions: {
        onOpen: showWindow,
        onQuickCapture: openQuickCapture,
        onGeneratePlan: () => {
          void planFirstEmptyWorkspace(context).catch((error: unknown) => {
            console.error('Study Coach tray plan failed:', serializeError(error).message);
          });
        },
        onEveningReview: showWindow,
        onOpenSettings: showWindow,
        onQuit: () => app.quit()
      }
    });
    trayController = controller;
    controller.start();
  } catch (error) {
    // Background services are optional; the window and IPC stay usable.
    console.error('Study Coach background services failed:', serializeError(error).message);
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
  console.error('Study Coach failed to start:', serializeError(error).message);
  app.quit();
});

app.on('window-all-closed', () => {
  // Keep the scheduler alive in the tray so proactive check-ins can arrive.
  // Quitting is explicit through the tray menu.
});
