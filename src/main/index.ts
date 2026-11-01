import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { createAppContext, type AppContext } from './context';
import { registerIpcHandlers, serializeError } from './ipc';
import { createContextScheduler } from './scheduler';
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

/**
 * Tray "生成今日计划": ask the workspace planner for tasks in the first
 * workspace that has none yet, then persist them through the workspace
 * service. There is no global daily plan any more — the vault tasks are the
 * only source of truth.
 */
async function generateTrayPlan(context: AppContext): Promise<void> {
  for (const workspace of await context.api.listWorkspaces()) {
    const snapshot = await context.api.getWorkspaceSnapshot(workspace.id);
    if (snapshot.tasks.length > 0) continue;
    const plan = await context.api.planWorkspace({ workspaceId: workspace.id });
    for (const task of plan.tasks) {
      await context.api.createTask({
        workspaceId: workspace.id,
        title: task.title,
        subject: task.subject,
        durationMin: task.durationMin,
        acceptance: task.acceptance
      });
    }
    return;
  }
}

app.whenReady().then(async () => {
  const context = await createAppContext({
    userDataPath: app.getPath('userData'),
    defaultVaultPath: join(app.getPath('documents'), DEFAULT_VAULT_DIRECTORY)
  });
  registerIpcHandlers(context.api, ipcMain);
  createWindow();

  let scheduler: ReturnType<typeof createContextScheduler> | null = null;
  let trayController: { destroy(): void } | null = null;

  try {
    const notify = await createElectronNotificationSink();
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
        onGeneratePlan: () => {
          void generateTrayPlan(context).catch((error: unknown) => {
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
