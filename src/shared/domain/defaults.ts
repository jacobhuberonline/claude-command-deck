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
import { SESSION_IDS } from './types';

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

  return {
    id,
    name: `Session ${index}`,
    workingDirectory: '',
    executable: 'claude',
    args: [],
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
    statusMessage: 'Ready for configuration',
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

export function createPhaseOneState(
  appVersion: string,
  options: { workspaceRoot?: string } = {},
): AppStateSnapshot {
  const settings = createDefaultSettings();
  const now = new Date().toISOString();
  const configuredDirectory = options.workspaceRoot ?? 'C:\\Code\\api-skill-test';
  const configuredSessions = settings.sessions.map((configuration, index): SessionSnapshot => {
    const runtimeByIndex: SessionRuntimeState[] = [
      {
        ...createDefaultRuntimeState('empty'),
        statusMessage: 'Select a project directory to begin.',
      },
      {
        ...createDefaultRuntimeState('stopped'),
        activityState: 'idle',
        statusMessage: 'Configured and stopped.',
      },
      {
        ...createDefaultRuntimeState('running'),
        activityState: 'possiblePermissionPrompt',
        activityConfidence: 'medium',
        startedAt: now,
        lastOutputAt: now,
        statusMessage: 'Possible permission prompt.',
        sameProject: true,
        attention: true,
      },
      {
        ...createDefaultRuntimeState('crashed'),
        activityState: 'authenticationMayBeRequired',
        activityConfidence: 'medium',
        startedAt: now,
        lastOutputAt: now,
        exitCode: 1,
        statusMessage: 'Process exited unexpectedly.',
        sameProject: true,
        attention: true,
      },
    ];

    const workingDirectory = index === 0 ? '' : configuredDirectory;

    return {
      configuration: {
        ...configuration,
        name: ['Unassigned Bay', 'Provider API', 'API Skill Test', 'API Skill Test Lab'][index]!,
        workingDirectory,
      },
      runtime: runtimeByIndex[index]!,
    };
  });

  return {
    sessions: configuredSessions,
    auth: {
      provider: 'aws',
      status: 'notConfigured',
      label: 'AWS not configured',
      details: 'Configure a credential check command in Settings.',
    } satisfies AuthStateSnapshot,
    settings,
    diagnostics: [
      {
        id: 'secure-electron',
        label: 'Secure Electron defaults',
        status: 'pass',
        detail: 'contextIsolation enabled, nodeIntegration disabled, remote module unused.',
        checkedAt: now,
      },
      {
        id: 'terminal-adapter',
        label: 'Terminal adapter',
        status: 'warn',
        detail: 'Visual placeholder only until Phase 2 PTY integration.',
        checkedAt: now,
      },
    ],
    appVersion,
  };
}

export function createAppStateFromSettings(
  appVersion: string,
  settings: ApplicationSettings,
): AppStateSnapshot {
  const now = new Date().toISOString();

  return {
    sessions: settings.sessions.map((configuration): SessionSnapshot => {
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
      provider: settings.auth.provider,
      status: settings.auth.provider === 'disabled' ? 'notConfigured' : 'notConfigured',
      label:
        settings.auth.provider === 'disabled'
          ? 'Authentication disabled'
          : settings.auth.checkExecutable.trim()
            ? 'Ready to check'
            : 'AWS not configured',
      details:
        settings.auth.provider === 'disabled'
          ? 'Authentication monitoring is disabled.'
          : settings.auth.checkExecutable.trim()
            ? 'Click Check Connection to validate credentials.'
            : 'Configure a credential check command in Settings.',
    },
    settings,
    diagnostics: [
      {
        id: 'settings-schema',
        label: 'Settings schema',
        status: 'pass',
        detail: `Loaded schema v${settings.schemaVersion}; sessions restore stopped by default.`,
        checkedAt: now,
      },
    ],
    appVersion,
  };
}
