import { existsSync } from 'node:fs';
import { dialog, ipcMain, shell } from 'electron';
import { createAppStateFromSettings } from '../../shared/domain/defaults';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import type { CommandResult, SelectDirectoryResult } from '../../shared/ipc/contracts';
import {
  openExternalDirectoryRequestSchema,
  selectDirectoryRequestSchema,
  updateAudioPreferencesRequestSchema,
  updateNotificationPreferencesRequestSchema,
  updateSessionAudioPreferencesRequestSchema,
} from '../../shared/schemas/ipc';
import type { SettingsStore } from '../persistence/SettingsStore';
import type { SafeLogger } from '../logging/SafeLogger';

export function registerAppStateHandlers(
  appVersion: string,
  settingsStore: SettingsStore,
  logger: SafeLogger,
): void {
  ipcMain.handle(IPC_CHANNELS.appGetState, () =>
    createAppStateFromSettings(appVersion, settingsStore.load()),
  );

  ipcMain.handle(
    IPC_CHANNELS.appOpenExternalDirectory,
    async (_event, rawPayload): Promise<CommandResult> => {
      const payload = openExternalDirectoryRequestSchema.safeParse(rawPayload);

      if (!payload.success) {
        return { ok: false, error: 'Invalid directory-open request.' };
      }

      const state = createAppStateFromSettings(appVersion, settingsStore.load());
      const session = state.sessions.find(
        (candidate) => candidate.configuration.id === payload.data.sessionId,
      );
      const directory = session?.configuration.workingDirectory.trim();

      if (!directory) {
        return { ok: false, error: 'This session bay has no working directory configured.' };
      }

      if (!existsSync(directory)) {
        return { ok: false, error: 'The configured working directory does not exist.' };
      }

      const errorMessage = await shell.openPath(directory);
      return errorMessage ? { ok: false, error: errorMessage } : { ok: true };
    },
  );

  ipcMain.handle(IPC_CHANNELS.appOpenLogDirectory, async (): Promise<CommandResult> => {
    const errorMessage = await shell.openPath(logger.getLogDirectory());
    return errorMessage ? { ok: false, error: errorMessage } : { ok: true };
  });

  ipcMain.handle(
    IPC_CHANNELS.appSelectDirectory,
    async (_event, rawPayload): Promise<SelectDirectoryResult> => {
      const payload = selectDirectoryRequestSchema.safeParse(rawPayload);
      if (!payload.success) {
        return { ok: false, error: 'Invalid directory selection request.' };
      }

      const result = await dialog.showOpenDialog({
        title: 'Select session working directory',
        properties: ['openDirectory', 'createDirectory'],
      });

      if (result.canceled || !result.filePaths[0]) {
        return { ok: false, error: 'Directory selection cancelled.', cancelled: true };
      }

      settingsStore.updateSessionDirectory(payload.data.sessionId, result.filePaths[0]);
      return { ok: true, directory: result.filePaths[0] };
    },
  );

  ipcMain.handle(IPC_CHANNELS.appUpdateAudioPreferences, (_event, rawPayload): CommandResult => {
    const payload = updateAudioPreferencesRequestSchema.safeParse(rawPayload);
    if (!payload.success) {
      return { ok: false, error: 'Invalid audio preferences.' };
    }

    settingsStore.updateAudioPreferences(payload.data.preferences);
    return { ok: true };
  });

  ipcMain.handle(
    IPC_CHANNELS.appUpdateNotificationPreferences,
    (_event, rawPayload): CommandResult => {
      const payload = updateNotificationPreferencesRequestSchema.safeParse(rawPayload);
      if (!payload.success) {
        return { ok: false, error: 'Invalid notification preferences.' };
      }

      settingsStore.updateNotificationPreferences(payload.data.preferences);
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.appUpdateSessionAudioPreferences,
    (_event, rawPayload): CommandResult => {
      const payload = updateSessionAudioPreferencesRequestSchema.safeParse(rawPayload);
      if (!payload.success) {
        return { ok: false, error: 'Invalid session audio preferences.' };
      }

      settingsStore.updateSessionAudioPreferences(payload.data.sessionId, payload.data.preferences);
      return { ok: true };
    },
  );
}
