import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { createAuthStateFromConfiguration } from '../../../shared/domain/defaults';
import type {
  AppStateSnapshot,
  AuthCheckResult,
  AuthConfiguration,
  AudioPreferences,
  NotificationPreferences,
  SessionAudioPreferences,
  SessionConfiguration,
  SessionId,
  ShellKind,
} from '../../../shared/domain/types';
import type { CommandDeckBridge, CommandResult } from '../../../shared/ipc/contracts';

interface SettingsPersistenceDependencies {
  bridge: CommandDeckBridge;
  stateRef: { current: AppStateSnapshot };
  setState: Dispatch<SetStateAction<AppStateSnapshot>>;
  addDiagnostic: (id: string, label: string, error: string) => void;
  authCheckGenerationRef: { current: number };
  authCheckInFlightRef: { current: Promise<AuthCheckResult> | null };
  normalizeSessionConfiguration: (configuration: SessionConfiguration) => SessionConfiguration;
  markSameProjects: (snapshot: AppStateSnapshot) => AppStateSnapshot;
}

type SuccessfulCommandResult = Extract<CommandResult, { ok: true }>;
type FailedCommandResult = Extract<CommandResult, { ok: false }>;

export async function invokeCommand<TSuccess extends SuccessfulCommandResult>(
  request: () => Promise<TSuccess | FailedCommandResult>,
  fallbackError: string,
): Promise<TSuccess | FailedCommandResult> {
  try {
    return await request();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : fallbackError,
    };
  }
}

