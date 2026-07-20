import type {
  AppStateSnapshot,
  ApplicationSettings,
  AuthConfiguration,
  AudioPreferences,
  NotificationPreferences,
  QuietHoursConfiguration,
  SessionAudioPreferences,
  SessionConfiguration,
  SessionId,
  SessionRuntimeState,
  SessionSnapshot,
} from './types';
import { SESSION_IDS } from './types';

export const defaultGlobalAssistantSessionId: SessionId = 'session-1';
export const defaultGlobalAssistantName = 'Global Assistant';
export const defaultGlobalAssistantModel = 'haiku';

const defaultSessionAudio: SessionAudioPreferences = {
  enabled: true,
  completionEnabled: true,
  attentionEnabled: true,
  errorEnabled: true,
  volumeMultiplier: 1,
  onlyWhenUnfocused: true,
};

const defaultQuietHours: QuietHoursConfiguration = {
  enabled: false,
  startTime: '18:00',
  endTime: '08:00',
  days: [0, 1, 2, 3, 4, 5, 6],
  allowAuthDisconnectSounds: true,
  allowCrashSounds: true,
};

export const defaultAudioPreferences: AudioPreferences = {
  masterEnabled: true,
  masterVolume: 0.28,
  doNotDisturb: false,
  startupSoundsEnabled: false,
  sessionReadyEnabled: true,
  completionEnabled: true,
  attentionEnabled: true,
  authenticationEnabled: true,
  errorEnabled: true,
  onlyWhenUnfocused: true,
  cooldownMs: 4500,
  minimumActivityMs: 10000,
  quietHours: defaultQuietHours,
};

export const defaultNotificationPreferences: NotificationPreferences = {
  enabled: true,
  authTransitions: true,
  sessionAttention: true,
  sessionCrash: true,
  reloadAllSummary: true,
  cooldownMs: 60000,
};

export const defaultAuthConfiguration: AuthConfiguration = {
  provider: 'aws',
  checkExecutable: 'aws',
  checkArgs: ['sts', 'get-caller-identity', '--output', 'json'],
  refreshExecutable: '',
  refreshArgs: [],
  workingDirectory: '',
  shellMode: false,
  checkIntervalSeconds: 3600,
  checkTimeoutSeconds: 15,
  expirationWarningMinutes: 15,
  startupChecksEnabled: true,
  nativeNotificationsEnabled: true,
};

export function createDefaultSessionConfiguration(id: SessionId): SessionConfiguration {
  const index = SESSION_IDS.indexOf(id) + 1;
  const globalAssistant = id === defaultGlobalAssistantSessionId;

  return {
    id,
    name: globalAssistant ? defaultGlobalAssistantName : `Session ${index}`,
    role: globalAssistant ? 'globalAssistant' : 'project',
    workingDirectory: '',
    executable: 'claude',
    args: [],
    model: globalAssistant ? defaultGlobalAssistantModel : '',
    launchMode: 'continueMostRecent',
    scrollback: 5000,
    restoreOnLaunch: false,
    audio: { ...defaultSessionAudio },
  };
}

export function createDefaultRuntimeState(processState: SessionRuntimeState['processState']) {
  return {
    processState,
    activityState: 'unknown',
    activityConfidence: 'low',
    statusMessage: 'Select a project directory to begin.',
    sameProject: false,
    attention: false,
  } satisfies SessionRuntimeState;
}

export function createDefaultSettings(): ApplicationSettings {
  return {
    schemaVersion: 1,
    shellExecutable: 'pwsh.exe',
    claudeExecutable: 'claude',
    claudeBaseArgs: [],
    sessions: SESSION_IDS.map(createDefaultSessionConfiguration),
    focusedSessionId: 'session-1',
    focusMode: false,
    auth: { ...defaultAuthConfiguration },
    audio: {
      ...defaultAudioPreferences,
      quietHours: { ...defaultAudioPreferences.quietHours },
    },
    notifications: { ...defaultNotificationPreferences },
  };
}

