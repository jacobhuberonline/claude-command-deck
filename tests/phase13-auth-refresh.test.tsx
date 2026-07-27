import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../src/renderer/app/App';
import { createPhaseOneState } from '../src/shared/domain/defaults';
import type { AppStateSnapshot, AuthCheckResult } from '../src/shared/domain/types';
import type { CommandDeckBridge } from '../src/shared/ipc/contracts';

describe('phase 13 authentication refresh orchestration', () => {
  afterEach(() => {
    delete (window as unknown as { commandDeck?: CommandDeckBridge }).commandDeck;
    vi.restoreAllMocks();
  });

  it('starts configured login when a stale auth check finds expired credentials', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    const snapshot = createPhaseOneState('test');
    const lastCheckedAt = new Date(Date.now() - 120_000).toISOString();
    snapshot.settings.auth = {
      ...snapshot.settings.auth,
      provider: 'aws',
      checkExecutable: 'aws',
      checkArgs: ['sts', 'get-caller-identity', '--output', 'json'],
      startupChecksEnabled: false,
      refreshExecutable: 'aws',
      refreshArgs: ['sso', 'login'],
      checkIntervalSeconds: 30,
    };
    snapshot.auth = {
      provider: 'aws',
      status: 'connected',
      label: 'Connected',
      details: 'AWS account 123456789012',
      lastCheckedAt,
      lastSuccessfulCheckAt: lastCheckedAt,
    };

    const check = vi.fn((): Promise<AuthCheckResult> =>
      Promise.resolve({
        status: 'disconnected',
        checkedAt: new Date().toISOString(),
        error: 'SSO session expired.',
      }),
    );
    const startRefresh = vi.fn(() => Promise.resolve({ ok: true as const }));
    window.commandDeck = createMockBridge(snapshot, {
      check,
      startRefresh,
    });

    render(<App />);

    const authButton = await screen.findByRole('button', {
      name: /Open credential monitor/i,
    });
    await waitFor(() =>
      expect(authButton).toHaveAttribute('title', expect.stringContaining('Connected')),
    );

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(startRefresh).toHaveBeenCalledTimes(1));
  });

  it('confirms an initial AWS failure before publishing a disconnected state', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth = {
      ...snapshot.settings.auth,
      provider: 'aws',
      checkExecutable: 'aws',
      checkArgs: ['sts', 'get-caller-identity', '--output', 'json'],
      startupChecksEnabled: true,
      refreshExecutable: 'aws',
      refreshArgs: ['sso', 'login'],
    };

    const check = vi
      .fn<CommandDeckBridge['auth']['check']>()
      .mockResolvedValueOnce({
        status: 'disconnected',
        checkedAt: new Date().toISOString(),
        error: 'Temporary startup failure.',
      })
      .mockResolvedValueOnce({
        status: 'connected',
        checkedAt: new Date().toISOString(),
      });
    const startRefresh = vi.fn(() => Promise.resolve({ ok: true as const }));
    window.commandDeck = createMockBridge(snapshot, {
      check,
      startRefresh,
    });

    render(<App />);

    await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    expect(startRefresh).not.toHaveBeenCalled();
    expect(
      await screen.findByRole('button', {
        name: /AWS credential check passed.*does not directly inspect running Claude sessions/i,
      }),
    ).toBeInTheDocument();
  });

  it('confirms a transient failure before replacing a known-good credential status', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    const snapshot = createPhaseOneState('test');
    const lastCheckedAt = new Date(Date.now() - 120_000).toISOString();
    snapshot.settings.auth = {
      ...snapshot.settings.auth,
      provider: 'aws',
      checkExecutable: 'aws',
      checkArgs: ['sts', 'get-caller-identity', '--output', 'json'],
      startupChecksEnabled: false,
      refreshExecutable: 'aws',
      refreshArgs: ['sso', 'login'],
      checkIntervalSeconds: 30,
    };
    snapshot.auth = {
      provider: 'aws',
      status: 'connected',
      label: 'AWS credential check passed',
      details: 'Previously verified.',
      lastCheckedAt,
      lastSuccessfulCheckAt: lastCheckedAt,
    };

    const check = vi
      .fn<CommandDeckBridge['auth']['check']>()
      .mockResolvedValueOnce({
        status: 'disconnected',
        checkedAt: new Date().toISOString(),
        error: 'Temporary credential probe failure.',
      })
      .mockResolvedValueOnce({
        status: 'connected',
        checkedAt: new Date().toISOString(),
      });
    const startRefresh = vi.fn(() => Promise.resolve({ ok: true as const }));
    window.commandDeck = createMockBridge(snapshot, {
      check,
      startRefresh,
    });

    render(<App />);
    await screen.findByRole('button', { name: /Open credential monitor/i });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    expect(startRefresh).not.toHaveBeenCalled();
    const authButton = screen.getByRole('button', {
      name: /Open credential monitor/i,
    });
    await waitFor(() =>
      expect(authButton).toHaveAccessibleName(
        /AWS credential check passed.*does not directly inspect running Claude sessions/i,
      ),
    );
  });

  it('rechecks credentials instead of treating a cancelled login as disconnection', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth = {
      ...snapshot.settings.auth,
      provider: 'aws',
      checkExecutable: 'aws',
      checkArgs: ['sts', 'get-caller-identity', '--output', 'json'],
      startupChecksEnabled: false,
    };
    const checkedAt = new Date().toISOString();
    snapshot.auth = {
      provider: 'aws',
      status: 'connected',
      label: 'AWS credential check passed',
      details: 'Previously verified.',
      lastCheckedAt: checkedAt,
      lastSuccessfulCheckAt: checkedAt,
    };

    let exitListener: Parameters<CommandDeckBridge['auth']['onExit']>[0] | undefined;
    const check = vi.fn<CommandDeckBridge['auth']['check']>(() =>
      Promise.resolve({
        status: 'connected',
        checkedAt: new Date().toISOString(),
      }),
    );
    const startRefresh = vi.fn(() => Promise.resolve({ ok: true as const }));
    window.commandDeck = createMockBridge(snapshot, {
      check,
      startRefresh,
      onExit: vi.fn<CommandDeckBridge['auth']['onExit']>((listener) => {
        exitListener = listener;
        return () => undefined;
      }),
    });

    render(<App />);
    await screen.findByRole('button', { name: /Open credential monitor/i });

    act(() => {
      exitListener?.({ exitCode: 130, signal: 'SIGTERM' });
    });

    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(startRefresh).not.toHaveBeenCalled();
    expect(
      await screen.findByRole('button', {
        name: /AWS credential check passed.*does not directly inspect running Claude sessions/i,
      }),
    ).toBeInTheDocument();
  });

  it('does not let a pre-login console check overwrite a newly restarted login', async () => {
    const snapshot = createPhaseOneState('test');
    const checkedAt = new Date().toISOString();
    snapshot.settings.auth = {
      ...snapshot.settings.auth,
      provider: 'aws',
      checkExecutable: 'aws',
      checkArgs: ['sts', 'get-caller-identity', '--output', 'json'],
      startupChecksEnabled: false,
      refreshExecutable: 'aws',
      refreshArgs: ['sso', 'login'],
    };
    snapshot.auth = {
      provider: 'aws',
      status: 'connected',
      label: 'AWS credential check passed',
      details: 'Previously verified.',
      lastCheckedAt: checkedAt,
      lastSuccessfulCheckAt: checkedAt,
    };

    let exitListener: Parameters<CommandDeckBridge['auth']['onExit']>[0] | undefined;
    let resolvePostExitCheck: ((result: AuthCheckResult) => void) | undefined;
    const postExitCheck = new Promise<AuthCheckResult>((resolve) => {
      resolvePostExitCheck = resolve;
    });
    const disconnectedResult = {
      status: 'disconnected' as const,
      checkedAt: new Date().toISOString(),
      error: 'Credentials expired.',
    };
    const check = vi
      .fn<CommandDeckBridge['auth']['check']>()
      .mockResolvedValueOnce(disconnectedResult)
      .mockResolvedValueOnce(disconnectedResult)
      .mockReturnValueOnce(postExitCheck);
    const startRefresh = vi.fn(() => Promise.resolve({ ok: true as const }));
    window.commandDeck = createMockBridge(snapshot, {
      check,
      startRefresh,
      onExit: vi.fn<CommandDeckBridge['auth']['onExit']>((listener) => {
        exitListener = listener;
        return () => undefined;
      }),
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Open credential monitor/i }));
    await waitFor(() => expect(startRefresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Credential login console test adapter')).toBeInTheDocument();

    act(() => {
      exitListener?.({ exitCode: 0, signal: null });
    });
    await waitFor(() => expect(check).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole('button', { name: 'Start login' }));
    await waitFor(() => expect(startRefresh).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolvePostExitCheck?.({
        status: 'connected',
        checkedAt: new Date().toISOString(),
      });
      await postExitCheck;
    });

    expect(
      screen.getByRole('button', {
        name: /AWS credential login running/i,
      }),
    ).toBeInTheDocument();
  });
});

