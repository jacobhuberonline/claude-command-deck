import type {
  AppStateSnapshot,
  ApplicationSettings,
  AuthConfiguration,
  AuthStateSnapshot,
  AudioPreferences,
  NotificationPreferences,
  QuietHoursConfiguration,
  SessionAudioPreferences,
  SessionConfiguration,
  SessionId,
  SessionRuntimeState,
  SessionSnapshot,
} from './types';
import { MAX_SESSION_COUNT, SESSION_IDS, SETTINGS_SCHEMA_VERSION } from './types';

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
  provider: 'disabled',
  checkExecutable: '',
  checkArgs: [],
  refreshExecutable: '',
  refreshArgs: [],
  workingDirectory: '',
  shellMode: false,
  checkIntervalSeconds: 3600,
  checkTimeoutSeconds: 15,
  expirationWarningMinutes: 15,
  startupChecksEnabled: false,
  nativeNotificationsEnabled: true,
};

export function createDefaultSessionConfiguration(
  id: SessionId,
  indexOverride?: number,
): SessionConfiguration {
  const defaultIndex = SESSION_IDS.indexOf(id as (typeof SESSION_IDS)[number]) + 1;
  const index = indexOverride ?? (defaultIndex > 0 ? defaultIndex : 1);

  return {
    id,
    name: `Session ${index}`,
    role: 'project',
    workingDirectory: '',
    executable: '',
    args: [],
    model: '',
    claudeSessionName: createClaudeSessionName(`session-${index}`, id),
    hasNamedConversation: false,
    launchMode: 'new',
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
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    shellKind: 'auto',
    claudeExecutable: 'claude',
    claudeBaseArgs: [],
    sessions: [createDefaultSessionConfiguration(SESSION_IDS[0], 1)],
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
    auth: createAuthStateFromConfiguration(normalizedSettings.auth),
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
  const sourceSessions = settings.sessions.length > 0 ? settings.sessions : defaults.sessions;
  const seenIds = new Set<SessionId>();
  const sessions = sourceSessions
    .filter((session) => {
      if (seenIds.has(session.id)) {
        return false;
      }
      seenIds.add(session.id);
      return true;
    })
    .slice(0, MAX_SESSION_COUNT)
    .map((configured, index) => {
      const defaultSession = createDefaultSessionConfiguration(configured.id, index + 1);
      const retiredGlobalAssistant = configured.role === 'globalAssistant';
      const configuredName = configured.name.trim();
      const configuredModel = configured.model.trim();
      const name =
        retiredGlobalAssistant && configuredName === 'Global Assistant'
          ? directoryLeaf(configured.workingDirectory) || `Session ${index + 1}`
          : configuredName || `Session ${index + 1}`;

      return {
        ...defaultSession,
        ...configured,
        name,
        role: 'project' as const,
        executable: configured.executable.trim(),
        model:
          retiredGlobalAssistant && configuredModel.toLowerCase() === 'haiku'
            ? ''
            : canonicalModelOverride(configuredModel),
        claudeSessionName: configured.claudeSessionName.trim(),
        audio: {
          ...defaultSession.audio,
          ...configured.audio,
        },
      };
    });
  const focusedSessionId = sessions.some((session) => session.id === settings.focusedSessionId)
    ? settings.focusedSessionId
    : (sessions[0]?.id ?? defaults.focusedSessionId);

  return {
    ...defaults,
    ...settings,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    sessions,
    focusedSessionId,
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

function canonicalModelOverride(model: string): string {
  const alias = ['haiku', 'sonnet', 'opus'].find((candidate) => candidate === model.toLowerCase());
  return alias ?? model;
}

export function createClaudeSessionName(name: string, id: SessionId): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  const suffix =
    id
      .replace(/^session-/, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 8) || 'local';
  return `deck-${slug || 'session'}-${suffix}`;
}

function directoryLeaf(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? '';
}

export function createAuthStateFromConfiguration(auth: AuthConfiguration): AuthStateSnapshot {
  if (auth.provider === 'disabled') {
    return {
      provider: auth.provider,
      status: 'notConfigured',
      label: 'Credential monitor off',
      details: 'No provider check is configured or inspecting running Claude sessions.',
    };
  }

  if (!auth.checkExecutable.trim()) {
    return {
      provider: auth.provider,
      status: 'notConfigured',
      label:
        auth.provider === 'aws' ? 'AWS monitor not configured' : 'Custom monitor not configured',
      details:
        'Add a credential check command in Settings; session processes are checked separately.',
    };
  }

  return {
    provider: auth.provider,
    status: 'notConfigured',
    label: auth.provider === 'aws' ? 'AWS not checked' : 'Custom check not run',
    details:
      auth.provider === 'aws'
        ? 'Optional AWS credential monitor; it does not directly inspect running Claude sessions.'
        : 'Optional custom credential monitor; it does not directly inspect running Claude sessions.',
  };
}
