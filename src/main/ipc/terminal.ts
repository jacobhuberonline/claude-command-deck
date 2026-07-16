import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import type {
  CommandResult,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalStateEvent,
} from '../../shared/ipc/contracts';
import {
  startShellRequestSchema,
  startClaudeRequestSchema,
  terminalResizeRequestSchema,
  terminalStopRequestSchema,
  terminalWriteRequestSchema,
} from '../../shared/schemas/ipc';
import type { ProcessManager } from '../processes/ProcessManager';

export function registerTerminalHandlers(processManager: ProcessManager): void {
  ipcMain.handle(IPC_CHANNELS.terminalStartShell, (_event, rawPayload): CommandResult => {
    const payload = startShellRequestSchema.safeParse(rawPayload);
    return payload.success
      ? processManager.startShell(payload.data)
      : { ok: false, error: 'Invalid shell start request.' };
  });

  ipcMain.handle(IPC_CHANNELS.terminalStartClaude, (_event, rawPayload): CommandResult => {
    const payload = startClaudeRequestSchema.safeParse(rawPayload);
    return payload.success
      ? processManager.startClaude(payload.data)
      : { ok: false, error: 'Invalid Claude start request.' };
  });

  ipcMain.handle(IPC_CHANNELS.terminalWrite, (_event, rawPayload): CommandResult => {
    const payload = terminalWriteRequestSchema.safeParse(rawPayload);
    return payload.success
      ? processManager.write(payload.data.sessionId, payload.data.data)
      : { ok: false, error: 'Invalid terminal input request.' };
  });

  ipcMain.handle(IPC_CHANNELS.terminalResize, (_event, rawPayload): CommandResult => {
    const payload = terminalResizeRequestSchema.safeParse(rawPayload);
    return payload.success
      ? processManager.resize(payload.data.sessionId, payload.data.cols, payload.data.rows)
      : { ok: false, error: 'Invalid terminal resize request.' };
  });

  ipcMain.handle(IPC_CHANNELS.terminalStop, (_event, rawPayload): CommandResult => {
    const payload = terminalStopRequestSchema.safeParse(rawPayload);
    return payload.success
      ? processManager.stop(payload.data.sessionId)
      : { ok: false, error: 'Invalid terminal stop request.' };
  });

  ipcMain.handle(IPC_CHANNELS.terminalGetSnapshots, () => processManager.snapshots());
}

export function broadcastTerminalOutput(event: TerminalOutputEvent): void {
  broadcast(IPC_CHANNELS.terminalOutput, event);
}

export function broadcastTerminalExit(event: TerminalExitEvent): void {
  broadcast(IPC_CHANNELS.terminalExit, event);
}

export function broadcastTerminalState(event: TerminalStateEvent): void {
  broadcast(IPC_CHANNELS.terminalState, event);
}

function broadcast(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  });
}