export function useSettingsPersistence({
  bridge,
  stateRef,
  setState,
  addDiagnostic,
  authCheckGenerationRef,
  authCheckInFlightRef,
  normalizeSessionConfiguration,
  markSameProjects,
}: SettingsPersistenceDependencies) {
  const updateAudioPreferences = useCallback(
    async (preferences: AudioPreferences) => {
      const previousPreferences = stateRef.current.settings.audio;
      setState((current) => ({
        ...current,
        settings: {
          ...current.settings,
          audio: preferences,
        },
      }));

      const result = await invokeCommand(
        () => bridge.updateAudioPreferences({ preferences }),
        'Unable to save audio preferences.',
      );
      if (!result.ok) {
        setState((current) =>
          current.settings.audio === preferences
            ? {
                ...current,
                settings: {
                  ...current.settings,
                  audio: previousPreferences,
                },
              }
            : current,
        );
        addDiagnostic('audio-preferences', 'Audio preferences', result.error);
      }
    },
    [addDiagnostic, bridge, setState, stateRef],
  );

  const updateAuthConfiguration = useCallback(
    async (auth: AuthConfiguration) => {
      const previousConfiguration = stateRef.current.settings.auth;
      const previousAuthState = stateRef.current.auth;
      authCheckGenerationRef.current += 1;
      authCheckInFlightRef.current = null;
      const authSummary = createAuthStateFromConfiguration(auth);

      setState((current) => ({
        ...current,
        settings: {
          ...current.settings,
          auth,
        },
        auth: {
          ...authSummary,
        },
      }));

      const result = await invokeCommand(
        () => bridge.updateAuthConfiguration({ auth }),
        'Unable to save credential monitor configuration.',
      );
      if (!result.ok) {
        authCheckGenerationRef.current += 1;
        authCheckInFlightRef.current = null;
        setState((current) =>
          current.settings.auth === auth
            ? {
                ...current,
                settings: {
                  ...current.settings,
                  auth: previousConfiguration,
                },
                auth: previousAuthState,
              }
            : current,
        );
        addDiagnostic('auth-configuration', 'Authentication configuration', result.error);
      }
    },
    [addDiagnostic, authCheckGenerationRef, authCheckInFlightRef, bridge, setState, stateRef],
  );

  const updateClaudeConfiguration = useCallback(
    async (executable: string, baseArgs: string[]) => {
      const normalizedExecutable = executable.trim() || 'claude';
      const previousExecutable = stateRef.current.settings.claudeExecutable;
      const previousBaseArgs = stateRef.current.settings.claudeBaseArgs;
      setState((current) => ({
        ...current,
        settings: {
          ...current.settings,
          claudeExecutable: normalizedExecutable,
          claudeBaseArgs: baseArgs,
        },
      }));

      const result = await invokeCommand(
        () =>
          bridge.updateClaudeConfiguration({
            executable: normalizedExecutable,
            baseArgs,
          }),
        'Unable to save Claude configuration.',
      );
      if (!result.ok) {
        setState((current) =>
          current.settings.claudeExecutable === normalizedExecutable &&
          current.settings.claudeBaseArgs === baseArgs
            ? {
                ...current,
                settings: {
                  ...current.settings,
                  claudeExecutable: previousExecutable,
                  claudeBaseArgs: previousBaseArgs,
                },
              }
            : current,
        );
        addDiagnostic('claude-configuration', 'Claude configuration', result.error);
      }
    },
    [addDiagnostic, bridge, setState, stateRef],
  );

  const updateShellConfiguration = useCallback(
    async (shellKind: ShellKind) => {
      const previousShellKind = stateRef.current.settings.shellKind;
      setState((current) => ({
        ...current,
        settings: {
          ...current.settings,
          shellKind,
        },
      }));

      const result = await invokeCommand(
        () => bridge.updateShellConfiguration({ shellKind }),
        'Unable to save the shell preference.',
      );
      if (!result.ok) {
        setState((current) =>
          current.settings.shellKind === shellKind
            ? {
                ...current,
                settings: {
                  ...current.settings,
                  shellKind: previousShellKind,
                },
              }
            : current,
        );
        addDiagnostic('shell-configuration', 'Shell configuration', result.error);
      }
    },
    [addDiagnostic, bridge, setState, stateRef],
  );

  const updateNotificationPreferences = useCallback(
    async (preferences: NotificationPreferences) => {
      const previousPreferences = stateRef.current.settings.notifications;
      setState((current) => ({
        ...current,
        settings: {
          ...current.settings,
          notifications: preferences,
        },
      }));

      const result = await invokeCommand(
        () => bridge.updateNotificationPreferences({ preferences }),
        'Unable to save notification preferences.',
      );
      if (!result.ok) {
        setState((current) =>
          current.settings.notifications === preferences
            ? {
                ...current,
                settings: {
                  ...current.settings,
                  notifications: previousPreferences,
                },
              }
            : current,
        );
        addDiagnostic('notification-preferences', 'Notification preferences', result.error);
      }
    },
    [addDiagnostic, bridge, setState, stateRef],
  );

  const updateSessionAudioPreferences = useCallback(
    async (sessionId: SessionId, preferences: SessionAudioPreferences) => {
      const previousPreferences = stateRef.current.settings.sessions.find(
        (session) => session.id === sessionId,
      )?.audio;
      setState((current) => ({
        ...current,
        settings: {
          ...current.settings,
          sessions: current.settings.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  audio: preferences,
                }
              : session,
          ),
        },
        sessions: current.sessions.map((session) =>
          session.configuration.id === sessionId
            ? {
                ...session,
                configuration: {
                  ...session.configuration,
                  audio: preferences,
                },
              }
            : session,
        ),
      }));

      const result = await invokeCommand(
        () => bridge.updateSessionAudioPreferences({ sessionId, preferences }),
        'Unable to save session audio preferences.',
      );
      if (!result.ok) {
        if (previousPreferences) {
          setState((current) => ({
            ...current,
            settings: {
              ...current.settings,
              sessions: current.settings.sessions.map((session) =>
                session.id === sessionId && session.audio === preferences
                  ? { ...session, audio: previousPreferences }
                  : session,
              ),
            },
            sessions: current.sessions.map((session) =>
              session.configuration.id === sessionId && session.configuration.audio === preferences
                ? {
                    ...session,
                    configuration: {
                      ...session.configuration,
                      audio: previousPreferences,
                    },
                  }
                : session,
            ),
          }));
        }
        addDiagnostic('session-audio-preferences', 'Session audio preferences', result.error);
      }
    },
    [addDiagnostic, bridge, setState, stateRef],
  );

  const updateSessionConfiguration = useCallback(
    async (configuration: SessionConfiguration) => {
      const nextConfiguration = normalizeSessionConfiguration(configuration);
      const previousConfiguration = stateRef.current.settings.sessions.find(
        (session) => session.id === nextConfiguration.id,
      );

      setState((current) =>
        markSameProjects({
          ...current,
          settings: {
            ...current.settings,
            sessions: current.settings.sessions.map((session) =>
              session.id === nextConfiguration.id ? nextConfiguration : session,
            ),
          },
          sessions: current.sessions.map((session) =>
            session.configuration.id === nextConfiguration.id
              ? {
                  ...session,
                  configuration: nextConfiguration,
                }
              : session,
          ),
        }),
      );

      const result = await invokeCommand(
        () => bridge.updateSessionConfiguration({ configuration: nextConfiguration }),
        'Unable to save the session configuration.',
      );
      if (!result.ok) {
        if (previousConfiguration) {
          setState((current) =>
            markSameProjects({
              ...current,
              settings: {
                ...current.settings,
                sessions: current.settings.sessions.map((session) =>
                  session.id === nextConfiguration.id && session === nextConfiguration
                    ? previousConfiguration
                    : session,
                ),
              },
              sessions: current.sessions.map((session) =>
                session.configuration.id === nextConfiguration.id &&
                session.configuration === nextConfiguration
                  ? {
                      ...session,
                      configuration: previousConfiguration,
                    }
                  : session,
              ),
            }),
          );
        }
        addDiagnostic('session-configuration', 'Session configuration', result.error);
      }
    },
    [addDiagnostic, bridge, markSameProjects, normalizeSessionConfiguration, setState, stateRef],
  );

  return {
    updateAudioPreferences,
    updateAuthConfiguration,
    updateClaudeConfiguration,
    updateShellConfiguration,
    updateNotificationPreferences,
    updateSessionAudioPreferences,
    updateSessionConfiguration,
  };
}
