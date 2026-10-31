import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { createAppContext } from './context';
import { registerIpcHandlers, serializeError } from './ipc';
import { DEFAULT_VAULT_DIRECTORY } from './settings/defaults';

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  const context = await createAppContext({
    userDataPath: app.getPath('userData'),
    defaultVaultPath: join(app.getPath('documents'), DEFAULT_VAULT_DIRECTORY)
  });
  registerIpcHandlers(context.api, ipcMain);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
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
