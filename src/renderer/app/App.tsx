import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildClaudeCommand } from '../../shared/claude/ClaudeCommandBuilder';
import { createPhaseOneState } from '../../shared/domain/defaults';
import type {
  AppStateSnapshot,
  AuthCheckResult,
  AuthConfiguration,
  AuthStatus,
  AudioEvent,
  AudioPreferences,
  ClaudeDiscoverySnapshot,
  NotificationPreferences,
  ProcessState,
  SessionAudioPreferences,
  SessionId,
  SettingsSection,
} from '../../shared/domain/types';
import type { CommandDeckBridge } from '../../shared/ipc/contracts';
import { AuthConsole } from '../components/auth-console/AuthConsole';
import { CommandBar } from '../components/command-bar/CommandBar';
import { SessionGrid } from '../components/session-bay/SessionGrid';
import { SettingsPanel } from '../components/settings/SettingsPanel';
import {
  ActivityClassifier,
  type ActivityClassification,
} from '../services/activity/ActivityClassifier';
import { AudioService, defaultSoundRegistry } from '../services/audio/AudioService';
import { DesktopNotificationService } from '../services/audio/DesktopNotificationService';

const fallbackBridge = {
  getAppState: () => Promise.resolve(createPhaseOneState('browser-preview')),
  openDirectory: () =>
    Promise.resolve({ ok: false as const, error: 'Desktop shell is not available.' }),
  openLogDirectory: () =>
    Promise.resolve({ ok: false as const, error: 'Desktop log directory is not available.' }),
  selectDirectory: () =>
    Promise.resolve({
      ok: false as const,
      error: 'Desktop directory picker is not available.',
      cancelled: true,
    }),
  updateAuthConfiguration: () => Promise.resolve({ ok: true as const }),
  updateAudioPreferences: () => Promise.resolve({ ok: true as const }),
  updateNotificationPreferences: () => Promise.resolve({ ok: true as const }),
  updateSessionAudioPreferences: () => Promise.resolve({ ok: true as const }),
  claude: {
    discover: (executable: string) =>
      Promise.resolve({
        executable,
        resolvedPath: null,
        found: false,
        version: null,
        capabilities: {
          helpAvailable: false,
          continueMostRecent: false,
          continueFlag: null,
          resumeSpecific: false,
          resumeFlag: null,
        },
        error: 'Desktop Claude discovery is not available.',
        checkedAt: new Date().toISOString(),
      }),
  },
  auth: {
    check: () =>
      Promise.resolve({
        status: 'notConfigured' as const,
        checkedAt: new Date().toISOString(),
        error: 'Desktop authentication checks are not available.',
      }),
    startRefresh: () =>
      Promise.resolve({ ok: false as const, error: 'Desktop authentication is not available.' }),
    write: () =>
      Promise.resolve({ ok: false as const, error: 'Desktop authentication is not available.' }),
    resize: () =>
      Promise.resolve({ ok: false as const, error: 'Desktop authentication is not available.' }),
    stopRefresh: () =>
      Promise.resolve({ ok: false as const, error: 'Desktop authentication is not available.' }),
    onOutput: () => () => undefined,
    onExit: () => () => undefined,
  },
  terminal: {
    startShell: () =>
      Promise.resolve({ ok: false as const, error: 'Desktop shell is not available.' }),
    startClaude: () =>
      Promise.resolve({ ok: false as const, error: 'Desktop shell is not available.' }),
    write: () => Promise.resolve({ ok: false as const, error: 'Desktop shell is not available.' }),
    resize: () => Promise.resolve({ ok: false as const, error: 'Desktop shell is not available.' }),
    stop: () => Promise.resolve({ ok: false as const, error: 'Desktop shell is not available.' }),
    getSnapshots: () => Promise.resolve([]),
    onOutput: () => () => undefined,
    onExit: () => () => undefined,
    onState: () => () => undefined,
  },
} satisfies CommandDeckBridge;

const soundAssetNames = [
  'session-ready.wav',
  'estimated-completion.wav',
  'attention.wav',
  'auth-connected.wav',
  'auth-disconnected.wav',
  'error.wav',
  'reload-all-complete.wav',
  'reload-all-warning.wav',
];

