import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import type { AuthExitEvent, AuthOutputEvent, CommandResult } from '../../shared/ipc/contracts';
import { authResizeRequestSchema, authWriteRequestSchema } from '../../shared/schemas/ipc';
import type { AuthService } from '../auth/AuthService';

export function registerAuthHandlers(authService: AuthService): void {
  ipcMain.handle(IPC_CHANNELS.authCheck, () => authService.check());
  ipcMain.handle(IPC_CHANNELS.authStartRefresh, (): CommandResult => authService.startRefresh());
  ipcMain.handle(IPC_CHANNELS.authWrite, (_event, rawPayload): CommandResult => {
    const payload = authWriteRequestSchema.safeParse(rawPayload);
    return payload.success
      ? authService.write(payload.data)
      : { ok: false, error: 'Invalid authentication console input.' };
  });
  ipcMain.handle(IPC_CHANNELS.authResize, (_event, rawPayload): CommandResult => {
    const payload = authResizeRequestSchema.safeParse(rawPayload);
    return payload.success
      ? authService.resize(payload.data)
      : { ok: false, error: 'Invalid authentication console resize.' };
  });
  ipcMain.handle(IPC_CHANNELS.authStopRefresh, (): CommandResult => authService.stopRefresh());
}

export function broadcastAuthOutput(event: AuthOutputEvent): void {
  broadcast(IPC_CHANNELS.authOutput, event);
}

export function broadcastAuthExit(event: AuthExitEvent): void {
  broadcast(IPC_CHANNELS.authExit, event);
}

function broadcast(channel: string, payload: unknown): void {
  let windows: BrowserWindow[];
  try {
    windows = BrowserWindow.getAllWindows();
  } catch {
    return;
  }

  windows.forEach((window) => {
    try {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(channel, payload);
      }
    } catch {
      // A renderer can disappear between the lifecycle checks and send.
    }
  });
}