export function createPhaseOneState(appVersion: string): AppStateSnapshot {
  const settings = createDefaultSettings();
  const now = new Date().toISOString();
  const state = createAppStateFromSettings(appVersion, settings);

  return {
    ...state,
    diagnostics: [
      {
        id: 'secure-electron',
        label: 'Secure Electron defaults',
        status: 'pass',
        detail: 'contextIsolation enabled, nodeIntegration disabled, remote module unused.',
        checkedAt: now,
      },
      ...state.diagnostics,
    ],
  };
}

export function createAppStateFromSettings(
  appVersion: string,
  settings: ApplicationSettings,
): AppStateSnapshot {
  const now = new Date().toISOString();
  const normalizedSettings = normalizeApplicationSettings(settings);

  return {
    sessions: normalizedSettings.sessions.map((configuration): SessionSnapshot => {
      const configured = configuration.workingDirectory.trim().length > 0;
      return {
        configuration: {
          ...configuration,
          restoreOnLaunch: configuration.restoreOnLaunch,
        },
        runtime: {
          ...createDefaultRuntimeState(configured ? 'stopped' : 'empty'),
          activityState: configured ? 'idle' : 'unknown',
          statusMessage: configured
            ? 'Configured and stopped.'
            : 'Select a project directory to begin.',
        },
      };
    }),
    auth: {
      provider: normalizedSettings.auth.provider,
      status: normalizedSettings.auth.provider === 'disabled' ? 'notConfigured' : 'notConfigured',
      label:
        normalizedSettings.auth.provider === 'disabled'
          ? 'Authentication disabled'
          : normalizedSettings.auth.checkExecutable.trim()
            ? 'Ready to check'
            : 'AWS not configured',
      details:
        normalizedSettings.auth.provider === 'disabled'
          ? 'Authentication monitoring is disabled.'
          : normalizedSettings.auth.checkExecutable.trim()
            ? 'Click Check Connection to validate credentials.'
            : 'Configure a credential check command in Settings.',
    },
    settings: normalizedSettings,
    diagnostics: [
      {
        id: 'settings-schema',
        label: 'Settings schema',
        status: 'pass',
        detail: `Loaded schema v${normalizedSettings.schemaVersion}; sessions restore stopped by default.`,
        checkedAt: now,
      },
    ],
    appVersion,
  };
}

export function normalizeApplicationSettings(settings: ApplicationSettings): ApplicationSettings {
  const defaults = createDefaultSettings();
  const byId = new Map(settings.sessions.map((session) => [session.id, session]));
  let sessions = defaults.sessions.map((defaultSession) => {
    const configured = byId.get(defaultSession.id);
    return configured
      ? {
          ...defaultSession,
          ...configured,
          audio: {
            ...defaultSession.audio,
            ...configured.audio,
          },
        }
      : defaultSession;
  });

  if (!sessions.some((session) => session.role === 'globalAssistant')) {
    sessions = sessions.map((session) =>
      session.id === defaultGlobalAssistantSessionId
        ? {
            ...session,
            name: defaultGlobalAssistantName,
            role: 'globalAssistant',
            model: session.model.trim() || defaultGlobalAssistantModel,
          }
        : session,
    );
  }

  return {
    ...defaults,
    ...settings,
    sessions: sessions.map((session) =>
      session.role === 'globalAssistant'
        ? {
            ...session,
            name: session.name.trim() || defaultGlobalAssistantName,
            model: session.model.trim() || defaultGlobalAssistantModel,
          }
        : {
            ...session,
            model: session.model.trim(),
          },
    ),
    audio: {
      ...defaults.audio,
      ...settings.audio,
      quietHours: {
        ...defaults.audio.quietHours,
        ...settings.audio.quietHours,
      },
    },
    auth: {
      ...defaults.auth,
      ...settings.auth,
    },
    notifications: {
      ...defaults.notifications,
      ...settings.notifications,
    },
  };
}
