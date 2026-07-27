import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  broadcastTerminalExit,
  broadcastTerminalOutput,
  registerTerminalHandlers,
} from '../src/main/ipc/terminal';
import type { SettingsStore } from '../src/main/persistence/SettingsStore';
import type { ProcessManager } from '../src/main/processes/ProcessManager';
import {
  createClaudeSessionName,
  createDefaultSessionConfiguration,
  createDefaultSettings,
} from '../src/shared/domain/defaults';
import type {
  ApplicationSettings,
  ClaudeDiscoverySnapshot,
  SessionLaunchMode,
} from '../src/shared/domain/types';
import { IPC_CHANNELS } from '../src/shared/ipc/channels';
import type { PrepareClaudeLaunchResult } from '../src/shared/ipc/contracts';

type IpcHandler = (event: unknown, payload?: unknown) => unknown;
type PreparedLaunch = Extract<PrepareClaudeLaunchResult, { ok: true }>;

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  getAllWindows: vi.fn(() => []),
}));
const discoveryMocks = vi.hoisted(() => ({
  discoverClaude: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows,
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock('../src/main/claude/ClaudeDiscovery', () => ({
  discoverClaude: discoveryMocks.discoverClaude,
}));

describe('terminal IPC session authorization', () => {
  const sessionId = 'session-dynamic-authorized';
  const persistedWorkingDirectory = '/persisted/project';
  const configuredExecutable = 'claude-custom';
  const resolvedExecutable = '/opt/bin/claude-custom';
  const processManagerMocks = {
    startShell: vi.fn(() => ({ ok: true as const })),
    startClaude: vi.fn(() => ({
      ok: true as const,
      processId: 'process-claude-1',
    })),
    write: vi.fn(() => ({ ok: true as const })),
    resize: vi.fn(() => ({ ok: true as const })),
    stop: vi.fn(() => ({ ok: true as const })),
    snapshots: vi.fn(() => []),
    hasActiveProcess: vi.fn(() => false),
    processEpoch: vi.fn(() => 0),
  };
  const settingsStoreMocks = {
    load: vi.fn<() => ApplicationSettings>(),
    updateSessionConversation: vi.fn<(targetSessionId: string, name: string | null) => boolean>(),
  };
  let settings: ApplicationSettings;

  beforeEach(() => {
    electronMocks.handlers.clear();
    vi.clearAllMocks();
    electronMocks.getAllWindows.mockReturnValue([]);
    processManagerMocks.snapshots.mockReturnValue([]);
    processManagerMocks.hasActiveProcess.mockReturnValue(false);
    processManagerMocks.processEpoch.mockReturnValue(0);
    processManagerMocks.startClaude.mockReturnValue({
      ok: true,
      processId: 'process-claude-1',
    });
    discoveryMocks.discoverClaude.mockResolvedValue({
      executable: configuredExecutable,
      resolvedPath: resolvedExecutable,
      found: true,
      version: 'mock',
      capabilities: {
        helpAvailable: true,
        continueMostRecent: true,
        continueFlag: '--continue',
        resumeSpecific: true,
        resumeFlag: '--resume',
        nameSession: true,
        nameFlag: '--name',
      },
      error: null,
      checkedAt: new Date().toISOString(),
    });

    settings = createDefaultSettings();
    settings.sessions = [
      {
        ...createDefaultSessionConfiguration(sessionId),
        workingDirectory: persistedWorkingDirectory,
        executable: configuredExecutable,
      },
    ];
    settings.focusedSessionId = sessionId;

    settingsStoreMocks.load.mockImplementation(() => settings);
    settingsStoreMocks.updateSessionConversation.mockImplementation(
      (targetSessionId, claudeSessionName) => {
        const target = settings.sessions.find((candidate) => candidate.id === targetSessionId);
        if (!target) {
          return false;
        }
        target.claudeSessionName =
          claudeSessionName ?? createClaudeSessionName(target.name, target.id);
        target.hasNamedConversation = claudeSessionName !== null;
        target.launchMode = 'continueMostRecent';
        return true;
      },
    );

    registerTerminalHandlers(
      processManagerMocks as unknown as ProcessManager,
      settingsStoreMocks as unknown as SettingsStore,
    );
  });

  it('rejects every mutating terminal operation for an unknown dynamic session ID', async () => {
    const unknownSessionId = 'session-dynamic-removed';
    const results = await Promise.all([
      invoke(IPC_CHANNELS.terminalStartShell, {
        sessionId: unknownSessionId,
        workingDirectory: '/renderer/project',
        shellKind: 'commandPrompt',
        cols: 80,
        rows: 24,
      }),
      invoke(IPC_CHANNELS.terminalPrepareClaude, {
        sessionId: unknownSessionId,
        launchMode: 'new',
      }),
      invoke(IPC_CHANNELS.terminalStartClaude, {
        sessionId: unknownSessionId,
        planId: '11111111-1111-4111-8111-111111111111',
        allowFreshFallback: false,
        allowAmbiguousContinue: false,
        cols: 80,
        rows: 24,
      }),
      invoke(IPC_CHANNELS.terminalWrite, {
        sessionId: unknownSessionId,
        data: 'pwd\r',
      }),
      invoke(IPC_CHANNELS.terminalResize, {
        sessionId: unknownSessionId,
        cols: 100,
        rows: 30,
      }),
      invoke(IPC_CHANNELS.terminalStop, {
        sessionId: unknownSessionId,
      }),
    ]);

    expect(results).toEqual(
      Array.from({ length: 6 }, () => ({
        ok: false,
        error: 'The selected session no longer exists.',
      })),
    );
    expect(processManagerMocks.startShell).not.toHaveBeenCalled();
    expect(processManagerMocks.startClaude).not.toHaveBeenCalled();
    expect(processManagerMocks.write).not.toHaveBeenCalled();
    expect(processManagerMocks.resize).not.toHaveBeenCalled();
    expect(processManagerMocks.stop).not.toHaveBeenCalled();
  });

  it('rejects an unsupported shell kind before reaching the process manager', async () => {
    const result = await invoke(IPC_CHANNELS.terminalStartShell, {
      sessionId,
      workingDirectory: '/renderer/supplied',
      shellKind: 'arbitraryExecutable',
      cols: 120,
      rows: 40,
    });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid shell start request.',
    });
    expect(processManagerMocks.startShell).not.toHaveBeenCalled();
  });

  it('forwards the selected shell kind while enforcing the persisted directory', async () => {
    const result = await invoke(IPC_CHANNELS.terminalStartShell, {
      sessionId,
      workingDirectory: '/renderer/supplied',
      shellKind: 'commandPrompt',
      cols: 120,
      rows: 40,
    });

    expect(result).toEqual({ ok: true });
    expect(processManagerMocks.startShell).toHaveBeenCalledWith({
      sessionId,
      workingDirectory: persistedWorkingDirectory,
      shellKind: 'commandPrompt',
      cols: 120,
      rows: 40,
    });
  });

  it('derives the Claude executable, arguments, model, name, and directory in main', async () => {
    settings.sessions[0] = {
      ...settings.sessions[0]!,
      model: 'sonnet',
    };
    const generatedName = createClaudeSessionName(settings.sessions[0].name, sessionId);
    const prepared = requirePrepared(await prepare(sessionId, 'new'));
    const result = await start(prepared, {
      workingDirectory: '/renderer/supplied',
      executable: '/tmp/not-configured-claude',
      args: ['--dangerously-skip-permissions'],
    });

    expect(prepared).toMatchObject({
      strategy: 'new',
      requiresFreshFallbackConsent: false,
      requiresAmbiguousContinueConsent: false,
      hasActiveProcess: false,
    });
    expect(result).toEqual({
      ok: true,
      processId: 'process-claude-1',
      strategy: 'new',
      newConversationBinding: generatedName,
      warnings: [],
    });
    expect(discoveryMocks.discoverClaude).toHaveBeenCalledWith(configuredExecutable);
    expect(processManagerMocks.startClaude).toHaveBeenCalledWith({
      sessionId,
      workingDirectory: persistedWorkingDirectory,
      executable: resolvedExecutable,
      args: ['--model', 'sonnet', '--name', generatedName],
      cols: 100,
      rows: 30,
    });
  });

  it('generates a different tightly-scoped name for each later fresh conversation', async () => {
    settings.sessions[0] = {
      ...settings.sessions[0]!,
      claudeSessionName: 'deck-session-1-dynamica',
      hasNamedConversation: true,
      launchMode: 'continueMostRecent',
    };

    const prepared = requirePrepared(await prepare(sessionId, 'new'));
    const result = await start(prepared);

    expect(result).toMatchObject({ ok: true, strategy: 'new', warnings: [] });
    if (!isSuccessfulClaudeStart(result)) {
      throw new Error('Expected a successful Claude launch.');
    }
    expect(result.newConversationBinding).toMatch(/^deck-session-1-dynamica-[a-f0-9]{8}$/);
    expect(result.newConversationBinding).not.toBe(settings.sessions[0].claudeSessionName);
    expect(processManagerMocks.startClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['--name', result.newConversationBinding],
      }),
    );
  });

  it('resumes only the exact named conversation stored in the main-owned profile', async () => {
    settings.sessions[0] = {
      ...settings.sessions[0]!,
      claudeSessionName: 'deck-session-1-dynamica',
      hasNamedConversation: true,
      launchMode: 'continueMostRecent',
    };

    const prepared = requirePrepared(await prepare(sessionId, 'continueMostRecent'));
    const accepted = await start(prepared, {
      knownSessionIdentifier: 'renderer-cannot-select-another-conversation',
    });

    expect(accepted).toEqual({
      ok: true,
      processId: 'process-claude-1',
      strategy: 'resumeSpecific',
      newConversationBinding: null,
      warnings: [],
    });
    expect(processManagerMocks.startClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: resolvedExecutable,
        args: ['--resume', 'deck-session-1-dynamica'],
      }),
    );
  });

  it('scopes fresh-fallback consent to a single prepared launch', async () => {
    discoveryMocks.discoverClaude.mockResolvedValue(discoveryWithoutContinuation());
    const rejectedPlan = requirePrepared(await prepare(sessionId, 'continueMostRecent'));
    expect(rejectedPlan.requiresFreshFallbackConsent).toBe(true);

    const rejected = await start(rejectedPlan);
    expect(rejected).toEqual({
      ok: false,
      error: 'Claude continuation is unsupported by this executable.',
    });

    const acceptedPlan = requirePrepared(await prepare(sessionId, 'continueMostRecent'));
    const accepted = await start(acceptedPlan, {}, { allowFreshFallback: true });
    expect(accepted).toEqual({
      ok: true,
      processId: 'process-claude-1',
      strategy: 'freshFallback',
      newConversationBinding: null,
      warnings: ['Continuation is unsupported by the discovered Claude CLI; using a fresh launch.'],
    });
  });

  it('requires plan-scoped consent for continue-most-recent in a shared directory', async () => {
    settings.sessions.push({
      ...createDefaultSessionConfiguration('session-shared-project', 2),
      workingDirectory: `${persistedWorkingDirectory}/`,
    });
    const rejectedPlan = requirePrepared(await prepare(sessionId, 'continueMostRecent'));
    expect(rejectedPlan.requiresAmbiguousContinueConsent).toBe(true);

    const rejected = await start(rejectedPlan);
    expect(rejected).toEqual({
      ok: false,
      error: 'Continuing the most recent conversation in this shared directory requires consent.',
    });

    const acceptedPlan = requirePrepared(await prepare(sessionId, 'continueMostRecent'));
    const accepted = await start(acceptedPlan, {}, { allowAmbiguousContinue: true });
    expect(accepted).toEqual({
      ok: true,
      processId: 'process-claude-1',
      strategy: 'continueMostRecent',
      newConversationBinding: null,
      warnings: [],
    });
    expect(processManagerMocks.startClaude).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['--continue'] }),
    );
  });

  it('treats symlink aliases as the same physical directory during preflight', async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'claude-command-deck-shared-'));
    try {
      const projectDirectory = join(temporaryRoot, 'project');
      const projectAlias = join(temporaryRoot, 'project-alias');
      mkdirSync(projectDirectory);
      symlinkSync(
        projectDirectory,
        projectAlias,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      settings.sessions[0] = {
        ...settings.sessions[0]!,
        workingDirectory: projectDirectory,
      };
      settings.sessions.push({
        ...createDefaultSessionConfiguration('session-symlink-alias', 2),
        workingDirectory: projectAlias,
      });

      const prepared = requirePrepared(await prepare(sessionId, 'continueMostRecent'));

      expect(prepared.requiresAmbiguousContinueConsent).toBe(true);
      expect(processManagerMocks.startClaude).not.toHaveBeenCalled();
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('invalidates older plans when a newer preparation begins', async () => {
    const first = requirePrepared(await prepare(sessionId, 'new'));
    const second = requirePrepared(await prepare(sessionId, 'resumeSpecific'));

    const staleResult = await start(first);
    expect(staleResult).toEqual({
      ok: false,
      error: 'Prepare this Claude launch again before starting it.',
    });

    const currentResult = await start(second);
    expect(currentResult).toMatchObject({ ok: true, strategy: 'resumeSpecific' });
  });

  it('rejects a prepared plan if the effective profile changes before start', async () => {
    const prepared = requirePrepared(await prepare(sessionId, 'new'));
    settings.sessions[0] = {
      ...settings.sessions[0]!,
      model: 'opus',
    };

    const result = await start(prepared);

    expect(result).toEqual({
      ok: false,
      error: 'The session profile changed. Prepare this launch again.',
    });
    expect(processManagerMocks.startClaude).not.toHaveBeenCalled();
  });

  it('will not stop a process that replaced the PTY reviewed by the plan', async () => {
    processManagerMocks.snapshots.mockReturnValue([
      { id: 'process-reviewed', sessionId },
    ] as never[]);
    const prepared = requirePrepared(await prepare(sessionId, 'new'));
    expect(prepared.hasActiveProcess).toBe(true);
    processManagerMocks.snapshots.mockReturnValue([
      { id: 'process-replacement', sessionId },
    ] as never[]);

    const result = await invoke(IPC_CHANNELS.terminalStop, {
      sessionId,
      planId: prepared.planId,
    });

    expect(result).toEqual({
      ok: false,
      error: 'A different process became active; it was not stopped.',
    });
    expect(processManagerMocks.stop).not.toHaveBeenCalled();
  });

  it('does not install a plan if the process changes during asynchronous preparation', async () => {
    let discoveryStarted = false;
    let finishDiscovery: (value: ClaudeDiscoverySnapshot) => void = () => undefined;
    discoveryMocks.discoverClaude.mockImplementation(
      () =>
        new Promise<ClaudeDiscoverySnapshot>((resolve) => {
          discoveryStarted = true;
          finishDiscovery = resolve;
        }),
    );
    processManagerMocks.snapshots.mockReturnValue([
      { id: 'process-reviewed', sessionId },
    ] as never[]);

    const preparation = prepare(sessionId, 'new');
    await vi.waitFor(() => expect(discoveryStarted).toBe(true));
    processManagerMocks.snapshots.mockReturnValue([
      { id: 'process-replacement', sessionId },
    ] as never[]);
    finishDiscovery({
      ...discoveryWithoutContinuation(),
      capabilities: {
        helpAvailable: true,
        continueMostRecent: true,
        continueFlag: '--continue',
        resumeSpecific: true,
        resumeFlag: '--resume',
        nameSession: true,
        nameFlag: '--name',
      },
    });

    await expect(preparation).resolves.toEqual({
      ok: false,
      error: 'The session process changed while preparing Claude. Prepare this launch again.',
    });
  });

  it('revalidates a prepared profile before stopping the reviewed process', async () => {
    processManagerMocks.snapshots.mockReturnValue([
      { id: 'process-reviewed', sessionId },
    ] as never[]);
    const prepared = requirePrepared(await prepare(sessionId, 'new'));
    settings.sessions[0] = {
      ...settings.sessions[0]!,
      model: 'opus',
    };

    const result = await invoke(IPC_CHANNELS.terminalStop, {
      sessionId,
      planId: prepared.planId,
    });

    expect(result).toEqual({
      ok: false,
      error: 'The session profile changed. Prepare this launch again.',
    });
    expect(processManagerMocks.stop).not.toHaveBeenCalled();
  });

  it('rejects a plan after an intervening process starts and exits in the same session', async () => {
    const prepared = requirePrepared(await prepare(sessionId, 'continueMostRecent'));
    processManagerMocks.processEpoch.mockReturnValue(1);

    const result = await start(prepared);

    expect(result).toEqual({
      ok: false,
      error: 'Another process used this session after preparation. Prepare this launch again.',
    });
    expect(processManagerMocks.startClaude).not.toHaveBeenCalled();
  });

  it('persists a generated conversation name only after output from the exact process', async () => {
    vi.useFakeTimers();
    try {
      const prepared = requirePrepared(await prepare(sessionId, 'new'));
      const result = await start(prepared);
      if (!isSuccessfulClaudeStart(result)) {
        throw new Error('Expected a successful Claude launch.');
      }

      broadcastTerminalOutput({
        sessionId,
        processId: 'process-replaced-or-late',
        data: 'unrelated output',
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(settingsStoreMocks.updateSessionConversation).not.toHaveBeenCalled();

      broadcastTerminalOutput({
        sessionId,
        processId: result.processId,
        data: 'MCP server warning: failed to start optional integration',
      });
      await vi.advanceTimersByTimeAsync(751);

      expect(settingsStoreMocks.updateSessionConversation).toHaveBeenCalledWith(
        sessionId,
        result.newConversationBinding,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears a stale exact binding after the resume picker starts producing output', async () => {
    vi.useFakeTimers();
    try {
      settings.sessions[0] = {
        ...settings.sessions[0]!,
        claudeSessionName: 'deck-old-conversation',
        hasNamedConversation: true,
      };
      const prepared = requirePrepared(await prepare(sessionId, 'resumeSpecific'));
      const result = await start(prepared);
      if (!isSuccessfulClaudeStart(result)) {
        throw new Error('Expected a successful Claude launch.');
      }

      broadcastTerminalOutput({
        sessionId,
        processId: result.processId,
        data: 'resume picker rendered',
      });
      await vi.advanceTimersByTimeAsync(751);

      expect(settingsStoreMocks.updateSessionConversation).toHaveBeenCalledWith(sessionId, null);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not persist a pending binding when that process exits during startup', async () => {
    vi.useFakeTimers();
    try {
      const prepared = requirePrepared(await prepare(sessionId, 'new'));
      const result = await start(prepared);
      if (!isSuccessfulClaudeStart(result)) {
        throw new Error('Expected a successful Claude launch.');
      }

      broadcastTerminalOutput({
        sessionId,
        processId: result.processId,
        data: 'partial startup output',
      });
      broadcastTerminalExit({
        sessionId,
        processId: result.processId,
        exitCode: 1,
        signal: null,
        crashed: true,
      });
      await vi.advanceTimersByTimeAsync(1000);

      expect(settingsStoreMocks.updateSessionConversation).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('continues broadcasting when one renderer disappears during a terminal event', () => {
    const healthySend = vi.fn();
    electronMocks.getAllWindows.mockReturnValue([
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: () => {
            throw new Error('renderer disappeared');
          },
        },
      },
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: healthySend,
        },
      },
    ] as never[]);

    expect(() =>
      broadcastTerminalOutput({
        sessionId,
        processId: 'process-broadcast',
        data: 'output',
      }),
    ).not.toThrow();
    expect(healthySend).toHaveBeenCalledWith(IPC_CHANNELS.terminalOutput, {
      sessionId,
      processId: 'process-broadcast',
      data: 'output',
    });
  });

  async function prepare(
    targetSessionId: string,
    launchMode: Exclude<SessionLaunchMode, 'custom'>,
  ): Promise<unknown> {
    return await invoke(IPC_CHANNELS.terminalPrepareClaude, {
      sessionId: targetSessionId,
      launchMode,
    });
  }

  async function start(
    prepared: PreparedLaunch,
    ignoredRendererFields: Record<string, unknown> = {},
    consent: { allowFreshFallback?: boolean; allowAmbiguousContinue?: boolean } = {},
  ): Promise<unknown> {
    return await invoke(IPC_CHANNELS.terminalStartClaude, {
      ...ignoredRendererFields,
      sessionId,
      planId: prepared.planId,
      allowFreshFallback: consent.allowFreshFallback ?? false,
      allowAmbiguousContinue: consent.allowAmbiguousContinue ?? false,
      cols: 100,
      rows: 30,
    });
  }
});

async function invoke(channel: string, payload: unknown): Promise<unknown> {
  const handler = electronMocks.handlers.get(channel);
  if (!handler) {
    throw new Error(`Missing IPC handler for ${channel}`);
  }
  return await handler(undefined, payload);
}

function requirePrepared(value: unknown): PreparedLaunch {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('ok' in value) ||
    value.ok !== true ||
    !('planId' in value)
  ) {
    throw new Error(`Expected a prepared Claude launch, received ${JSON.stringify(value)}.`);
  }
  return value as PreparedLaunch;
}

function isSuccessfulClaudeStart(value: unknown): value is {
  ok: true;
  processId: string;
  newConversationBinding: string | null;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    value.ok === true &&
    'newConversationBinding' in value
  );
}

function discoveryWithoutContinuation() {
  return {
    executable: 'claude-custom',
    resolvedPath: '/opt/bin/claude-custom',
    found: true,
    version: 'mock',
    capabilities: {
      helpAvailable: true,
      continueMostRecent: false,
      continueFlag: null,
      resumeSpecific: false,
      resumeFlag: null,
      nameSession: false,
      nameFlag: null,
    },
    error: null,
    checkedAt: new Date().toISOString(),
  };
}
