export const SESSION_IDS = ['session-1', 'session-2', 'session-3', 'session-4'] as const;

export type SessionId = (typeof SESSION_IDS)[number];

export type ProcessState =
  | 'empty'
  | 'validating'
  | 'starting'
  | 'running'
  | 'restarting'
  | 'stopping'
  | 'stopped'
  | 'crashed'
  | 'waitingForAuthentication'
  | 'error';

export type ActivityState =
  | 'unknown'
  | 'idle'
  | 'active'
  | 'likelyAwaitingInput'
  | 'possiblePermissionPrompt'
  | 'authenticationMayBeRequired';

export type ActivityConfidence = 'low' | 'medium' | 'high';

export type SessionLaunchMode = 'new' | 'continueMostRecent' | 'resumeSpecific' | 'custom';

export type ManagedProcessType = 'claudeSession' | 'shellSession' | 'authCheck' | 'authRefresh';

export type AuthProvider = 'aws' | 'custom' | 'disabled';

export type AuthStatus =
  | 'notConfigured'
  | 'checking'
  | 'connected'
  | 'expiringSoon'
  | 'disconnected'
  | 'refreshing'
  | 'error';

export type DiagnosticStatus = 'pass' | 'warn' | 'fail' | 'unknown';

export type SettingsSection =
  | 'general'
  | 'claude'
  | 'shell'
  | 'authentication'
  | 'audio'
  | 'notifications'
  | 'appearance'
  | 'diagnostics';

export interface SessionAudioPreferences {
  enabled: boolean;
  completionEnabled: boolean;
  attentionEnabled: boolean;
  errorEnabled: boolean;
  volumeMultiplier: number;
  onlyWhenUnfocused: boolean;
}

export interface SessionConfiguration {
  id: SessionId;
  name: string;
  workingDirectory: string;
  executable: string;
  args: string[];
  launchMode: SessionLaunchMode;
  scrollback: number;
  restoreOnLaunch: boolean;
  audio: SessionAudioPreferences;
}

export interface SessionRuntimeState {
  processState: ProcessState;
  processType?: ManagedProcessType | undefined;
  activityState: ActivityState;
  activityConfidence: ActivityConfidence;
  startedAt?: string;
  lastOutputAt?: string;
  exitCode?: number | null;
  statusMessage: string;
  outputPreview?: string | undefined;
  outputRequiresConsole?: boolean | undefined;
  sameProject: boolean;
  attention: boolean;
}

export interface SessionSnapshot {
  configuration: SessionConfiguration;
  runtime: SessionRuntimeState;
}

export interface ManagedProcessSnapshot {
  id: string;
  type: ManagedProcessType;
  sessionId?: SessionId;
  workingDirectory: string;
  executable: string;
  args: string[];
  pid?: number;
  startedAt: string;
  lastOutputAt?: string;
  state: ProcessState;
  exitCode?: number | null;
  signal?: string | null;
  restartGeneration: number;
}

export interface AuthConfiguration {
  provider: AuthProvider;
  checkExecutable: string;
  checkArgs: string[];
  refreshExecutable: string;
  refreshArgs: string[];
  workingDirectory: string;
  shellMode: boolean;
  checkIntervalSeconds: number;
  checkTimeoutSeconds: number;
  expirationWarningMinutes: number;
  startupChecksEnabled: boolean;
  nativeNotificationsEnabled: boolean;
}

export interface AuthStateSnapshot {
  provider: AuthProvider;
  status: AuthStatus;
  label: string;
  details: string;
  safeIdentity?: AuthSafeIdentity | undefined;
  lastCheckedAt?: string | undefined;
  lastSuccessfulCheckAt?: string | undefined;
  nextScheduledCheckAt?: string | undefined;
}

export interface AuthSafeIdentity {
  accountId?: string | undefined;
  arn?: string | undefined;
  userId?: string | undefined;
}

export interface AuthCheckResult {
  status: AuthStatus;
  checkedAt: string;
  safeIdentity?: AuthSafeIdentity | undefined;
  error?: string | undefined;
}

export type AudioEvent =
  | 'session.activity_started'
  | 'session.activity_stopped'
  | 'session.ready'
  | 'session.estimated_completion'
  | 'session.likely_awaiting_input'
  | 'session.possible_permission_prompt'
  | 'session.authentication_may_be_required'
  | 'session.reload_completed'
  | 'session.reload_failed'
  | 'session.crashed'
  | 'auth.connected'
  | 'auth.disconnected'
  | 'auth.refresh_failed'
  | 'reload_all.completed'
  | 'reload_all.partially_failed';

export interface QuietHoursConfiguration {
  enabled: boolean;
  startTime: string;
  endTime: string;
  days: number[];
  allowAuthDisconnectSounds: boolean;
  allowCrashSounds: boolean;
}

export interface AudioPreferences {
  masterEnabled: boolean;
  masterVolume: number;
  doNotDisturb: boolean;
  doNotDisturbUntil?: string | undefined;
  startupSoundsEnabled: boolean;
  sessionReadyEnabled: boolean;
  completionEnabled: boolean;
  attentionEnabled: boolean;
  authenticationEnabled: boolean;
  errorEnabled: boolean;
  onlyWhenUnfocused: boolean;
  cooldownMs: number;
  minimumActivityMs: number;
  quietHours: QuietHoursConfiguration;
}

export interface NotificationPreferences {
  enabled: boolean;
  authTransitions: boolean;
  sessionAttention: boolean;
  sessionCrash: boolean;
  reloadAllSummary: boolean;
  cooldownMs: number;
}

export interface ApplicationSettings {
  schemaVersion: number;
  shellExecutable: string;
  claudeExecutable: string;
  claudeBaseArgs: string[];
  sessions: SessionConfiguration[];
  focusedSessionId: SessionId;
  focusMode: boolean;
  auth: AuthConfiguration;
  audio: AudioPreferences;
  notifications: NotificationPreferences;
}

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: DiagnosticStatus;
  detail: string;
  checkedAt?: string;
}

export interface ClaudeDiscoverySnapshot {
  executable: string;
  resolvedPath: string | null;
  found: boolean;
  version: string | null;
  capabilities: ClaudeContinuationCapabilities;
  error: string | null;
  checkedAt: string;
}

export interface ClaudeContinuationCapabilities {
  helpAvailable: boolean;
  continueMostRecent: boolean;
  continueFlag: string | null;
  resumeSpecific: boolean;
  resumeFlag: string | null;
}

export interface AppStateSnapshot {
  sessions: SessionSnapshot[];
  auth: AuthStateSnapshot;
  settings: ApplicationSettings;
  diagnostics: DiagnosticCheck[];
  appVersion: string;
}
