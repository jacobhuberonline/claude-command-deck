import { app, BrowserWindow } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import { AuthService } from './auth/AuthService';
import { registerAppStateHandlers } from './ipc/appState';
import { broadcastAuthExit, broadcastAuthOutput, registerAuthHandlers } from './ipc/auth';
import { registerClaudeHandlers } from './ipc/claude';
import {
  broadcastTerminalExit,
  broadcastTerminalOutput,
  broadcastTerminalState,
  registerTerminalHandlers,
} from './ipc/terminal';
import { SafeLogger } from './logging/SafeLogger';
import { SettingsStore } from './persistence/SettingsStore';
import { ProcessManager } from './processes/ProcessManager';
import { createMainWindow } from './windows/mainWindow';

let processManager: ProcessManager | null = null;

function registerLifecycle(): void {
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    processManager?.stopAll();
  });
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  electronApp.setAppUserModelId('local.claude-command-deck');
  const logger = new SafeLogger();
  const settingsStore = new SettingsStore(logger);
  const authService = new AuthService(settingsStore, logger, {
    onOutput: (data) => broadcastAuthOutput({ data }),
    onExit: (exitCode, signal) => broadcastAuthExit({ exitCode, signal }),
  });
  processManager = new ProcessManager(logger, {
    onOutput: (sessionId, data) => broadcastTerminalOutput({ sessionId, data }),
    onExit: (sessionId, exitCode, signal, crashed) =>
      broadcastTerminalExit({
        sessionId,
        exitCode,
        signal,
        crashed,
      }),
    onState: (sessionId, snapshot) => broadcastTerminalState({ sessionId, snapshot }),
  });
  registerAppStateHandlers(app.getVersion(), settingsStore, logger);
  registerAuthHandlers(authService);
  registerClaudeHandlers();
  registerTerminalHandlers(processManager);
  registerLifecycle();

  createMainWindow();
}

void bootstrap();
