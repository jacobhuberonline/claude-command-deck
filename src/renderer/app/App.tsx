import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createClaudeSessionName,
  createDefaultRuntimeState,
  createPhaseOneState,
} from '../../shared/domain/defaults';
import type {
  AppStateSnapshot,
  AuthCheckResult,
  AuthConfiguration,
  AuthProvider,
  AuthStatus,
  AudioEvent,
  ClaudeDiscoverySnapshot,
  ProcessState,
  SessionConfiguration,
  SessionId,
  SessionLaunchMode,
  ShellKind,
  ShellOption,
  SettingsSection,
} from '../../shared/domain/types';
import type { CommandDeckBridge, CommandResult } from '../../shared/ipc/contracts';
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
import { getTerminalSize } from '../services/terminal/TerminalSizeRegistry';
import { TerminalReplayStore } from '../services/terminal/TerminalReplayStore';
import {
  parseClaudeUsageOutput,
  type ClaudeUsageSnapshot,
} from '../services/usage/ClaudeUsageParser';
import { invokeCommand, useSettingsPersistence } from '../services/settings/SettingsPersistence';

const fallbackShellOptions: ShellOption[] = [
  { kind: 'auto', label: 'Automatic (recommended)', available: true },
];

const fallbackBridge = {
  getAppState: () => Promise.resolve(createPhaseOneState('browser-preview')),
  onShortcut: () => () => undefined,
  addSession: () =>
    Promise.resolve({
      ok: false as const,
      error: 'Desktop directory picker is not available.',
      cancelled: true,
    }),
  removeSession: () =>
    Promise.resolve({ ok: false as const, error: 'Desktop session storage is not available.' }),
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
  updateClaudeConfiguration: () => Promise.resolve({ ok: true as const }),
  updateShellConfiguration: () => Promise.resolve({ ok: true as const }),
  updateDeckPreferences: () => Promise.resolve({ ok: true as const }),
  updateNotificationPreferences: () => Promise.resolve({ ok: true as const }),
  updateSessionConfiguration: () => Promise.resolve({ ok: true as const }),
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
          nameSession: false,
          nameFlag: null,
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
    getShellOptions: () => Promise.resolve([...fallbackShellOptions]),
    startShell: () =>
      Promise.resolve({ ok: false as const, error: 'Desktop shell is not available.' }),
    prepareClaude: () =>
      Promise.resolve({ ok: false as const, error: 'Desktop Claude is not available.' }),
    startClaude: () =>
      Promise.resolve({ ok: false as const, error: 'Desktop shell is not available.' }),
    write: () => Promise.resolve({ ok: false as const, error: 'Desktop shell is not available.' }),
    resize: () => Promise.resolve({ ok: false as const, error: 'Desktop shell is not available.' }),
    stop: () => Promise.resolve({ ok: false as const, error: 'Desktop shell is not available.' }),
    getSnapshots: () => Promise.resolve([]),
    onOutput: () => () => undefined,
    onExit: () => () => undefined,
    onState: () => () => undefined,
    onConversationBinding: () => () => undefined,
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

// Keep usage tracking disabled until the UX and data handling are intentionally reviewed.
const usageTrackerEnabled = false;
const usageStorageKey = 'claude-command-deck:last-usage';
const minimumAuthCheckIntervalSeconds = 30;
const authFailureConfirmationDelayMs = 350;
const maxTerminalReplayBytes = 1024 * 1024;

interface PreparedClaudeLaunch {
  sessionId: SessionId;
  launchMode: Exclude<SessionLaunchMode, 'custom'>;
  planId: string;
  strategy: 'new' | 'continueMostRecent' | 'resumeSpecific' | 'freshFallback';
  allowFreshFallback: boolean;
  allowAmbiguousContinue: boolean;
  hasActiveProcess: boolean;
}

function getBridge() {
  return window.commandDeck ?? fallbackBridge;
}

function hasDesktopBridge() {
  return Boolean(window.commandDeck);
}

function loadStoredUsage(): ClaudeUsageSnapshot | null {
  try {
    const raw = window.localStorage.getItem(usageStorageKey);
    return raw ? (JSON.parse(raw) as ClaudeUsageSnapshot) : null;
  } catch {
    return null;
  }
}

export function App() {
  const [appState, setAppState] = useState<AppStateSnapshot>(() => createPhaseOneState('loading'));
  const [appStateLoaded, setAppStateLoaded] = useState(false);
  const [focusedSessionId, setFocusedSessionId] = useState<SessionId>('session-1');
  const [terminalFocusRequest, setTerminalFocusRequest] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [authConsoleOpen, setAuthConsoleOpen] = useState(false);
  const [shellOptions, setShellOptions] = useState<ShellOption[]>(fallbackShellOptions);
  const [usageSnapshot, setUsageSnapshot] = useState<ClaudeUsageSnapshot | null>(() =>
    usageTrackerEnabled && typeof window !== 'undefined' ? loadStoredUsage() : null,
  );
  const activityClassifierRef = useRef(new ActivityClassifier());
  const audioServiceRef = useRef(new AudioService(defaultSoundRegistry));
  const notificationServiceRef = useRef(new DesktopNotificationService());
  const terminalReplayStore = useMemo(() => new TerminalReplayStore(maxTerminalReplayBytes), []);
  const activeProcessIdsRef = useRef(new Map<SessionId, string>());
  const supersededProcessIdsRef = useRef(new Set<string>());
  const processStartPendingRef = useRef(new Set<SessionId>());
  const awaitingClaudeReadyRef = useRef(new Set<SessionId>());
  const sessionOperationRef = useRef(new Set<SessionId>());
  const addSessionInFlightRef = useRef(false);
  const [, setClaudeDiscovery] = useState<ClaudeDiscoverySnapshot>(() => ({
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
      nameSession: false,
      nameFlag: null,
    },
    error: null,
    checkedAt: new Date().toISOString(),
  }));
  const bridge = useMemo(() => getBridge(), []);
  const appStateRef = useRef(appState);
  const focusedSessionIdRef = useRef(focusedSessionId);
  const startupAuthAttemptedRef = useRef(false);
  const authCheckGenerationRef = useRef(0);
  const authCheckInFlightRef = useRef<Promise<AuthCheckResult> | null>(null);
  const authRefreshStartInFlightRef = useRef(false);
  const appStateLoadedRef = useRef(false);

  const addPreferenceDiagnostic = useCallback((id: string, label: string, error: string) => {
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
  }, []);
  const {
    updateAudioPreferences,
    updateAuthConfiguration,
    updateClaudeConfiguration,
    updateShellConfiguration,
    updateNotificationPreferences,
    updateSessionAudioPreferences,
    updateSessionConfiguration,
  } = useSettingsPersistence({
    bridge,
    stateRef: appStateRef,
    setState: setAppState,
    addDiagnostic: addPreferenceDiagnostic,
    authCheckGenerationRef,
    authCheckInFlightRef,
    normalizeSessionConfiguration,
    markSameProjects,
  });

  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  useEffect(() => {
    focusedSessionIdRef.current = focusedSessionId;
  }, [focusedSessionId]);

  useEffect(() => {
    if (
      !appStateLoadedRef.current ||
      !appState.settings.sessions.some((session) => session.id === focusedSessionId)
    ) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      void invokeCommand(
        () => bridge.updateDeckPreferences({ focusedSessionId, focusMode }),
        'Unable to save the selected session and navigator layout.',
      ).then((result) => {
        if (!result.ok) {
          addPreferenceDiagnostic('deck-preferences', 'Deck preferences', result.error);
        }
      });
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [addPreferenceDiagnostic, appState.settings.sessions, bridge, focusMode, focusedSessionId]);

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

  const applyConversationBinding = useCallback(
    (sessionId: SessionId, claudeSessionName: string | null) => {
      setAppState((current) =>
        markSameProjects({
          ...current,
          settings: {
            ...current.settings,
            sessions: current.settings.sessions.map((configuration) =>
              configuration.id === sessionId
                ? {
                    ...configuration,
                    claudeSessionName: claudeSessionName ?? '',
                    hasNamedConversation: claudeSessionName !== null,
                    launchMode: 'continueMostRecent',
                  }
                : configuration,
            ),
          },
          sessions: current.sessions.map((session) =>
            session.configuration.id === sessionId
              ? {
                  ...session,
                  configuration: {
                    ...session.configuration,
                    claudeSessionName: claudeSessionName ?? '',
                    hasNamedConversation: claudeSessionName !== null,
                    launchMode: 'continueMostRecent',
                  },
                }
              : session,
          ),
        }),
      );
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

  const focusAdjacentSession = useCallback((direction: 1 | -1) => {
    const sessions = appStateRef.current.sessions;
    if (sessions.length === 0) {
      return;
    }

    const currentIndex = sessions.findIndex(
      (session) => session.configuration.id === focusedSessionIdRef.current,
    );
    const nextIndex = (Math.max(0, currentIndex) + direction + sessions.length) % sessions.length;
    const nextSession = sessions[nextIndex];
    if (nextSession) {
      setFocusedSessionId(nextSession.configuration.id);
    }
  }, []);

  const focusSessionSearch = useCallback(() => {
    setFocusMode(false);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('.session-search input')?.focus();
    });
  }, []);

  const addSession = useCallback(async () => {
    if (addSessionInFlightRef.current) {
      return;
    }

    addSessionInFlightRef.current = true;
    try {
      const result = await bridge.addSession();
      if (!result.ok) {
        if (!result.cancelled) {
          addPreferenceDiagnostic('add-session', 'Add session', result.error);
        }
        return;
      }

      const runtime = {
        ...createDefaultRuntimeState('stopped'),
        activityState: 'idle' as const,
        statusMessage: 'Configured and stopped.',
      };
      setAppState((current) =>
        markSameProjects({
          ...current,
          settings: {
            ...current.settings,
            sessions: [...current.settings.sessions, result.configuration],
            focusedSessionId: result.configuration.id,
          },
          sessions: [...current.sessions, { configuration: result.configuration, runtime }],
        }),
      );
      setFocusedSessionId(result.configuration.id);
      setFocusMode(false);
    } finally {
      addSessionInFlightRef.current = false;
    }
  }, [addPreferenceDiagnostic, bridge]);

  useEffect(() => {
    if (!appStateLoaded) {
      return undefined;
    }

    let cancelled = false;
    void bridge.terminal
      .getShellOptions()
      .then((options) => {
        if (!cancelled) {
          setShellOptions(options.length > 0 ? options : fallbackShellOptions);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setShellOptions(fallbackShellOptions);
          addPreferenceDiagnostic(
            'shell-discovery',
            'Shell discovery',
            error instanceof Error ? error.message : 'Unable to discover installed shells.',
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [addPreferenceDiagnostic, appStateLoaded, bridge]);

  useEffect(() => {
    let cancelled = false;

    void bridge
      .getAppState()
      .then((snapshot) => {
        if (!cancelled) {
          const checkedAt = new Date().toISOString();
          appStateLoadedRef.current = true;
          const loadedState = markSameProjects({
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
          });
          appStateRef.current = loadedState;
          setAppState(loadedState);
          setAppStateLoaded(true);
          setFocusedSessionId(snapshot.settings.focusedSessionId);
          setFocusMode(snapshot.settings.focusMode);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        appStateLoadedRef.current = true;
        setAppState((current) => ({
          ...current,
          diagnostics: [
            ...current.diagnostics,
            {
              id: 'settings-load',
              label: 'Settings load',
              status: 'fail',
              detail: error instanceof Error ? error.message : 'Unable to load saved settings.',
              checkedAt: new Date().toISOString(),
            },
          ],
        }));
        setAppStateLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [bridge]);

  useEffect(() => {
    let cancelled = false;

    const timeout = window.setTimeout(() => {
      void bridge.claude
        .discover(appState.settings.claudeExecutable)
        .then((discovery) => {
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
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            addPreferenceDiagnostic(
              'claude-executable',
              'Claude executable',
              error instanceof Error ? error.message : 'Unable to inspect the Claude executable.',
            );
          }
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [addPreferenceDiagnostic, appState.settings.claudeExecutable, bridge]);

  useEffect(() => {
    const offState = bridge.terminal.onState(({ sessionId, snapshot }) => {
      if (supersededProcessIdsRef.current.has(snapshot.id)) {
        return;
      }
      const activeProcessId = activeProcessIdsRef.current.get(sessionId);
      if (activeProcessId && activeProcessId !== snapshot.id) {
        if (
          !processStartPendingRef.current.has(sessionId) ||
          (snapshot.state !== 'starting' && snapshot.state !== 'running')
        ) {
          supersededProcessIdsRef.current.add(snapshot.id);
          return;
        }
        supersededProcessIdsRef.current.add(activeProcessId);
      }
      processStartPendingRef.current.delete(sessionId);
      activeProcessIdsRef.current.set(sessionId, snapshot.id);
      const patch: Partial<AppStateSnapshot['sessions'][number]['runtime']> & {
        processState: ProcessState;
      } = {
        processState: snapshot.state,
        processId: snapshot.id,
        processType: snapshot.type,
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

    const offOutput = bridge.terminal.onOutput(({ sessionId, processId, data }) => {
      if (supersededProcessIdsRef.current.has(processId)) {
        return;
      }
      const activeProcessId = activeProcessIdsRef.current.get(sessionId);
      if (activeProcessId && activeProcessId !== processId) {
        supersededProcessIdsRef.current.add(processId);
        return;
      }
      activeProcessIdsRef.current.set(sessionId, processId);
      terminalReplayStore.append(sessionId, data);
      if (usageTrackerEnabled) {
        const usage = parseClaudeUsageOutput(data);
        if (usage) {
          setUsageSnapshot(usage);
          window.localStorage.setItem(usageStorageKey, JSON.stringify(usage));
        }
      }

      const activity = activityClassifierRef.current.recordOutput(sessionId, data);
      updateRuntime(sessionId, {
        processState: 'running',
        processId,
        ...activityPatch(activity),
      });
      emitSemanticEvents(activity.events, { sessionId });
      if (awaitingClaudeReadyRef.current.delete(sessionId)) {
        emitSemanticEvents(['session.ready'], { sessionId });
      }
    });

    const offExit = bridge.terminal.onExit(({ sessionId, processId, exitCode, crashed }) => {
      if (supersededProcessIdsRef.current.has(processId)) {
        return;
      }
      const activeProcessId = activeProcessIdsRef.current.get(sessionId);
      if (activeProcessId && activeProcessId !== processId) {
        supersededProcessIdsRef.current.add(processId);
        return;
      }
      supersededProcessIdsRef.current.add(processId);
      activeProcessIdsRef.current.delete(sessionId);
      activityClassifierRef.current.clearSession(sessionId);
      awaitingClaudeReadyRef.current.delete(sessionId);
      terminalReplayStore.append(
        sessionId,
        crashed
          ? `\r\n\x1b[31mLOCAL SYSTEM\x1b[0m Process exited unexpectedly with code ${exitCode ?? 'unknown'}.\r\n`
          : '\r\n\x1b[33mLOCAL SYSTEM\x1b[0m Process stopped.\r\n',
      );
      updateRuntime(sessionId, {
        processState: crashed ? 'crashed' : 'stopped',
        processId: undefined,
        processType: undefined,
        activityState: 'idle',
        activityConfidence: 'high',
        exitCode,
        statusMessage: crashed ? 'Process exited unexpectedly.' : 'Process stopped.',
      });
    });
    const offConversationBinding = bridge.terminal.onConversationBinding(
      ({ sessionId, processId, claudeSessionName }) => {
        if (supersededProcessIdsRef.current.has(processId)) {
          return;
        }
        const activeProcessId = activeProcessIdsRef.current.get(sessionId);
        if (activeProcessId && activeProcessId !== processId) {
          supersededProcessIdsRef.current.add(processId);
          return;
        }
        applyConversationBinding(sessionId, claudeSessionName);
      },
    );

    return () => {
      offState();
      offOutput();
      offExit();
      offConversationBinding();
    };
  }, [applyConversationBinding, bridge, emitSemanticEvents, terminalReplayStore, updateRuntime]);

  useEffect(
    () =>
      bridge.onShortcut((event) => {
        if (event.shortcut === 'addSession') {
          void addSession();
        } else {
          focusSessionSearch();
        }
      }),
    [addSession, bridge, focusSessionSearch],
  );

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
      if (event.repeat || settingsSection !== null || authConsoleOpen) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isHtmlTarget = target instanceof HTMLElement;
      const isTerminalInput = isHtmlTarget && target.closest('.xterm') !== null;
      const isTyping =
        !isTerminalInput &&
        isHtmlTarget &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable === true);

      if (isTyping) {
        return;
      }

      const shortcutIndex = sessionShortcutIndex(event);
      if (shortcutIndex !== null) {
        event.preventDefault();
        const session = appState.sessions[shortcutIndex];
        if (session) {
          setFocusedSessionId(session.configuration.id);
        }
      }

      if (isAltShortcut(event, 'f', 'KeyF')) {
        event.preventDefault();
        setFocusMode((current) => !current);
      }

      if (isAltShortcut(event, 'n', 'KeyN')) {
        event.preventDefault();
        void addSession();
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        (event.key.toLowerCase() === 'p' || event.code === 'KeyP')
      ) {
        event.preventDefault();
        focusSessionSearch();
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        (event.key === 'PageUp' || event.key === 'PageDown')
      ) {
        event.preventDefault();
        focusAdjacentSession(event.key === 'PageDown' ? 1 : -1);
      }

      if (isAltShortcut(event, 'a', 'KeyA')) {
        const attentionSession = nextAttentionSession(
          appState.sessions,
          focusedSessionIdRef.current,
        );
        if (attentionSession) {
          event.preventDefault();
          setFocusedSessionId(attentionSession.configuration.id);
        }
      }

      if (isAltShortcut(event, ',', 'Comma')) {
        event.preventDefault();
        setSettingsSection('general');
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [
    addSession,
    appState.sessions,
    authConsoleOpen,
    focusAdjacentSession,
    focusSessionSearch,
    settingsSection,
  ]);

  const focusedSession = useMemo(
    () =>
      appState.sessions.find((session) => session.configuration.id === focusedSessionId) ??
      appState.sessions[0],
    [appState.sessions, focusedSessionId],
  );

  async function removeSession(sessionId: SessionId) {
    const session = appStateRef.current.sessions.find(
      (candidate) => candidate.configuration.id === sessionId,
    );
    if (!session) {
      return;
    }
    if (sessionOperationRef.current.has(sessionId)) {
      addPreferenceDiagnostic(
        'remove-session',
        'Remove session',
        'Wait for the current session operation to finish before removing it.',
      );
      return;
    }

    const confirmed = window.confirm(
      `Remove "${session.configuration.name}" from the deck? Claude conversation history on disk is not deleted.`,
    );
    if (!confirmed) {
      return;
    }

    const result = await bridge.removeSession({ sessionId });
    if (!result.ok) {
      addPreferenceDiagnostic('remove-session', 'Remove session', result.error);
      return;
    }

    terminalReplayStore.clear(sessionId);
    const activeProcessId = activeProcessIdsRef.current.get(sessionId);
    if (activeProcessId) {
      supersededProcessIdsRef.current.add(activeProcessId);
    }
    activeProcessIdsRef.current.delete(sessionId);
    processStartPendingRef.current.delete(sessionId);
    const remainingSessions = appStateRef.current.sessions.filter(
      (candidate) => candidate.configuration.id !== sessionId,
    );
    const nextFocusedId =
      focusedSessionIdRef.current === sessionId
        ? (remainingSessions[0]?.configuration.id ?? focusedSessionIdRef.current)
        : focusedSessionIdRef.current;
    setFocusedSessionId(nextFocusedId);
    setAppState((current) =>
      markSameProjects({
        ...current,
        sessions: current.sessions.filter((candidate) => candidate.configuration.id !== sessionId),
        settings: {
          ...current.settings,
          sessions: current.settings.sessions.filter((candidate) => candidate.id !== sessionId),
          focusedSessionId: nextFocusedId,
        },
      }),
    );
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

  async function withSessionOperation(
    sessionId: SessionId,
    operation: () => Promise<boolean>,
  ): Promise<boolean> {
    if (sessionOperationRef.current.has(sessionId)) {
      return false;
    }

    sessionOperationRef.current.add(sessionId);
    try {
      return await operation();
    } finally {
      sessionOperationRef.current.delete(sessionId);
    }
  }

  async function startShell(sessionId: SessionId, shellKind: ShellKind): Promise<boolean> {
    return withSessionOperation(sessionId, () => startShellUnlocked(sessionId, shellKind));
  }

  async function startShellUnlocked(sessionId: SessionId, shellKind: ShellKind): Promise<boolean> {
    const session = appStateRef.current.sessions.find(
      (candidate) => candidate.configuration.id === sessionId,
    );
    if (!session) {
      return false;
    }

    updateRuntime(sessionId, {
      processState: 'starting',
      processId: undefined,
      processType: 'shellSession',
      statusMessage: 'Starting shell.',
      activityState: 'unknown',
      attention: false,
    });
    terminalReplayStore.clear(sessionId);

    const terminalSize = getTerminalSize(sessionId);
    processStartPendingRef.current.add(sessionId);
    const result = await invokeCommand(
      () =>
        bridge.terminal.startShell({
          sessionId,
          workingDirectory: session.configuration.workingDirectory,
          shellKind,
          cols: terminalSize.cols,
          rows: terminalSize.rows,
        }),
      'Unable to start the configured shell.',
    );
    processStartPendingRef.current.delete(sessionId);

    if (!result.ok) {
      activeProcessIdsRef.current.delete(sessionId);
      updateRuntime(sessionId, {
        processState: 'error',
        processId: undefined,
        processType: undefined,
        statusMessage: result.error,
        activityState: 'unknown',
        attention: true,
      });
      return false;
    }
    return true;
  }

  async function prepareClaudeLaunch(
    sessionId: SessionId,
    launchMode: Exclude<SessionLaunchMode, 'custom'>,
    options: { interactive?: boolean } = {},
  ): Promise<PreparedClaudeLaunch | null> {
    if (
      !appStateRef.current.sessions.some((candidate) => candidate.configuration.id === sessionId)
    ) {
      return null;
    }

    updateRuntime(sessionId, {
      statusMessage: 'Checking the configured Claude executable.',
      attention: false,
    });

    const plan = await bridge.terminal.prepareClaude({ sessionId, launchMode });
    if (!plan.ok) {
      updateRuntime(sessionId, {
        statusMessage: plan.error,
        attention: true,
      });
      return null;
    }

    let allowFreshFallback = false;
    let allowAmbiguousContinue = false;

    if (plan.requiresAmbiguousContinueConsent) {
      if (options.interactive === false) {
        updateRuntime(sessionId, {
          statusMessage:
            'Skipped: this shared directory requires confirmation before continue-most-recent.',
          attention: true,
        });
        return null;
      }

      const confirmed = window.confirm(
        'This directory is used by more than one session. Claude may continue the directory’s most recent conversation rather than this session. Continue?',
      );
      if (!confirmed) {
        updateRuntime(sessionId, {
          statusMessage: 'Continue cancelled for a shared directory.',
        });
        return null;
      }
      allowAmbiguousContinue = true;
    }

    if (plan.requiresFreshFallbackConsent) {
      if (options.interactive === false) {
        updateRuntime(sessionId, {
          statusMessage: 'Skipped because this Claude CLI cannot continue a conversation.',
          attention: true,
        });
        return null;
      }

      const confirmed = window.confirm(
        'The installed Claude CLI does not report a supported continuation flag. Use a fresh restart instead?',
      );
      if (!confirmed) {
        updateRuntime(sessionId, {
          statusMessage: 'Reload & Continue cancelled because continuation is unsupported.',
        });
        return null;
      }
      allowFreshFallback = true;
    }

    return {
      sessionId,
      launchMode,
      planId: plan.planId,
      strategy: plan.strategy,
      allowFreshFallback,
      allowAmbiguousContinue,
      hasActiveProcess: plan.hasActiveProcess,
    };
  }

  async function launchPreparedClaude(prepared: PreparedClaudeLaunch): Promise<boolean> {
    const { sessionId, launchMode, planId, strategy, allowFreshFallback, allowAmbiguousContinue } =
      prepared;
    updateRuntime(sessionId, {
      processState: 'starting',
      processId: undefined,
      processType: 'claudeSession',
      statusMessage:
        strategy === 'continueMostRecent'
          ? 'Starting Claude Code with continue-most-recent strategy.'
          : strategy === 'resumeSpecific'
            ? 'Starting Claude Code resume picker.'
            : 'Starting Claude Code.',
      activityState: 'unknown',
      attention: false,
    });
    awaitingClaudeReadyRef.current.add(sessionId);
    if (launchMode === 'new') {
      terminalReplayStore.clear(sessionId);
    }

    const terminalSize = getTerminalSize(sessionId);
    processStartPendingRef.current.add(sessionId);
    const result = await invokeCommand(
      () =>
        bridge.terminal.startClaude({
          sessionId,
          planId,
          allowFreshFallback,
          allowAmbiguousContinue,
          cols: terminalSize.cols,
          rows: terminalSize.rows,
        }),
      'Unable to start Claude Code.',
    );
    processStartPendingRef.current.delete(sessionId);

    if (!result.ok) {
      activeProcessIdsRef.current.delete(sessionId);
      awaitingClaudeReadyRef.current.delete(sessionId);
      updateRuntime(sessionId, {
        processState: 'error',
        processId: undefined,
        processType: undefined,
        statusMessage: result.error,
        activityState: 'unknown',
        attention: true,
      });
      emitSemanticEvents(['session.reload_failed'], { sessionId });
      return false;
    }

    activeProcessIdsRef.current.set(sessionId, result.processId);
    updateRuntime(sessionId, {
      processId: result.processId,
    });
    if (result.warnings.length > 0) {
      updateRuntime(sessionId, {
        statusMessage: result.warnings.join(' '),
      });
    }

    return true;
  }

  async function reloadContinue(
    sessionId: SessionId,
    options: { skipConfirm?: boolean; emitSessionEvent?: boolean } = {},
  ): Promise<boolean> {
    const session = appStateRef.current.sessions.find(
      (candidate) => candidate.configuration.id === sessionId,
    );
    if (!session) {
      return false;
    }

    const prepared = await prepareClaudeLaunch(sessionId, 'continueMostRecent', {
      interactive: !options.skipConfirm,
    });
    if (!prepared) {
      return false;
    }

    const preparedSession = appStateRef.current.sessions.find(
      (candidate) => candidate.configuration.id === sessionId,
    );
    if (!preparedSession) {
      return false;
    }
    if (!options.skipConfirm && isBusy(preparedSession.runtime.activityState)) {
      const confirmed = window.confirm(
        'This session may be busy or awaiting input. Restart it now?',
      );
      if (!confirmed) {
        return false;
      }
    }

    if (!(await stopForRestart(prepared))) {
      return false;
    }
    const launched = await launchPreparedClaude(prepared);
    if (launched && options.emitSessionEvent !== false) {
      emitSemanticEvents(['session.reload_completed'], { sessionId });
    }
    return launched;
  }

  async function startNewClaude(sessionId: SessionId): Promise<boolean> {
    const session = appStateRef.current.sessions.find(
      (candidate) => candidate.configuration.id === sessionId,
    );
    if (!session) {
      return false;
    }

    const prepared = await prepareClaudeLaunch(sessionId, 'new');
    if (!prepared) {
      return false;
    }

    const preparedSession = appStateRef.current.sessions.find(
      (candidate) => candidate.configuration.id === sessionId,
    );
    if (!preparedSession) {
      return false;
    }
    if (isBusy(preparedSession.runtime.activityState)) {
      const confirmed = window.confirm(
        'This session may be busy or awaiting input. Start a fresh conversation now?',
      );
      if (!confirmed) {
        return false;
      }
    }

    if (prepared.hasActiveProcess) {
      if (!(await stopForRestart(prepared))) {
        return false;
      }
    }

    return launchPreparedClaude(prepared);
  }

  async function launchFromMode(
    sessionId: SessionId,
    launchMode: SessionLaunchMode,
  ): Promise<boolean> {
    return withSessionOperation(sessionId, async () => {
      if (launchMode === 'continueMostRecent') {
        return reloadContinue(sessionId);
      }

      if (launchMode === 'resumeSpecific') {
        return resumeClaude(sessionId);
      }

      return startNewClaude(sessionId);
    });
  }

  async function resumeClaude(sessionId: SessionId): Promise<boolean> {
    const session = appStateRef.current.sessions.find(
      (candidate) => candidate.configuration.id === sessionId,
    );
    if (!session) {
      return false;
    }

    const prepared = await prepareClaudeLaunch(sessionId, 'resumeSpecific');
    if (!prepared) {
      return false;
    }

    const preparedSession = appStateRef.current.sessions.find(
      (candidate) => candidate.configuration.id === sessionId,
    );
    if (!preparedSession) {
      return false;
    }
    if (isBusy(preparedSession.runtime.activityState)) {
      const confirmed = window.confirm(
        'This session may be busy or awaiting input. Open the Claude resume picker now?',
      );
      if (!confirmed) {
        return false;
      }
    }

    if (!(await stopForRestart(prepared))) {
      return false;
    }
    return launchPreparedClaude(prepared);
  }

  async function reloadAll() {
    const candidates = appState.sessions.filter(
      (session) =>
        session.configuration.workingDirectory &&
        session.runtime.processState === 'running' &&
        session.runtime.processType === 'claudeSession',
    );
    if (candidates.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Restart ${candidates.length} active Claude session${candidates.length === 1 ? '' : 's'} in sequence?`,
    );
    if (!confirmed) {
      return;
    }

    let failures = 0;
    for (const session of candidates) {
      const ok = await withSessionOperation(session.configuration.id, () =>
        reloadContinue(session.configuration.id, {
          skipConfirm: true,
          emitSessionEvent: false,
        }),
      );
      if (!ok) {
        failures += 1;
      }
      await delay(450);
    }

    emitSemanticEvents([failures === 0 ? 'reload_all.completed' : 'reload_all.partially_failed']);
  }

  async function stopForRestart(prepared: PreparedClaudeLaunch): Promise<boolean> {
    const { sessionId, planId, hasActiveProcess } = prepared;
    if (hasActiveProcess) {
      const stopResult = await bridge.terminal.stop({ sessionId, planId });
      if (!stopResult.ok) {
        updateRuntime(sessionId, {
          processState: 'error',
          statusMessage: stopResult.error,
          attention: true,
        });
        return false;
      }
      if (!(await waitForSessionExit(bridge, sessionId))) {
        updateRuntime(sessionId, {
          processState: 'error',
          statusMessage: 'The previous process did not stop in time.',
          attention: true,
        });
        return false;
      }
    }

    updateRuntime(sessionId, {
      processState: 'restarting',
      processType: 'claudeSession',
      statusMessage: 'Restarting Claude Code so startup-loaded configuration can be reread.',
    });
    return true;
  }

  async function selectDirectory(sessionId: SessionId) {
    const result = await bridge.selectDirectory({ sessionId });
    if (!result.ok) {
      if (!result.cancelled) {
        updateRuntime(sessionId, {
          statusMessage: result.error,
          attention: true,
        });
      }
      return;
    }

    setAppState((current) => {
      const configuration = current.settings.sessions.find((session) => session.id === sessionId);
      if (!configuration) {
        return current;
      }

      const name = directoryLeaf(result.directory);
      const nextConfiguration: SessionConfiguration = {
        ...configuration,
        workingDirectory: result.directory,
        name,
        claudeSessionName: createClaudeSessionName(name, configuration.id),
        hasNamedConversation: false,
        launchMode: 'new',
      };
      terminalReplayStore.clear(sessionId);
      return markSameProjects({
        ...current,
        settings: {
          ...current.settings,
          sessions: current.settings.sessions.map((session) =>
            session.id === sessionId ? nextConfiguration : session,
          ),
        },
        sessions: current.sessions.map((session) =>
          session.configuration.id === sessionId
            ? {
                ...session,
                configuration: nextConfiguration,
                runtime: {
                  ...session.runtime,
                  processState: 'stopped',
                  processType: undefined,
                  activityState: 'idle',
                  statusMessage: 'Configured and stopped.',
                  attention: false,
                },
              }
            : session,
        ),
      });
    });
  }

  async function openSessionDirectory(sessionId: SessionId) {
    const result = await bridge.openDirectory({ sessionId });
    if (!result.ok) {
      updateRuntime(sessionId, {
        statusMessage: result.error,
        attention: true,
      });
    }
  }

  async function stopSession(sessionId: SessionId) {
    updateRuntime(sessionId, {
      processState: 'stopping',
      statusMessage: 'Stopping process.',
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

  const checkConnection = useCallback(
    (options: { forceFresh?: boolean } = {}): Promise<AuthCheckResult> => {
      if (!options.forceFresh && authCheckInFlightRef.current) {
        return authCheckInFlightRef.current;
      }

      const generation = authCheckGenerationRef.current + 1;
      authCheckGenerationRef.current = generation;
      const operation = (async () => {
        const previousAuth = appStateRef.current.auth;
        const provider = appStateRef.current.settings.auth.provider;
        const hadPriorSuccess = previousAuth.lastSuccessfulCheckAt !== undefined;
        setAppState((current) => ({
          ...current,
          auth: {
            ...current.auth,
            status: 'checking',
            label: authLabel('checking', provider),
            details: authCheckingDetails(provider),
            nextScheduledCheckAt: undefined,
          },
        }));

        let result = await runAuthCheck(bridge);
        if (generation !== authCheckGenerationRef.current) {
          return supersededAuthCheckResult(result);
        }

        if (shouldConfirmAuthCheckFailure(result.status, provider, hadPriorSuccess)) {
          setAppState((current) => ({
            ...current,
            auth: {
              ...current.auth,
              status: 'checking',
              label: authLabel('checking', provider),
              details: `${authProviderName(provider)} check failed once; confirming before changing the last verified status.`,
            },
          }));
          await delay(authFailureConfirmationDelayMs);
          if (generation !== authCheckGenerationRef.current) {
            return supersededAuthCheckResult(result);
          }
          result = await runAuthCheck(bridge);
          if (generation !== authCheckGenerationRef.current) {
            return supersededAuthCheckResult(result);
          }
        }

        setAppState((current) => ({
          ...current,
          auth: {
            ...current.auth,
            status: result.status,
            label: authLabel(result.status, provider),
            details: authCheckDetails(
              result,
              provider,
              result.status === 'connected' ? result.checkedAt : current.auth.lastSuccessfulCheckAt,
            ),
            safeIdentity: result.safeIdentity,
            lastCheckedAt: result.checkedAt,
            lastSuccessfulCheckAt:
              result.status === 'connected' ? result.checkedAt : current.auth.lastSuccessfulCheckAt,
            nextScheduledCheckAt: getNextAuthCheckAt(result.checkedAt, current.settings.auth),
          },
        }));

        const event = authTransitionEvent(previousAuth.status, result.status);
        if (event) {
          emitSemanticEvents([event]);
        }

        return result;
      })();

      authCheckInFlightRef.current = operation;
      void operation.then(
        () => {
          if (authCheckInFlightRef.current === operation) {
            authCheckInFlightRef.current = null;
          }
        },
        () => {
          if (authCheckInFlightRef.current === operation) {
            authCheckInFlightRef.current = null;
          }
        },
      );
      return operation;
    },
    [bridge, emitSemanticEvents],
  );

  const startAuthRefresh = useCallback(async (): Promise<CommandResult> => {
    if (authRefreshStartInFlightRef.current || appStateRef.current.auth.status === 'refreshing') {
      return { ok: false, error: 'Credential login is already running.' };
    }

    authRefreshStartInFlightRef.current = true;
    const auth = appStateRef.current.settings.auth;

    let refreshStarted = false;

    try {
      if (!isAuthRefreshConfigured(auth)) {
        setSettingsSection('authentication');
        setAppState((current) => ({
          ...current,
          auth: {
            ...current.auth,
            status: 'disconnected',
            label: `${authProviderName(auth.provider)} login unavailable`,
            details: `Add a provider login command in Settings. ${authScopeDisclaimer(auth.provider)}`,
          },
        }));
        return { ok: false, error: 'Credential login command is not configured.' };
      }

      // A check that began before this login cannot describe the credentials after it. Supersede
      // its renderer result; the login exit handler will request a fresh authoritative check.
      authCheckGenerationRef.current += 1;
      authCheckInFlightRef.current = null;
      setAuthConsoleOpen(true);
      setAppState((current) => ({
        ...current,
        auth: {
          ...current.auth,
          status: 'refreshing',
          label: authLabel('refreshing', auth.provider),
          details: `Starting the configured provider login. ${authScopeDisclaimer(auth.provider)}`,
        },
      }));

      const result = await bridge.auth.startRefresh();
      if (!result.ok) {
        setAppState((current) => ({
          ...current,
          auth: {
            ...current.auth,
            status: 'error',
            label: authLabel('error', auth.provider),
            details: `${result.error} ${authScopeDisclaimer(auth.provider)}`,
          },
        }));
        return result;
      }

      refreshStarted = true;
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start credential login.';
      setAppState((current) => ({
        ...current,
        auth: {
          ...current.auth,
          status: 'error',
          label: authLabel('error', auth.provider),
          details: `${message} ${authScopeDisclaimer(auth.provider)}`,
        },
      }));
      return { ok: false, error: message };
    } finally {
      if (!refreshStarted) {
        authRefreshStartInFlightRef.current = false;
      }
    }
  }, [bridge]);

  const startConfiguredAuthRefreshAfterCheck = useCallback(
    (result: AuthCheckResult) => {
      if (
        shouldAuthCheckStartRefresh(result.status) &&
        isAuthRefreshConfigured(appStateRef.current.settings.auth)
      ) {
        void startAuthRefresh();
      }
    },
    [startAuthRefresh],
  );

  const connectAuthentication = useCallback(async () => {
    const auth = appStateRef.current.settings.auth;
    if (!isAuthCheckConfigured(auth)) {
      setSettingsSection('authentication');
      return;
    }

    const result = await checkConnection();
    if (!shouldAuthCheckStartRefresh(result.status)) {
      return;
    }

    await startAuthRefresh();
  }, [checkConnection, startAuthRefresh]);

  useEffect(() => {
    if (!appStateLoadedRef.current) {
      return undefined;
    }

    const current = appStateRef.current;
    const dueAt = getNextAuthCheckDueAt(current);
    if (dueAt === null || isAuthBusy(current.auth.status)) {
      return undefined;
    }

    const timeout = window.setTimeout(
      () => {
        if (shouldRunScheduledAuthCheck(appStateRef.current)) {
          void checkConnection().then(startConfiguredAuthRefreshAfterCheck);
        }
      },
      Math.max(1000, dueAt - Date.now()),
    );

    return () => window.clearTimeout(timeout);
  }, [
    appState.auth.lastCheckedAt,
    appState.auth.status,
    appState.settings.auth.checkExecutable,
    appState.settings.auth.checkIntervalSeconds,
    appState.settings.auth.provider,
    checkConnection,
    startConfiguredAuthRefreshAfterCheck,
  ]);

  useEffect(() => {
    if (!appStateLoaded) {
      return;
    }

    void bridge.terminal
      .getSnapshots()
      .then((snapshots) => {
        snapshots.forEach((snapshot) => {
          if (snapshot.sessionId) {
            activeProcessIdsRef.current.set(snapshot.sessionId, snapshot.id);
            const patch: Partial<AppStateSnapshot['sessions'][number]['runtime']> & {
              processState: ProcessState;
            } = {
              processState: snapshot.state,
              processId: snapshot.id,
              processType: snapshot.type,
              startedAt: snapshot.startedAt,
              statusMessage: `Recovered active ${snapshot.type} after renderer load.`,
            };

            if (snapshot.lastOutputAt) {
              patch.lastOutputAt = snapshot.lastOutputAt;
            }

            updateRuntime(snapshot.sessionId, patch);
          }
        });
      })
      .catch((error: unknown) => {
        addPreferenceDiagnostic(
          'terminal-recovery',
          'Terminal recovery',
          error instanceof Error ? error.message : 'Unable to recover active terminal sessions.',
        );
      });
  }, [addPreferenceDiagnostic, appStateLoaded, bridge, updateRuntime]);

  useEffect(() => {
    const checkIfStale = () => {
      if (!appStateLoadedRef.current || document.visibilityState === 'hidden') {
        return;
      }

      if (shouldRunScheduledAuthCheck(appStateRef.current)) {
        void checkConnection().then(startConfiguredAuthRefreshAfterCheck);
      }
    };

    window.addEventListener('focus', checkIfStale);
    document.addEventListener('visibilitychange', checkIfStale);
    return () => {
      window.removeEventListener('focus', checkIfStale);
      document.removeEventListener('visibilitychange', checkIfStale);
    };
  }, [checkConnection, startConfiguredAuthRefreshAfterCheck]);

  useEffect(() => {
    const auth = appState.settings.auth;
    if (
      !appStateLoadedRef.current ||
      startupAuthAttemptedRef.current ||
      !auth.startupChecksEnabled ||
      auth.provider === 'disabled' ||
      !auth.checkExecutable.trim()
    ) {
      return;
    }

    startupAuthAttemptedRef.current = true;
    void checkConnection().then((result) => {
      startConfiguredAuthRefreshAfterCheck(result);
    });
  }, [appState.settings.auth, checkConnection, startConfiguredAuthRefreshAfterCheck]);

  useEffect(() => {
    return bridge.auth.onExit(() => {
      authRefreshStartInFlightRef.current = false;
      // A login process exit does not establish credential state. Always run the configured
      // authoritative check, including after cancellation or a non-zero exit.
      void checkConnection({ forceFresh: true });
    });
  }, [bridge, checkConnection]);

  if (!appStateLoaded) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <strong>Claude Command Deck</strong>
        <span>Loading saved sessions…</span>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <CommandBar
        appVersion={appState.appVersion}
        auth={appState.auth}
        usage={usageSnapshot}
        usageEnabled={usageTrackerEnabled}
        sessions={appState.sessions}
        audio={appState.settings.audio}
        onOpenSettings={() => setSettingsSection('general')}
        onToggleFocusMode={() => setFocusMode((current) => !current)}
        onAddSession={() => {
          void addSession();
        }}
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
          onRequestTerminalFocus={() => setTerminalFocusRequest((current) => current + 1)}
          onToggleFocusMode={() => setFocusMode((current) => !current)}
          onAddSession={() => {
            void addSession();
          }}
          onRemoveSession={(sessionId) => {
            void removeSession(sessionId);
          }}
          onOpenSettings={() => setSettingsSection('claude')}
          shellKind={appState.settings.shellKind}
          shellOptions={shellOptions}
          onUpdateShellKind={(shellKind) => {
            void updateShellConfiguration(shellKind);
          }}
          onStartShell={(sessionId, shellKind) => {
            void startShell(sessionId, shellKind);
          }}
          onLaunchClaude={(sessionId, launchMode) => {
            void launchFromMode(sessionId, launchMode);
          }}
          onSelectDirectory={(sessionId) => {
            void selectDirectory(sessionId);
          }}
          onOpenDirectory={(sessionId) => {
            void openSessionDirectory(sessionId);
          }}
          onStopSession={(sessionId) => {
            void stopSession(sessionId);
          }}
          onUpdateSessionConfiguration={(configuration) => {
            void updateSessionConfiguration(configuration);
          }}
          terminalBridge={bridge.terminal}
          terminalFocusRequest={terminalFocusRequest}
          terminalReplayStore={terminalReplayStore}
        />
      </main>
      <footer className="bottom-status" aria-label="Application status">
        <span>{focusedSession?.configuration.name ?? 'No focused session'}</span>
        <span>Alt+1…9 jump</span>
        <span>Ctrl+PgUp/PgDn cycle</span>
        <span>Ctrl+Shift+P find</span>
        <span>Alt+N add</span>
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
        onUpdateClaudeConfiguration={(executable, baseArgs) => {
          void updateClaudeConfiguration(executable, baseArgs);
        }}
        shellOptions={shellOptions}
        onUpdateShellConfiguration={(shellKind) => {
          void updateShellConfiguration(shellKind);
        }}
        onUpdateAudioPreferences={(preferences) => {
          void updateAudioPreferences(preferences);
        }}
        onUpdateNotificationPreferences={(preferences) => {
          void updateNotificationPreferences(preferences);
        }}
        onUpdateSessionConfiguration={(configuration) => {
          void updateSessionConfiguration(configuration);
        }}
        onUpdateSessionAudioPreferences={(sessionId, preferences) => {
          void updateSessionAudioPreferences(sessionId, preferences);
        }}
        onSelectDirectory={(sessionId) => {
          void selectDirectory(sessionId);
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
        onStartLogin={startAuthRefresh}
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

function sessionShortcutIndex(event: KeyboardEvent): number | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.getModifierState('AltGraph')) {
    return null;
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const codes = [
    'Digit1',
    'Digit2',
    'Digit3',
    'Digit4',
    'Digit5',
    'Digit6',
    'Digit7',
    'Digit8',
    'Digit9',
  ];
  const keyIndex = keys.indexOf(event.key);
  if (keyIndex >= 0) {
    return keyIndex;
  }

  const codeIndex = codes.indexOf(event.code);
  return codeIndex >= 0 ? codeIndex : null;
}

function isAltShortcut(event: KeyboardEvent, key: string, code: string): boolean {
  return (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.getModifierState('AltGraph') &&
    (event.key.toLowerCase() === key || event.code === code)
  );
}

function normalizeSessionConfiguration(configuration: SessionConfiguration): SessionConfiguration {
  const model = configuration.model.trim();
  const canonicalModel = ['haiku', 'sonnet', 'opus'].find(
    (candidate) => candidate === model.toLowerCase(),
  );
  return {
    ...configuration,
    name: configuration.name.trim() || 'Untitled session',
    role: 'project',
    executable: configuration.executable.trim(),
    model: canonicalModel ?? model,
    claudeSessionName: configuration.hasNamedConversation
      ? configuration.claudeSessionName.trim() ||
        createClaudeSessionName(configuration.name, configuration.id)
      : createClaudeSessionName(configuration.name, configuration.id),
  };
}

function nextAttentionSession(sessions: AppStateSnapshot['sessions'], focusedSessionId: SessionId) {
  const currentIndex = sessions.findIndex(
    (session) => session.configuration.id === focusedSessionId,
  );
  for (let offset = 1; offset <= sessions.length; offset += 1) {
    const candidate = sessions[(Math.max(0, currentIndex) + offset) % sessions.length];
    if (candidate?.runtime.attention) {
      return candidate;
    }
  }
  return undefined;
}

async function waitForSessionExit(
  bridge: CommandDeckBridge,
  sessionId: SessionId,
): Promise<boolean> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const snapshots = await bridge.terminal.getSnapshots();
    if (!snapshots.some((snapshot) => snapshot.sessionId === sessionId)) {
      return true;
    }
    await delay(50);
  }
  return false;
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

  if (previous === 'connected' && next === 'disconnected') {
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

function isAuthCheckConfigured(auth: AuthConfiguration) {
  return auth.provider !== 'disabled' && auth.checkExecutable.trim().length > 0;
}

function isAuthRefreshConfigured(auth: AuthConfiguration) {
  return auth.provider !== 'disabled' && auth.refreshExecutable.trim().length > 0;
}

function isAuthBusy(status: AuthStatus) {
  return status === 'checking' || status === 'refreshing';
}

function shouldAuthCheckStartRefresh(status: AuthStatus) {
  return status === 'disconnected' || status === 'expiringSoon';
}

function getAuthCheckIntervalMs(auth: AuthConfiguration) {
  return Math.max(auth.checkIntervalSeconds, minimumAuthCheckIntervalSeconds) * 1000;
}

function getNextAuthCheckAt(checkedAt: string, auth: AuthConfiguration) {
  if (!isAuthCheckConfigured(auth)) {
    return undefined;
  }

  const checkedAtMs = Date.parse(checkedAt);
  const base = Number.isNaN(checkedAtMs) ? Date.now() : checkedAtMs;
  return new Date(base + getAuthCheckIntervalMs(auth)).toISOString();
}

function getNextAuthCheckDueAt(state: AppStateSnapshot) {
  if (!isAuthCheckConfigured(state.settings.auth)) {
    return null;
  }

  const lastCheckedAt = state.auth.lastCheckedAt
    ? Date.parse(state.auth.lastCheckedAt)
    : Date.now();
  const base = Number.isNaN(lastCheckedAt) ? Date.now() : lastCheckedAt;
  return base + getAuthCheckIntervalMs(state.settings.auth);
}

function shouldRunScheduledAuthCheck(state: AppStateSnapshot) {
  if (!isAuthCheckConfigured(state.settings.auth) || isAuthBusy(state.auth.status)) {
    return false;
  }

  if (!state.auth.lastCheckedAt) {
    return true;
  }

  const dueAt = getNextAuthCheckDueAt(state);
  return dueAt !== null && Date.now() >= dueAt;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function runAuthCheck(bridge: CommandDeckBridge): Promise<AuthCheckResult> {
  try {
    return await bridge.auth.check();
  } catch (error) {
    return {
      status: 'error',
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Credential check failed unexpectedly.',
    };
  }
}

function supersededAuthCheckResult(result: AuthCheckResult): AuthCheckResult {
  return {
    status: 'checking',
    checkedAt: result.checkedAt,
    error: 'Credential check was superseded by a newer verification.',
  };
}

function shouldConfirmAuthCheckFailure(
  status: AuthStatus,
  provider: AuthProvider,
  hadPriorSuccess: boolean,
) {
  if (status === 'error') {
    return true;
  }

  if (status !== 'disconnected' && status !== 'expiringSoon') {
    return false;
  }

  return provider === 'aws' || hadPriorSuccess;
}

function authProviderName(provider: AuthProvider) {
  switch (provider) {
    case 'aws':
      return 'AWS credential';
    case 'custom':
      return 'Custom credential';
    case 'disabled':
      return 'Credential monitor';
  }
}

function authScopeDisclaimer(provider: AuthProvider) {
  if (provider === 'aws') {
    return 'This reports only the configured AWS check; it does not directly inspect running Claude sessions.';
  }

  if (provider === 'custom') {
    return 'This reports only the configured custom check; it does not directly inspect running Claude sessions.';
  }

  return 'No credential check is inspecting running Claude sessions.';
}

function authCheckingDetails(provider: AuthProvider) {
  return `Running the configured ${authProviderName(provider).toLowerCase()} check. ${authScopeDisclaimer(provider)}`;
}

function authCheckDetails(
  result: AuthCheckResult,
  provider: AuthProvider,
  lastSuccessfulCheckAt?: string,
) {
  const scope = authScopeDisclaimer(provider);
  if (result.status === 'connected') {
    const identity = formatSafeIdentity(result.safeIdentity);
    return `${identity ?? `${authProviderName(provider)} check passed.`} ${scope}`;
  }

  const failure = result.error ?? `${authProviderName(provider)} check did not pass.`;
  const lastVerified = lastSuccessfulCheckAt ? ' A previous check succeeded.' : '';
  return `${failure}${lastVerified} ${scope}`;
}

function authLabel(status: AppStateSnapshot['auth']['status'], provider: AuthProvider) {
  const providerName = authProviderName(provider);
  switch (status) {
    case 'connected':
      return `${providerName} check passed`;
    case 'checking':
      return `Checking ${providerName.toLowerCase()}s`;
    case 'disconnected':
      return `${providerName} check failed`;
    case 'error':
      return `${providerName} check error`;
    case 'refreshing':
      return `${providerName} login running`;
    case 'expiringSoon':
      return `${providerName} may expire soon`;
    case 'notConfigured':
      return `${providerName} not configured`;
  }
}

function formatSafeIdentity(identity: AppStateSnapshot['auth']['safeIdentity']) {
  if (!identity) {
    return null;
  }

  const text = [identity.accountId, identity.arn, identity.userId].filter(Boolean).join(' | ');
  return text || null;
}