function createMockBridge(
  snapshot: AppStateSnapshot,
  authOverrides: Partial<CommandDeckBridge['auth']> = {},
): CommandDeckBridge {
  const off = () => undefined;

  return {
    getAppState: vi.fn(() => Promise.resolve(snapshot)),
    onShortcut: vi.fn(() => off),
    addSession: vi.fn(() =>
      Promise.resolve({ ok: false as const, error: 'Not available.', cancelled: true }),
    ),
    removeSession: vi.fn(() => Promise.resolve({ ok: true as const })),
    openDirectory: vi.fn(() => Promise.resolve({ ok: false as const, error: 'Not available.' })),
    openLogDirectory: vi.fn(() => Promise.resolve({ ok: false as const, error: 'Not available.' })),
    selectDirectory: vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: 'Not available.',
        cancelled: true,
      }),
    ),
    updateAuthConfiguration: vi.fn(() => Promise.resolve({ ok: true as const })),
    updateShellConfiguration: vi.fn(() => Promise.resolve({ ok: true as const })),
    updateAudioPreferences: vi.fn(() => Promise.resolve({ ok: true as const })),
    updateClaudeConfiguration: vi.fn(() => Promise.resolve({ ok: true as const })),
    updateDeckPreferences: vi.fn(() => Promise.resolve({ ok: true as const })),
    updateNotificationPreferences: vi.fn(() => Promise.resolve({ ok: true as const })),
    updateSessionConfiguration: vi.fn(() => Promise.resolve({ ok: true as const })),
    updateSessionAudioPreferences: vi.fn(() => Promise.resolve({ ok: true as const })),
    claude: {
      discover: vi.fn(() =>
        Promise.resolve({
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
        }),
      ),
    },
    auth: {
      check: vi.fn(() =>
        Promise.resolve({
          status: 'connected' as const,
          checkedAt: new Date().toISOString(),
        }),
      ),
      startRefresh: vi.fn(() => Promise.resolve({ ok: true as const })),
      write: vi.fn(() => Promise.resolve({ ok: true as const })),
      resize: vi.fn(() => Promise.resolve({ ok: true as const })),
      stopRefresh: vi.fn(() => Promise.resolve({ ok: true as const })),
      onOutput: vi.fn(() => off),
      onExit: vi.fn(() => off),
      ...authOverrides,
    },
    terminal: {
      getShellOptions: vi.fn(() => Promise.resolve([])),
      startShell: vi.fn(() => Promise.resolve({ ok: true as const })),
      prepareClaude: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          planId: '11111111-1111-4111-8111-111111111111',
          strategy: 'new' as const,
          requiresFreshFallbackConsent: false,
          requiresAmbiguousContinueConsent: false,
          hasActiveProcess: false,
          warnings: [],
        }),
      ),
      startClaude: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          processId: 'process-claude-1',
          strategy: 'new' as const,
          newConversationBinding: 'deck-session-1-1',
          warnings: [],
        }),
      ),
      write: vi.fn(() => Promise.resolve({ ok: true as const })),
      resize: vi.fn(() => Promise.resolve({ ok: true as const })),
      stop: vi.fn(() => Promise.resolve({ ok: true as const })),
      getSnapshots: vi.fn(() => Promise.resolve([])),
      onOutput: vi.fn(() => off),
      onExit: vi.fn(() => off),
      onState: vi.fn(() => off),
      onConversationBinding: vi.fn(() => off),
    },
  };
}