function getBridge() {
  return window.commandDeck ?? fallbackBridge;
}

function hasDesktopBridge() {
  return Boolean(window.commandDeck);
}

export function App() {
  const [appState, setAppState] = useState<AppStateSnapshot>(() => createPhaseOneState('loading'));
  const [focusedSessionId, setFocusedSessionId] = useState<SessionId>('session-1');
  const [focusMode, setFocusMode] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [authConsoleOpen, setAuthConsoleOpen] = useState(false);
  const activityClassifierRef = useRef(new ActivityClassifier());
  const audioServiceRef = useRef(new AudioService(defaultSoundRegistry));
  const notificationServiceRef = useRef(new DesktopNotificationService());
  const [claudeDiscovery, setClaudeDiscovery] = useState<ClaudeDiscoverySnapshot>(() => ({
    executable: 'claude',
    resolvedPath: null,
    found: false,
    version: null,
    capabilities: {
      helpAvailable: false,
      continueMostRecent: false,
      continueFlag: null,
      resumeSpecific: false,
      resumeFlag: null,
    },
    error: null,
    checkedAt: new Date().toISOString(),
  }));
  const bridge = useMemo(() => getBridge(), []);
  const appStateRef = useRef(appState);
  const focusedSessionIdRef = useRef(focusedSessionId);
  const startupAuthAttemptedRef = useRef(false);

  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  useEffect(() => {
    focusedSessionIdRef.current = focusedSessionId;
  }, [focusedSessionId]);

  useEffect(() => {
    activityClassifierRef.current.configure({
      minimumActivityMs: appState.settings.audio.minimumActivityMs,
    });
  }, [appState.settings.audio.minimumActivityMs]);

  const updateRuntime = useCallback(
    (
      sessionId: SessionId,
      patch: Partial<AppStateSnapshot['sessions'][number]['runtime']> & {
        processState?: ProcessState;
      },
    ) => {
      setAppState((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.configuration.id === sessionId
            ? {
                ...session,
                runtime: {
                  ...session.runtime,
                  ...patch,
                },
              }
            : session,
        ),
      }));
    },
    [],
  );

  const emitSemanticEvents = useCallback(
    (events: AudioEvent[], options: { sessionId?: SessionId; forceAudio?: boolean } = {}) => {
      if (events.length === 0) {
        return;
      }

      const current = appStateRef.current;
      const focusedId = focusedSessionIdRef.current;
      const session = options.sessionId
        ? current.sessions.find((candidate) => candidate.configuration.id === options.sessionId)
        : undefined;
      const appFocused = document.hasFocus();
      const relevantSessionWatched = Boolean(
        options.sessionId && appFocused && focusedId === options.sessionId,
      );

      events.forEach((event) => {
        void audioServiceRef.current.handleEvent(event, {
          preferences: current.settings.audio,
          sessionId: options.sessionId,
          sessionPreferences: session?.configuration.audio,
          focusedSessionId: focusedId,
          appFocused,
          relevantSessionWatched,
          force: options.forceAudio,
        });

        if (!options.forceAudio) {
          notificationServiceRef.current.notify(event, {
            preferences: current.settings.notifications,
            sessionId: options.sessionId,
            sessionName: session?.configuration.name,
            onFocusSession: setFocusedSessionId,
            onOpenAuthentication: () => setSettingsSection('authentication'),
          });
        }
      });
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    void bridge.getAppState().then((snapshot) => {
      if (!cancelled) {
        const checkedAt = new Date().toISOString();
        setAppState(
          markSameProjects({
            ...snapshot,
            diagnostics: [
              ...snapshot.diagnostics.filter((diagnostic) => diagnostic.id !== 'desktop-bridge'),
              {
                id: 'desktop-bridge',
                label: 'Desktop bridge',
                status: hasDesktopBridge() ? 'pass' : 'warn',
                detail: hasDesktopBridge()
                  ? 'Electron preload bridge is available.'
                  : 'Electron preload bridge is unavailable; desktop actions are disabled.',
                checkedAt,
              },
            ],
          }),
        );
        setFocusedSessionId(snapshot.settings.focusedSessionId);
        setFocusMode(snapshot.settings.focusMode);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bridge]);

  useEffect(() => {
    let cancelled = false;

    void bridge.claude.discover(appState.settings.claudeExecutable).then((discovery) => {
      if (cancelled) {
        return;
      }

      setClaudeDiscovery(discovery);
      setAppState((current) => ({
        ...current,
        diagnostics: [
          ...current.diagnostics.filter((diagnostic) => diagnostic.id !== 'claude-executable'),
          {
            id: 'claude-executable',
            label: 'Claude executable',
            status: discovery.found ? 'pass' : 'warn',
            detail: discovery.found
              ? `${discovery.executable} resolved${discovery.version ? `: ${discovery.version}` : ''}`
              : (discovery.error ?? 'Claude executable was not found.'),
            checkedAt: discovery.checkedAt,
          },
        ],
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [appState.settings.claudeExecutable, bridge]);

  useEffect(() => {
    const offState = bridge.terminal.onState(({ sessionId, snapshot }) => {
      const patch: Partial<AppStateSnapshot['sessions'][number]['runtime']> & {
        processState: ProcessState;
      } = {
        processState: snapshot.state,
        startedAt: snapshot.startedAt,
        statusMessage:
          snapshot.state === 'running'
            ? `${snapshot.executable} is attached to this bay.`
            : `Process state changed to ${snapshot.state}.`,
      };

      if (snapshot.lastOutputAt) {
        patch.lastOutputAt = snapshot.lastOutputAt;
      }

      updateRuntime(sessionId, patch);
    });

    const offOutput = bridge.terminal.onOutput(({ sessionId, data }) => {
      const activity = activityClassifierRef.current.recordOutput(sessionId, data);
      updateRuntime(sessionId, {
        processState: 'running',
        ...activityPatch(activity),
      });
      emitSemanticEvents(activity.events, { sessionId });
    });

    const offExit = bridge.terminal.onExit(({ sessionId, exitCode, crashed }) => {
      activityClassifierRef.current.clearSession(sessionId);
      updateRuntime(sessionId, {
        processState: crashed ? 'crashed' : 'stopped',
        activityState: 'idle',
        activityConfidence: 'high',
        exitCode,
        statusMessage: crashed ? 'Process exited unexpectedly.' : 'Process stopped.',
      });
    });

    void bridge.terminal.getSnapshots().then((snapshots) => {
      snapshots.forEach((snapshot) => {
        if (snapshot.sessionId) {
          const patch: Partial<AppStateSnapshot['sessions'][number]['runtime']> & {
            processState: ProcessState;
          } = {
            processState: snapshot.state,
            startedAt: snapshot.startedAt,
            statusMessage: `Recovered active ${snapshot.type} after renderer load.`,
          };

          if (snapshot.lastOutputAt) {
            patch.lastOutputAt = snapshot.lastOutputAt;
          }

          updateRuntime(snapshot.sessionId, patch);
        }
      });
    });

    return () => {
      offState();
      offOutput();
      offExit();
    };
  }, [bridge, emitSemanticEvents, updateRuntime]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const current = appStateRef.current;
      const activityUpdates = current.sessions
        .map((session) => ({
          sessionId: session.configuration.id,
          activity: activityClassifierRef.current.tick(
            session.configuration.id,
            session.runtime.processState,
          ),
        }))
        .filter(
          (update): update is { sessionId: SessionId; activity: ActivityClassification } =>
            update.activity !== null,
        );

      if (activityUpdates.length === 0) {
        return;
      }

      setAppState((latest) => ({
        ...latest,
        sessions: latest.sessions.map((session) => {
          const update = activityUpdates.find(
            (candidate) => candidate.sessionId === session.configuration.id,
          );
          return update
            ? {
                ...session,
                runtime: {
                  ...session.runtime,
                  ...activityPatch(update.activity),
                },
              }
            : session;
        }),
      }));

      activityUpdates.forEach(({ sessionId, activity }) => {
        emitSemanticEvents(activity.events, { sessionId });
      });
    }, 1500);

    return () => window.clearInterval(interval);
  }, [emitSemanticEvents]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;

      if (isTyping) {
        return;
      }

      if (event.altKey && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        const session = appState.sessions[Number(event.key) - 1];
        if (session) {
          setFocusedSessionId(session.configuration.id);
        }
      }

      if (event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFocusMode((current) => !current);
      }

      if (event.altKey && event.key.toLowerCase() === ',') {
        event.preventDefault();
        setSettingsSection('general');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [appState.sessions]);

  const focusedSession = useMemo(
    () =>
      appState.sessions.find((session) => session.configuration.id === focusedSessionId) ??
      appState.sessions[0],
    [appState.sessions, focusedSessionId],
  );

  async function updateAudioPreferences(preferences: AudioPreferences) {
    setAppState((current) => ({
      ...current,
      settings: {
        ...current.settings,
        audio: preferences,
      },
    }));

    const result = await bridge.updateAudioPreferences({ preferences });
    if (!result.ok) {
      addPreferenceDiagnostic('audio-preferences', 'Audio preferences', result.error);
    }
  }

  async function updateAuthConfiguration(auth: AuthConfiguration) {
    const authSummary =
      auth.provider === 'disabled'
        ? {
            status: 'notConfigured' as const,
            label: 'Authentication disabled',
            details: 'Authentication monitoring is disabled.',
          }
        : auth.checkExecutable.trim()
          ? {
              status:
                appStateRef.current.auth.status === 'notConfigured'
                  ? ('notConfigured' as const)
                  : appStateRef.current.auth.status,
              label:
                appStateRef.current.auth.status === 'notConfigured'
                  ? 'Ready to check'
                  : appStateRef.current.auth.label,
              details:
                appStateRef.current.auth.status === 'notConfigured'
                  ? 'Click Check Connection to validate credentials.'
                  : appStateRef.current.auth.details,
            }
          : {
              status: 'notConfigured' as const,
              label: 'AWS not configured',
              details: 'Configure a credential check command in Settings.',
            };

    setAppState((current) => ({
      ...current,
      settings: {
        ...current.settings,
        auth,
      },
      auth: {
        ...current.auth,
        provider: auth.provider,
        ...authSummary,
      },
    }));

    const result = await bridge.updateAuthConfiguration({ auth });
    if (!result.ok) {
      addPreferenceDiagnostic('auth-configuration', 'Authentication configuration', result.error);
    }
  }

  async function updateNotificationPreferences(preferences: NotificationPreferences) {
    setAppState((current) => ({
      ...current,
      settings: {
        ...current.settings,
        notifications: preferences,
      },
    }));

    const result = await bridge.updateNotificationPreferences({ preferences });
    if (!result.ok) {
      addPreferenceDiagnostic('notification-preferences', 'Notification preferences', result.error);
    }
  }

  async function updateSessionAudioPreferences(
    sessionId: SessionId,
    preferences: SessionAudioPreferences,
  ) {
    setAppState((current) => ({
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

    const result = await bridge.updateSessionAudioPreferences({ sessionId, preferences });
    if (!result.ok) {
      addPreferenceDiagnostic(
        'session-audio-preferences',
        'Session audio preferences',
        result.error,
      );
    }
  }

  async function openLogDirectory() {
    const result = await bridge.openLogDirectory();
    if (!result.ok) {
      addPreferenceDiagnostic('log-directory', 'Log directory', result.error);
    }
  }

  async function rerunDiagnostics() {
    const availableSoundAssets = await countAvailableSoundAssets();
    const now = new Date().toISOString();
    const checks = [
      {
        id: 'audio-assets',
        label: 'Audio assets',
        status: availableSoundAssets === soundAssetNames.length ? 'pass' : 'fail',
        detail: `${availableSoundAssets}/${soundAssetNames.length} generated WAV assets available.`,
        checkedAt: now,
      },
      {
        id: 'notification-support',
        label: 'Notification support',
        status: typeof Notification === 'undefined' ? 'warn' : 'pass',
        detail:
          typeof Notification === 'undefined'
            ? 'Native notification API is unavailable in this renderer.'
            : `Notification permission is ${Notification.permission}.`,
        checkedAt: now,
      },
      {
        id: 'clipboard-support',
        label: 'Clipboard support',
        status: navigator.clipboard ? 'pass' : 'warn',
        detail: navigator.clipboard
          ? 'Clipboard API is available for sanitized report copy.'
          : 'Clipboard API is unavailable; report copy may not work.',
        checkedAt: now,
      },
      {
        id: 'persistence-boundaries',
        label: 'Persistence boundaries',
        status: 'pass',
        detail: 'Settings store excludes terminal transcripts, terminal input, and auth output.',
        checkedAt: now,
      },
    ] satisfies AppStateSnapshot['diagnostics'];

    setAppState((current) => ({
      ...current,
      diagnostics: [
        ...current.diagnostics.filter(
          (diagnostic) => !checks.some((check) => check.id === diagnostic.id),
        ),
        ...checks,
      ],
    }));
  }

  function addPreferenceDiagnostic(id: string, label: string, error: string) {
    setAppState((current) => ({
      ...current,
      diagnostics: [
        ...current.diagnostics.filter((diagnostic) => diagnostic.id !== id),
        {
          id,
          label,
          status: 'warn',
          detail: error,
          checkedAt: new Date().toISOString(),
        },
      ],
    }));
  }

  async function startShell(sessionId: SessionId) {
    const session = appState.sessions.find((candidate) => candidate.configuration.id === sessionId);
    if (!session) {
      return;
    }

    updateRuntime(sessionId, {
      processState: 'starting',
      statusMessage: 'Starting shell PTY.',
      activityState: 'unknown',
      attention: false,
    });

    const result = await bridge.terminal.startShell({
      sessionId,
      workingDirectory: session.configuration.workingDirectory,
      cols: 100,
      rows: 28,
    });

    if (!result.ok) {
      updateRuntime(sessionId, {
        processState: 'error',
        statusMessage: result.error,
        activityState: 'unknown',
        attention: true,
      });
    }
  }

  async function launchClaude(
    sessionId: SessionId,
    launchMode: 'new' | 'continueMostRecent',
  ): Promise<boolean> {
    const session = appState.sessions.find((candidate) => candidate.configuration.id === sessionId);
    if (!session) {
      return false;
    }

    const command = buildClaudeCommand({
      executable: session.configuration.executable || appState.settings.claudeExecutable,
      baseArgs: session.configuration.args.length
        ? session.configuration.args
        : appState.settings.claudeBaseArgs,
      launchMode,
      capabilities: claudeDiscovery.capabilities,
    });

    if (command.strategy === 'freshFallback' && launchMode !== 'new') {
      const confirmed = window.confirm(
        'The installed Claude CLI does not report a supported continuation flag. Use a fresh restart instead?',
      );
      if (!confirmed) {
        updateRuntime(sessionId, {
          processState: 'stopped',
          statusMessage: 'Reload & Continue cancelled because continuation is unsupported.',
        });
        return false;
      }
    }

    updateRuntime(sessionId, {
      processState: 'starting',
      statusMessage:
        command.strategy === 'continueMostRecent'
          ? 'Starting Claude Code with continue-most-recent strategy.'
          : 'Starting Claude Code PTY.',
      activityState: 'unknown',
      attention: false,
    });

    const result = await bridge.terminal.startClaude({
      sessionId,
      workingDirectory: session.configuration.workingDirectory,
      executable: command.executable,
      args: command.args,
      cols: 100,
      rows: 28,
    });

    if (!result.ok) {
      updateRuntime(sessionId, {
        processState: 'error',
        statusMessage: result.error,
        activityState: 'unknown',
        attention: true,
      });
      emitSemanticEvents(['session.reload_failed'], { sessionId });
      return false;
    }

    if (result.ok && command.warnings.length > 0) {
      updateRuntime(sessionId, {
        statusMessage: command.warnings.join(' '),
      });
    }

    if (launchMode === 'new') {
      emitSemanticEvents(['session.ready'], { sessionId });
    }

    return true;
  }

  async function reloadContinue(
    sessionId: SessionId,
    options: { skipConfirm?: boolean; emitSessionEvent?: boolean } = {},
  ): Promise<boolean> {
    const session = appState.sessions.find((candidate) => candidate.configuration.id === sessionId);
    if (!session) {
      return false;
    }

    if (
      !options.skipConfirm &&
      session.runtime.sameProject &&
      !claudeDiscovery.capabilities.resumeSpecific
    ) {
      const confirmed = window.confirm(
        'This directory is used by more than one bay. The CLI may continue the most recent conversation for the directory rather than this exact bay. Continue?',
      );
      if (!confirmed) {
        return false;
      }
    }

    if (!options.skipConfirm && isBusy(session.runtime.activityState)) {
      const confirmed = window.confirm(
        'This session may be busy or awaiting input. Restart it now?',
      );
      if (!confirmed) {
        return false;
      }
    }

    await stopForRestart(sessionId);
    await delay(350);
    const launched = await launchClaude(sessionId, 'continueMostRecent');
    if (launched && options.emitSessionEvent !== false) {
      emitSemanticEvents(['session.reload_completed'], { sessionId });
    }
    return launched;
  }

  async function freshRestart(
    sessionId: SessionId,
    options: { skipConfirm?: boolean } = {},
  ): Promise<boolean> {
    const session = appState.sessions.find((candidate) => candidate.configuration.id === sessionId);
    if (!session) {
      return false;
    }

    if (!options.skipConfirm && isBusy(session.runtime.activityState)) {
      const confirmed = window.confirm(
        'This session may be busy or awaiting input. Start a fresh conversation now?',
      );
      if (!confirmed) {
        return false;
      }
    }

    await stopForRestart(sessionId);
    await delay(350);
    return launchClaude(sessionId, 'new');
  }

  async function reloadAll() {
    const candidates = appState.sessions.filter(
      (session) => session.configuration.workingDirectory,
    );
    if (candidates.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Reload & Continue ${candidates.length} configured session${candidates.length === 1 ? '' : 's'} in sequence?`,
    );
    if (!confirmed) {
      return;
    }

    let failures = 0;
    for (const session of candidates) {
      const ok = await reloadContinue(session.configuration.id, {
        skipConfirm: true,
        emitSessionEvent: false,
      });
      if (!ok) {
        failures += 1;
      }
      await delay(450);
    }

    emitSemanticEvents([failures === 0 ? 'reload_all.completed' : 'reload_all.partially_failed']);
  }

  async function stopForRestart(sessionId: SessionId) {
    await bridge.terminal.stop({ sessionId });
    updateRuntime(sessionId, {
      processState: 'restarting',
      statusMessage: 'Restarting Claude Code so startup-loaded configuration can be reread.',
    });
  }

  async function selectDirectory(sessionId: SessionId) {
    const result = await bridge.selectDirectory({ sessionId });
    if (!result.ok) {
      if (!result.cancelled) {
        updateRuntime(sessionId, {
          processState: 'error',
          statusMessage: result.error,
          attention: true,
        });
      }
      return;
    }

    setAppState((current) =>
      markSameProjects({
        ...current,
        sessions: current.sessions.map((session) =>
          session.configuration.id === sessionId
            ? {
                ...session,
                configuration: {
                  ...session.configuration,
                  workingDirectory: result.directory,
                  name:
                    session.configuration.name === 'Unassigned Bay'
                      ? directoryLeaf(result.directory)
                      : session.configuration.name,
                },
                runtime: {
                  ...session.runtime,
                  processState: 'stopped',
                  activityState: 'idle',
                  statusMessage: 'Configured and stopped.',
                  attention: false,
                },
              }
            : session,
        ),
      }),
    );
  }

  async function stopSession(sessionId: SessionId) {
    updateRuntime(sessionId, {
      processState: 'stopping',
      statusMessage: 'Stopping PTY process.',
    });

    const result = await bridge.terminal.stop({ sessionId });
    if (!result.ok) {
      updateRuntime(sessionId, {
        processState: 'error',
        statusMessage: result.error,
        attention: true,
      });
    }
  }

  const checkConnection = useCallback(async (): Promise<AuthCheckResult> => {
    const previousStatus = appStateRef.current.auth.status;
    setAppState((current) => ({
      ...current,
      auth: {
        ...current.auth,
        status: 'checking',
        label: 'Checking',
        details: 'Running credential check command.',
      },
    }));

    const result = await bridge.auth.check();
    setAppState((current) => ({
      ...current,
      auth: {
        ...current.auth,
        status: result.status,
        label: authLabel(result.status),
        details:
          result.error ?? formatSafeIdentity(result.safeIdentity) ?? 'Credential check completed.',
        safeIdentity: result.safeIdentity,
        lastCheckedAt: result.checkedAt,
        lastSuccessfulCheckAt:
          result.status === 'connected' ? result.checkedAt : current.auth.lastSuccessfulCheckAt,
      },
    }));

    const event = authTransitionEvent(previousStatus, result.status);
    if (event) {
      emitSemanticEvents([event]);
    }

    return result;
  }, [bridge, emitSemanticEvents]);

  const connectAuthentication = useCallback(async () => {
    if (appStateRef.current.auth.status === 'connected') {
      await checkConnection();
      return;
    }

    setAppState((current) => ({
      ...current,
      auth: {
        ...current.auth,
        status: 'refreshing',
        label: 'Refreshing',
        details: 'Starting credential refresh.',
      },
    }));

    const result = await bridge.auth.startRefresh();
    if (!result.ok) {
      setAppState((current) => ({
        ...current,
        auth: {
          ...current.auth,
          status: 'error',
          label: 'Authentication error',
          details: result.error,
        },
      }));
    }
  }, [bridge, checkConnection]);

  useEffect(() => {
    const auth = appState.settings.auth;
    if (
      startupAuthAttemptedRef.current ||
      !auth.startupChecksEnabled ||
      auth.provider === 'disabled' ||
      !auth.checkExecutable.trim()
    ) {
      return;
    }

    startupAuthAttemptedRef.current = true;
    void checkConnection().then((result) => {
      if (
        result.status === 'connected' ||
        !appStateRef.current.settings.auth.refreshExecutable.trim()
      ) {
        return;
      }

      void connectAuthentication();
    });
  }, [appState.settings.auth, checkConnection, connectAuthentication]);

  useEffect(() => {
    return bridge.auth.onExit((event) => {
      if (event.exitCode === 0) {
        void checkConnection();
        return;
      }

      setAppState((current) => ({
        ...current,
        auth: {
          ...current.auth,
          status: 'disconnected',
          label: 'Disconnected',
          details: `Refresh exited with code ${event.exitCode ?? 'unknown'}.`,
        },
      }));
    });
  }, [bridge, checkConnection]);

  return (
    <div className="app-shell">
      <CommandBar
        appVersion={appState.appVersion}
        auth={appState.auth}
        sessions={appState.sessions}
        audio={appState.settings.audio}
        onOpenSettings={() => setSettingsSection('general')}
        onToggleFocusMode={() => setFocusMode((current) => !current)}
        onReloadAll={() => {
          void reloadAll();
        }}
        onAuthAction={() => {
          void connectAuthentication();
        }}
        onToggleAudio={() => {
          void updateAudioPreferences({
            ...appState.settings.audio,
            masterEnabled: !appState.settings.audio.masterEnabled,
          });
        }}
      />
      <main className="deck-workspace" aria-label="Claude session deck">
        <SessionGrid
          sessions={appState.sessions}
          focusedSessionId={focusedSession?.configuration.id ?? focusedSessionId}
          focusMode={focusMode}
          onFocusSession={setFocusedSessionId}
          onToggleFocusMode={() => setFocusMode((current) => !current)}
          onOpenSettings={() => setSettingsSection('claude')}
          onStartShell={(sessionId) => {
            void startShell(sessionId);
          }}
          onStartClaude={(sessionId) => {
            void launchClaude(sessionId, 'new');
          }}
          onReloadContinue={(sessionId) => {
            void reloadContinue(sessionId);
          }}
          onFreshRestart={(sessionId) => {
            void freshRestart(sessionId);
          }}
          onSelectDirectory={(sessionId) => {
            void selectDirectory(sessionId);
          }}
          onStopSession={(sessionId) => {
            void stopSession(sessionId);
          }}
          terminalBridge={bridge.terminal}
        />
      </main>
      <footer className="bottom-status" aria-label="Application status">
        <span>{focusedSession?.configuration.name ?? 'No focused session'}</span>
        <span>Alt+1-4 focus bays</span>
        <span>Alt+F focus mode</span>
        <span>v{appState.appVersion}</span>
      </footer>
      <SettingsPanel
        appState={appState}
        section={settingsSection}
        onSelectSection={setSettingsSection}
        onClose={() => setSettingsSection(null)}
        onUpdateAuthConfiguration={(auth) => {
          void updateAuthConfiguration(auth);
        }}
        onUpdateAudioPreferences={(preferences) => {
          void updateAudioPreferences(preferences);
        }}
        onUpdateNotificationPreferences={(preferences) => {
          void updateNotificationPreferences(preferences);
        }}
        onUpdateSessionAudioPreferences={(sessionId, preferences) => {
          void updateSessionAudioPreferences(sessionId, preferences);
        }}
        onTestAudio={(event) => {
          emitSemanticEvents([event], { forceAudio: true });
        }}
        onRerunDiagnostics={() => {
          void rerunDiagnostics();
        }}
        onOpenLogDirectory={() => {
          void openLogDirectory();
        }}
      />
      <AuthConsole
        open={authConsoleOpen}
        authBridge={bridge.auth}
        onClose={() => setAuthConsoleOpen(false)}
      />
    </div>
  );
}

function markSameProjects(snapshot: AppStateSnapshot): AppStateSnapshot {
  const counts = new Map<string, number>();
  snapshot.sessions.forEach((session) => {
    const normalized = normalizeDirectory(session.configuration.workingDirectory);
    if (normalized) {
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  });

  return {
    ...snapshot,
    sessions: snapshot.sessions.map((session) => {
      const normalized = normalizeDirectory(session.configuration.workingDirectory);
      return {
        ...session,
        runtime: {
          ...session.runtime,
          sameProject: normalized ? (counts.get(normalized) ?? 0) > 1 : false,
        },
      };
    }),
  };
}

function activityPatch(activity: ActivityClassification) {
  const patch: Partial<AppStateSnapshot['sessions'][number]['runtime']> = {
    activityState: activity.activityState,
    activityConfidence: activity.confidence,
    attention: activity.attention,
    statusMessage: activity.statusMessage,
  };

  if (activity.lastOutputAt) {
    patch.lastOutputAt = activity.lastOutputAt;
  }

  return patch;
}

function authTransitionEvent(previous: AuthStatus, next: AuthStatus): AudioEvent | null {
  if (
    next === 'connected' &&
    ['disconnected', 'error', 'refreshing', 'expiringSoon'].includes(previous)
  ) {
    return 'auth.connected';
  }

  if (
    previous === 'connected' &&
    (next === 'disconnected' || next === 'error' || next === 'expiringSoon')
  ) {
    return 'auth.disconnected';
  }

  return null;
}

async function countAvailableSoundAssets(): Promise<number> {
  const checks = await Promise.all(
    soundAssetNames.map(async (asset) => {
      try {
        const response = await fetch(`/sounds/${asset}`, { method: 'HEAD' });
        return response.ok;
      } catch {
        return false;
      }
    }),
  );

  return checks.filter(Boolean).length;
}

function normalizeDirectory(directory: string): string {
  return directory.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function directoryLeaf(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? value;
}

function isBusy(activityState: AppStateSnapshot['sessions'][number]['runtime']['activityState']) {
  return (
    activityState === 'active' ||
    activityState === 'likelyAwaitingInput' ||
    activityState === 'possiblePermissionPrompt'
  );
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function authLabel(status: AppStateSnapshot['auth']['status']) {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'checking':
      return 'Checking';
    case 'disconnected':
      return 'Disconnected';
    case 'error':
      return 'Authentication error';
    case 'refreshing':
      return 'Refreshing';
    case 'expiringSoon':
      return 'Expiring soon';
    case 'notConfigured':
      return 'Not configured';
  }
}

function formatSafeIdentity(identity: AppStateSnapshot['auth']['safeIdentity']) {
  if (!identity) {
    return null;
  }

  const text = [identity.accountId, identity.arn, identity.userId].filter(Boolean).join(' | ');
  return text || null;
}
