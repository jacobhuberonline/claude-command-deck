import { existsSync } from 'node:fs';
import { dialog, ipcMain, shell } from 'electron';
import { createAppStateFromSettings } from '../../shared/domain/defaults';
import { MAX_SESSION_COUNT } from '../../shared/domain/types';
import type {
  MonthlyUsageResult,
  UsageAuthSnapshot,
  UsageSignInResult,
} from '../../shared/domain/types';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import type {
  AddSessionResult,
  CommandResult,
  SelectDirectoryResult,
} from '../../shared/ipc/contracts';
import {
  openExternalDirectoryRequestSchema,
  openExternalUrlRequestSchema,
  removeSessionRequestSchema,
  selectDirectoryRequestSchema,
  updateAuthConfigurationRequestSchema,
  updateAudioPreferencesRequestSchema,
  updateClaudeConfigurationRequestSchema,
  updateDeckPreferencesRequestSchema,
  updateNotificationPreferencesRequestSchema,
  updateShellConfigurationRequestSchema,
  updateSessionConfigurationRequestSchema,
  updateSessionAudioPreferencesRequestSchema,
  updateSessionOrderRequestSchema,
} from '../../shared/schemas/ipc';
import type { SettingsStore } from '../persistence/SettingsStore';
import type { SafeLogger } from '../logging/SafeLogger';
import type { ProcessManager } from '../processes/ProcessManager';
import type { UsageService } from '../usage/UsageService';
import type { EntraAuthService } from '../usage/EntraAuthService';
import { isSafeExternalUrl } from '../windows/NavigationPolicy';

