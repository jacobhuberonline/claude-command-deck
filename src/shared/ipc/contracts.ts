import type {
  AppStateSnapshot,
  AuthCheckResult,
  AudioPreferences,
  ClaudeDiscoverySnapshot,
  ManagedProcessSnapshot,
  NotificationPreferences,
  SessionAudioPreferences,
  SessionId,
} from '../domain/types';

export interface OpenDirectoryRequest {
  sessionId: SessionId;
}

export interface SelectDirectoryRequest {
  sessionId: SessionId;
}

export interface UpdateAudioPreferencesRequest {
  preferences: AudioPreferences;
}

export interface UpdateNotificationPreferencesRequest {
  preferences: NotificationPreferences;
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
  cols: number;
  rows: number;
}

export interface StartClaudeRequest {
  sessionId: SessionId;
  workingDirectory: string;
  executable: string;
  args: string[];
  cols: number;
  rows: number;
}

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
}

export interface TerminalOutputEvent {
  sessionId: SessionId;
  data: string;
}

export interface TerminalExitEvent {
  sessionId: SessionId;
  exitCode: number | null;
  signal: string | null;
  crashed: boolean;
}

export interface TerminalStateEvent {
  sessionId: SessionId;
  snapshot: ManagedProcessSnapshot;
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
  startShell: (request: StartShellRequest) => Promise<CommandResult>;
  startClaude: (request: StartClaudeRequest) => Promise<CommandResult>;
  write: (request: TerminalWriteRequest) => Promise<CommandResult>;
  resize: (request: TerminalResizeRequest) => Promise<CommandResult>;
  stop: (request: TerminalStopRequest) => Promise<CommandResult>;
  getSnapshots: () => Promise<ManagedProcessSnapshot[]>;
  onOutput: (listener: (event: TerminalOutputEvent) => void) => () => void;
  onExit: (listener: (event: TerminalExitEvent) => void) => () => void;
  onState: (listener: (event: TerminalStateEvent) => void) => () => void;
}

export interface CommandDeckBridge {
  getAppState: () => Promise<AppStateSnapshot>;
  openDirectory: (request: OpenDirectoryRequest) => Promise<CommandResult>;
  openLogDirectory: () => Promise<CommandResult>;
  selectDirectory: (request: SelectDirectoryRequest) => Promise<SelectDirectoryResult>;
  updateAudioPreferences: (request: UpdateAudioPreferencesRequest) => Promise<CommandResult>;
  updateNotificationPreferences: (
    request: UpdateNotificationPreferencesRequest,
  ) => Promise<CommandResult>;
  updateSessionAudioPreferences: (
    request: UpdateSessionAudioPreferencesRequest,
  ) => Promise<CommandResult>;
  claude: {
    discover: (executable: string) => Promise<ClaudeDiscoverySnapshot>;
  };
  auth: AuthBridge;
  terminal: TerminalBridge;
}
