import type {
  AppStateSnapshot,
  AuthCheckResult,
  AuthConfiguration,
  AudioPreferences,
  ClaudeDiscoverySnapshot,
  ManagedProcessSnapshot,
  MonthlyUsageResult,
  NotificationPreferences,
  SessionAudioPreferences,
  SessionConfiguration,
  SessionId,
  SessionLaunchMode,
  ShellKind,
  ShellOption,
  UsageAuthSnapshot,
  UsageSignInResult,
} from '../domain/types';

export type AppShortcut = 'openSessionSwitcher' | 'addSession';

export interface AppShortcutEvent {
  shortcut: AppShortcut;
}

export interface OpenDirectoryRequest {
  sessionId: SessionId;
}

export interface OpenExternalUrlRequest {
  url: string;
}

export interface SelectDirectoryRequest {
  sessionId: SessionId;
}

export interface RemoveSessionRequest {
  sessionId: SessionId;
}

export interface UpdateAudioPreferencesRequest {
  preferences: AudioPreferences;
}

export interface UpdateAuthConfigurationRequest {
  auth: AuthConfiguration;
}

export interface UpdateShellConfigurationRequest {
  shellKind: ShellKind;
}

export interface UpdateNotificationPreferencesRequest {
  preferences: NotificationPreferences;
}

export interface UpdateClaudeConfigurationRequest {
  executable: string;
  baseArgs: string[];
}

export interface UpdateDeckPreferencesRequest {
  focusedSessionId: SessionId;
  focusMode: boolean;
}

export interface UpdateSessionConfigurationRequest {
  configuration: SessionConfiguration;
}

export interface UpdateSessionOrderRequest {
  sessionIds: SessionId[];
}

export interface UpdateSessionAudioPreferencesRequest {
  sessionId: SessionId;
  preferences: SessionAudioPreferences;
}

export type SelectDirectoryResult =
  | {
      ok: true;
      directory: string;
    }
  | {
      ok: false;
      error: string;
      cancelled?: boolean;
    };

export type AddSessionResult =
  | {
      ok: true;
      configuration: SessionConfiguration;
    }
  | {
      ok: false;
      error: string;
      cancelled?: boolean;
    };

export type CommandResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };

export interface StartShellRequest {
  sessionId: SessionId;
  workingDirectory: string;
  shellKind: ShellKind;
  cols: number;
  rows: number;
}

export type ClaudeLaunchStrategy =
  'new' | 'continueMostRecent' | 'resumeSpecific' | 'freshFallback';

export interface PrepareClaudeLaunchRequest {
  sessionId: SessionId;
  launchMode: Exclude<SessionLaunchMode, 'custom'>;
}

export type PrepareClaudeLaunchResult =
  | {
      ok: true;
      planId: string;
      strategy: ClaudeLaunchStrategy;
      requiresFreshFallbackConsent: boolean;
      requiresAmbiguousContinueConsent: boolean;
      hasActiveProcess: boolean;
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
    };

export interface StartClaudeRequest {
  sessionId: SessionId;
  planId: string;
  allowFreshFallback: boolean;
  allowAmbiguousContinue: boolean;
  cols: number;
  rows: number;
}

export type StartClaudeResult =
  | {
      ok: true;
      processId: string;
      strategy: ClaudeLaunchStrategy;
      newConversationBinding: string | null;
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
    };

export interface TerminalWriteRequest {
  sessionId: SessionId;
  data: string;
}

export interface TerminalResizeRequest {
  sessionId: SessionId;
  cols: number;
  rows: number;
}

export interface TerminalStopRequest {
  sessionId: SessionId;
  planId?: string;
}

export interface TerminalOutputEvent {
  sessionId: SessionId;
  processId: string;
  data: string;
}

export interface TerminalExitEvent {
  sessionId: SessionId;
  processId: string;
  exitCode: number | null;
  signal: string | null;
  crashed: boolean;
}

export interface TerminalStateEvent {
  sessionId: SessionId;
  snapshot: ManagedProcessSnapshot;
}