export function registerAppStateHandlers(
  appVersion: string,
  settingsStore: SettingsStore,
  logger: SafeLogger,
  processManager: ProcessManager,
  usageService: UsageService,
  usageAuthService: EntraAuthService,
): void {
  ipcMain.handle(IPC_CHANNELS.appGetState, () =>
    createAppStateFromSettings(appVersion, settingsStore.load()),
  );

  ipcMain.handle(IPC_CHANNELS.appAddSession, async (): Promise<AddSessionResult> => {
    if (settingsStore.load().sessions.length >= MAX_SESSION_COUNT) {
      return {
        ok: false,
        error: `The deck supports up to ${MAX_SESSION_COUNT} sessions.`,
      };
    }

    const result = await dialog.showOpenDialog({
      title: 'Add a Claude session directory',
      buttonLabel: 'Add Session',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, error: 'Session creation cancelled.', cancelled: true };
    }

    const configuration = settingsStore.addSession(result.filePaths[0]);
    return configuration
      ? { ok: true, configuration }
      : { ok: false, error: `The deck supports up to ${MAX_SESSION_COUNT} sessions.` };
  });

  ipcMain.handle(IPC_CHANNELS.appRemoveSession, (_event, rawPayload): CommandResult => {
    const payload = removeSessionRequestSchema.safeParse(rawPayload);
    if (!payload.success) {
      return { ok: false, error: 'Invalid session removal request.' };
    }

    if (processManager.hasActiveProcess(payload.data.sessionId)) {
      return { ok: false, error: 'Stop the attached process before removing this session.' };
    }

    return settingsStore.removeSession(payload.data.sessionId)
      ? { ok: true }
      : { ok: false, error: 'The last session cannot be removed.' };
  });

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

  ipcMain.handle(
    IPC_CHANNELS.appOpenExternalUrl,
    async (_event, rawPayload): Promise<CommandResult> => {
      const payload = openExternalUrlRequestSchema.safeParse(rawPayload);
      if (!payload.success) {
        return { ok: false, error: 'Invalid external URL request.' };
      }

      if (!isSafeExternalUrl(payload.data.url)) {
        return { ok: false, error: 'Only http and https links can be opened.' };
      }

      await shell.openExternal(payload.data.url);
      return { ok: true };
    },
  );

  ipcMain.handle(IPC_CHANNELS.appOpenLogDirectory, async (): Promise<CommandResult> => {
    const errorMessage = await shell.openPath(logger.getLogDirectory());
    return errorMessage ? { ok: false, error: errorMessage } : { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.appGetUsage, (): Promise<MonthlyUsageResult> =>
    usageService.getMonthlyUsage(),
  );

  ipcMain.handle(IPC_CHANNELS.appGetUsageAuth, (): UsageAuthSnapshot => {
    const account = usageAuthService.getAccount();
    return { signedIn: usageAuthService.isSignedIn(), email: account?.email || null };
  });

  ipcMain.handle(IPC_CHANNELS.appSignInUsage, async (): Promise<UsageSignInResult> => {
    try {
      const account = await usageAuthService.signIn();
      return { ok: true, email: account.email || null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Microsoft sign-in failed.';
      const cancelled = message.includes('closed before completing');
      logger.warn('Usage sign-in failed', { cancelled, detail: message });
      return { ok: false, error: message, cancelled };
    }
  });

  ipcMain.handle(IPC_CHANNELS.appSignOutUsage, (): CommandResult => {
    usageAuthService.signOut();
    return { ok: true };
  });

  ipcMain.handle(
    IPC_CHANNELS.appSelectDirectory,
    async (_event, rawPayload): Promise<SelectDirectoryResult> => {
      const payload = selectDirectoryRequestSchema.safeParse(rawPayload);
      if (!payload.success) {
        return { ok: false, error: 'Invalid directory selection request.' };
      }

      if (processManager.hasActiveProcess(payload.data.sessionId)) {
        return { ok: false, error: 'Stop the attached process before changing its directory.' };
      }

      const result = await dialog.showOpenDialog({
        title: 'Select session working directory',
        properties: ['openDirectory', 'createDirectory'],
      });

      if (result.canceled || !result.filePaths[0]) {
        return { ok: false, error: 'Directory selection cancelled.', cancelled: true };
      }

      if (!settingsStore.load().sessions.some((session) => session.id === payload.data.sessionId)) {
        return { ok: false, error: 'The selected session no longer exists.' };
      }

      if (processManager.hasActiveProcess(payload.data.sessionId)) {
        return { ok: false, error: 'Stop the attached process before changing its directory.' };
      }

      if (!settingsStore.updateSessionDirectory(payload.data.sessionId, result.filePaths[0])) {
        return { ok: false, error: 'The selected session no longer exists.' };
      }
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

  ipcMain.handle(IPC_CHANNELS.appUpdateAuthConfiguration, (_event, rawPayload): CommandResult => {
    const payload = updateAuthConfigurationRequestSchema.safeParse(rawPayload);
    if (!payload.success) {
      return { ok: false, error: 'Invalid authentication configuration.' };
    }

    settingsStore.updateAuthConfiguration(payload.data.auth);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.appUpdateShellConfiguration, (_event, rawPayload): CommandResult => {
    const payload = updateShellConfigurationRequestSchema.safeParse(rawPayload);
    if (!payload.success) {
      return { ok: false, error: 'Invalid shell preference.' };
    }

    settingsStore.updateShellConfiguration(payload.data.shellKind);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.appUpdateClaudeConfiguration, (_event, rawPayload): CommandResult => {
    const payload = updateClaudeConfigurationRequestSchema.safeParse(rawPayload);
    if (!payload.success) {
      return { ok: false, error: 'Invalid Claude configuration.' };
    }

    settingsStore.updateClaudeConfiguration(payload.data.executable, payload.data.baseArgs);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.appUpdateDeckPreferences, (_event, rawPayload): CommandResult => {
    const payload = updateDeckPreferencesRequestSchema.safeParse(rawPayload);
    if (!payload.success) {
      return { ok: false, error: 'Invalid deck preferences.' };
    }

    if (
      !settingsStore.load().sessions.some((session) => session.id === payload.data.focusedSessionId)
    ) {
      return { ok: false, error: 'The focused session no longer exists.' };
    }

    settingsStore.updateDeckPreferences(payload.data.focusedSessionId, payload.data.focusMode);
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
    IPC_CHANNELS.appUpdateSessionConfiguration,
    (_event, rawPayload): CommandResult => {
      const payload = updateSessionConfigurationRequestSchema.safeParse(rawPayload);
      if (!payload.success) {
        return { ok: false, error: 'Invalid session configuration.' };
      }

      const current = settingsStore
        .load()
        .sessions.find((session) => session.id === payload.data.configuration.id);
      if (!current) {
        return { ok: false, error: 'The selected session no longer exists.' };
      }
      if (
        processManager.hasActiveProcess(current.id) &&
        current.workingDirectory !== payload.data.configuration.workingDirectory
      ) {
        return { ok: false, error: 'Stop the attached process before changing its directory.' };
      }

      return settingsStore.updateSessionConfiguration(payload.data.configuration)
        ? { ok: true }
        : { ok: false, error: 'The selected session no longer exists.' };
    },
  );

  ipcMain.handle(IPC_CHANNELS.appUpdateSessionOrder, (_event, rawPayload): CommandResult => {
    const payload = updateSessionOrderRequestSchema.safeParse(rawPayload);
    if (!payload.success) {
      return { ok: false, error: 'Invalid session order.' };
    }

    const currentSessionIds = settingsStore.load().sessions.map((session) => session.id);
    if (
      payload.data.sessionIds.length !== currentSessionIds.length ||
      payload.data.sessionIds.some((sessionId) => !currentSessionIds.includes(sessionId))
    ) {
      return { ok: false, error: 'The session list changed before its order could be saved.' };
    }

    return settingsStore.updateSessionOrder(payload.data.sessionIds)
      ? { ok: true }
      : { ok: false, error: 'The session order could not be saved.' };
  });

  ipcMain.handle(
    IPC_CHANNELS.appUpdateSessionAudioPreferences,
    (_event, rawPayload): CommandResult => {
      const payload = updateSessionAudioPreferencesRequestSchema.safeParse(rawPayload);
      if (!payload.success) {
        return { ok: false, error: 'Invalid session audio preferences.' };
      }

      if (!settingsStore.load().sessions.some((session) => session.id === payload.data.sessionId)) {
        return { ok: false, error: 'The selected session no longer exists.' };
      }

      return settingsStore.updateSessionAudioPreferences(
        payload.data.sessionId,
        payload.data.preferences,
      )
        ? { ok: true }
        : { ok: false, error: 'The selected session no longer exists.' };
    },
  );
}
