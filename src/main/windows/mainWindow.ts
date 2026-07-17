import { join } from 'node:path';
import { BrowserWindow, screen, shell } from 'electron';
import { is } from '@electron-toolkit/utils';
import { defaultWindowBounds } from './WindowState';
import { WindowStateStore } from './WindowStateStore';

export function createMainWindow(): BrowserWindow {
  const windowStateStore = new WindowStateStore();
  const windowState = windowStateStore.load(screen.getAllDisplays());
  const restoredBounds = windowState.bounds ?? defaultWindowBounds;
  const mainWindow = new BrowserWindow({
    x: restoredBounds.x,
    y: restoredBounds.y,
    width: restoredBounds.width,
    height: restoredBounds.height,
    minWidth: 1040,
    minHeight: 720,
    title: 'Claude Command Deck',
    backgroundColor: '#07090c',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (windowState.isFullScreen) {
      mainWindow.setFullScreen(true);
    } else if (windowState.isMaximized) {
      mainWindow.maximize();
    }

    if (windowState.isMinimized) {
      mainWindow.minimize();
    }
  });

  registerWindowStatePersistence(mainWindow, windowStateStore);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}

function registerWindowStatePersistence(
  window: BrowserWindow,
  windowStateStore: WindowStateStore,
): void {
  let saveTimer: NodeJS.Timeout | null = null;

  const saveSoon = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    saveTimer = setTimeout(() => {
      saveTimer = null;
      windowStateStore.save(window);
    }, 250);
  };

  window.on('resize', saveSoon);
  window.on('move', saveSoon);
  window.on('maximize', saveSoon);
  window.on('unmaximize', saveSoon);
  window.on('minimize', saveSoon);
  window.on('restore', saveSoon);
  window.on('enter-full-screen', saveSoon);
  window.on('leave-full-screen', saveSoon);
  window.on('close', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    windowStateStore.save(window);
  });
}