export interface TerminalConversationBindingEvent {
  sessionId: SessionId;
  processId: string;
  claudeSessionName: string | null;
}

export interface AuthWriteRequest {
  data: string;
}

export interface AuthResizeRequest {
  cols: number;
  rows: number;
}

export interface AuthOutputEvent {
  data: string;
}

export interface AuthExitEvent {
  exitCode: number | null;
  signal: string | null;
}

export interface AuthBridge {
  check: () => Promise<AuthCheckResult>;
  startRefresh: () => Promise<CommandResult>;
  write: (request: AuthWriteRequest) => Promise<CommandResult>;
  resize: (request: AuthResizeRequest) => Promise<CommandResult>;
  stopRefresh: () => Promise<CommandResult>;
  onOutput: (listener: (event: AuthOutputEvent) => void) => () => void;
  onExit: (listener: (event: AuthExitEvent) => void) => () => void;
}

export interface TerminalBridge {
  getShellOptions: () => Promise<ShellOption[]>;
  startShell: (request: StartShellRequest) => Promise<CommandResult>;
  prepareClaude: (request: PrepareClaudeLaunchRequest) => Promise<PrepareClaudeLaunchResult>;
  startClaude: (request: StartClaudeRequest) => Promise<StartClaudeResult>;
  write: (request: TerminalWriteRequest) => Promise<CommandResult>;
  resize: (request: TerminalResizeRequest) => Promise<CommandResult>;
  stop: (request: TerminalStopRequest) => Promise<CommandResult>;
  getSnapshots: () => Promise<ManagedProcessSnapshot[]>;
  onOutput: (listener: (event: TerminalOutputEvent) => void) => () => void;
  onExit: (listener: (event: TerminalExitEvent) => void) => () => void;
  onState: (listener: (event: TerminalStateEvent) => void) => () => void;
  onConversationBinding: (
    listener: (event: TerminalConversationBindingEvent) => void,
  ) => () => void;
}

export interface CommandDeckBridge {
  getAppState: () => Promise<AppStateSnapshot>;
  onShortcut: (listener: (event: AppShortcutEvent) => void) => () => void;
  addSession: () => Promise<AddSessionResult>;
  removeSession: (request: RemoveSessionRequest) => Promise<CommandResult>;
  openDirectory: (request: OpenDirectoryRequest) => Promise<CommandResult>;
  openExternalUrl: (request: OpenExternalUrlRequest) => Promise<CommandResult>;
  openLogDirectory: () => Promise<CommandResult>;
  getUsage: () => Promise<MonthlyUsageResult>;
  getUsageAuth: () => Promise<UsageAuthSnapshot>;
  signInUsage: () => Promise<UsageSignInResult>;
  signOutUsage: () => Promise<CommandResult>;
  selectDirectory: (request: SelectDirectoryRequest) => Promise<SelectDirectoryResult>;
  updateAuthConfiguration: (request: UpdateAuthConfigurationRequest) => Promise<CommandResult>;
  updateShellConfiguration: (request: UpdateShellConfigurationRequest) => Promise<CommandResult>;
  updateClaudeConfiguration: (request: UpdateClaudeConfigurationRequest) => Promise<CommandResult>;
  updateDeckPreferences: (request: UpdateDeckPreferencesRequest) => Promise<CommandResult>;
  updateAudioPreferences: (request: UpdateAudioPreferencesRequest) => Promise<CommandResult>;
  updateNotificationPreferences: (
    request: UpdateNotificationPreferencesRequest,
  ) => Promise<CommandResult>;
  updateSessionConfiguration: (
    request: UpdateSessionConfigurationRequest,
  ) => Promise<CommandResult>;
  updateSessionOrder: (request: UpdateSessionOrderRequest) => Promise<CommandResult>;
  updateSessionAudioPreferences: (
    request: UpdateSessionAudioPreferencesRequest,
  ) => Promise<CommandResult>;
  claude: {
    discover: (executable: string) => Promise<ClaudeDiscoverySnapshot>;
  };
  auth: AuthBridge;
  terminal: TerminalBridge;
}
