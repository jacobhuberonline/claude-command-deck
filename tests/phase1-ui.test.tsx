import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../src/renderer/app/App';
import {
  createDefaultSessionConfiguration,
  createPhaseOneState,
} from '../src/shared/domain/defaults';
import type { AppStateSnapshot, AuthCheckResult } from '../src/shared/domain/types';
import type { CommandDeckBridge } from '../src/shared/ipc/contracts';

describe('phase 1 visual shell', () => {
  afterEach(() => {
    delete (window as unknown as { commandDeck?: CommandDeckBridge }).commandDeck;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders a scalable navigator with one primary terminal workspace', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Claude Command Deck' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /Verify or connect authentication/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('searchbox', { name: 'Find a session' })).toBeInTheDocument();
  });

  it('keeps placeholder session controls unavailable until saved state loads', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    let resolveState: ((value: AppStateSnapshot) => void) | undefined;
    const bridge = createMockBridge(snapshot);
    bridge.getAppState = vi.fn(
      () =>
        new Promise<AppStateSnapshot>((resolve) => {
          resolveState = resolve;
        }),
    );
    window.commandDeck = bridge;

    render(<App />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading saved sessions');
    expect(screen.queryByRole('button', { name: 'Add session' })).toBeNull();

    await act(async () => {
      resolveState?.(snapshot);
      await Promise.resolve();
    });
    expect(await screen.findByRole('heading', { name: 'Claude Command Deck' })).toBeInTheDocument();
  });

  it('highlights search results with arrows and activates only on Enter', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    window.commandDeck = createMockBridge(snapshot);
    render(<App />);

    const search = await screen.findByRole('searchbox', { name: 'Find a session' });
    search.focus();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });

    expect(document.activeElement).toBe(search);
    expect(
      within(screen.getByRole('contentinfo', { name: 'Application status' })).getByText(
        'Session 1',
      ),
    ).toBeInTheDocument();

    fireEvent.keyDown(search, { key: 'Enter' });
    expect(
      within(screen.getByRole('contentinfo', { name: 'Application status' })).getByText(
        'Session 2',
      ),
    ).toBeInTheDocument();
    expect(document.activeElement).not.toBe(search);
  });

  it('opens the settings shell from the command bar', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open Settings' }));

    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(within(dialog).getByRole('button', { name: 'Authentication' })).toBeInTheDocument();
    expect(within(dialog).getByText('Schema v2')).toBeInTheDocument();
  });

  it('handles bay focus shortcuts while terminal input is focused', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Claude Command Deck' })).toBeInTheDocument();

    const terminal = document.createElement('div');
    terminal.className = 'xterm';
    const terminalInput = document.createElement('textarea');
    terminal.append(terminalInput);
    document.body.append(terminal);

    fireEvent.keyDown(terminalInput, { altKey: true, key: 'Unidentified', code: 'Digit2' });

    const status = screen.getByRole('contentinfo', { name: 'Application status' });
    expect(within(status).getByText('Session 2')).toBeInTheDocument();

    fireEvent.keyDown(terminalInput, { altKey: true, key: 'Unidentified', code: 'Digit2' });
    expect(within(status).getByText('Session 2')).toBeInTheDocument();

    fireEvent.keyDown(terminalInput, { altKey: true, key: 'Unidentified', code: 'Digit1' });
    expect(within(status).getByText('Session 1')).toBeInTheDocument();

    terminal.remove();
  });

  it('cycles sessions without taking terminal keyboard shortcuts away', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    const bridge = createMockBridge(snapshot);
    window.commandDeck = bridge;

    render(<App />);

    const status = await screen.findByRole('contentinfo', { name: 'Application status' });
    expect(within(status).getByText('Session 1')).toBeInTheDocument();

    fireEvent.keyDown(window, { ctrlKey: true, key: 'PageDown', code: 'PageDown' });
    expect(within(status).getByText('Session 2')).toBeInTheDocument();

    fireEvent.keyDown(window, { ctrlKey: true, key: 'PageUp', code: 'PageUp' });
    expect(within(status).getByText('Session 1')).toBeInTheDocument();
  });

  it('keeps shared-directory sessions running when bulk restart cannot ask for consent', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    snapshot.sessions[0]!.configuration = {
      ...snapshot.sessions[0]!.configuration,
      workingDirectory: '/Users/example/shared-project',
      launchMode: 'continueMostRecent',
      hasNamedConversation: false,
    };
    snapshot.sessions[0]!.runtime = {
      ...snapshot.sessions[0]!.runtime,
      processState: 'running',
      processType: 'claudeSession',
      activityState: 'idle',
    };
    snapshot.sessions[1]!.configuration.workingDirectory = '/Users/example/shared-project/';
    const stop = vi.fn(() => Promise.resolve({ ok: true as const }));
    const prepareClaude = vi.fn(() =>
      Promise.resolve({
        ...successfulClaudePreparation('continueMostRecent'),
        requiresAmbiguousContinueConsent: true,
        hasActiveProcess: true,
      }),
    );
    const bridge = createMockBridge(snapshot, {}, { stop, prepareClaude });
    window.commandDeck = bridge;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Restart active Claude sessions' }));

    await waitFor(() => expect(prepareClaude).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(bridge.terminal.startClaude).not.toHaveBeenCalled();
  });

  it('opens the directory picker from explicit session controls', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    const selectDirectory = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: 'Not available.',
        cancelled: true,
      }),
    );
    window.commandDeck = {
      ...createMockBridge(snapshot),
      selectDirectory,
    };

    render(<App />);

    const article = await screen.findByRole('article', { name: /Session 1 session bay/i });
    fireEvent.click(within(article).getByRole('button', { name: 'Change directory' }));

    await waitFor(() => expect(selectDirectory).toHaveBeenCalledWith({ sessionId: 'session-1' }));
  });

  it('adds and focuses a new directory-backed session without a fixed bay limit', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    const configuration = {
      ...createDefaultSessionConfiguration('session-dynamic-5', 5),
      name: 'payments-api',
      workingDirectory: '/Users/example/payments-api',
    };
    const addSession = vi.fn(() => Promise.resolve({ ok: true as const, configuration }));
    window.commandDeck = {
      ...createMockBridge(snapshot),
      addSession,
    };

    render(<App />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Add session' }))[0]!);

    await waitFor(() => expect(addSession).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: /^5 payments-api/i })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(
      within(screen.getByRole('contentinfo', { name: 'Application status' })).getByText(
        'payments-api',
      ),
    ).toBeInTheDocument();
  });

  it('renders the terminal as the primary session workbench', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;

    window.commandDeck = createMockBridge(snapshot);

    render(<App />);

    const article = await screen.findByRole('article', {
      name: /Session 1 session bay/i,
    });
    expect(within(article).getByRole('region', { name: 'Session 1 terminal' })).toBeInTheDocument();
    expect(within(article).getByRole('combobox', { name: 'Session 1 model' })).toHaveValue('');
    expect(within(article).getByText('Terminal test adapter')).toBeInTheDocument();
  });

  it('does not show the retired GUI prompt or output-preview layer', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    window.commandDeck = createMockBridge(snapshot);

    render(<App />);

    const article = await screen.findByRole('article', {
      name: /Session 1 session bay/i,
    });
    expect(within(article).queryByRole('textbox', { name: /Prompt Session 1/i })).toBeNull();
    expect(within(article).queryByRole('button', { name: /Send prompt/i })).toBeNull();
    expect(within(article).queryByRole('button', { name: 'Console' })).toBeNull();
    expect(within(article).queryByRole('button', { name: 'Paste clipboard' })).toBeNull();
  });

  it('requests a fresh launch through the main-owned Claude profile', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    snapshot.sessions[0]!.configuration.workingDirectory = '/Users/example/project';
    snapshot.sessions[0]!.configuration.model = 'sonnet';
    const startClaude = vi.fn<CommandDeckBridge['terminal']['startClaude']>(() =>
      Promise.resolve(successfulClaudeStart('deck-session-1-1')),
    );
    window.commandDeck = createMockBridge(snapshot, {}, { startClaude });

    render(<App />);

    const article = await screen.findByRole('article', {
      name: /Session 1 session bay/i,
    });

    fireEvent.click(within(article).getByRole('button', { name: 'Start Claude' }));

    await waitFor(() =>
      expect(startClaude).toHaveBeenCalledWith({
        sessionId: 'session-1',
        planId: '11111111-1111-4111-8111-111111111111',
        allowFreshFallback: false,
        allowAmbiguousContinue: false,
        cols: 80,
        rows: 16,
      }),
    );
  });

  it('can safely restart one running session without restarting the whole deck', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    snapshot.sessions[0]!.configuration = {
      ...snapshot.sessions[0]!.configuration,
      workingDirectory: '/Users/example/project',
      claudeSessionName: 'deck-session-1-1',
      hasNamedConversation: true,
      launchMode: 'continueMostRecent',
    };
    snapshot.sessions[0]!.runtime = {
      ...snapshot.sessions[0]!.runtime,
      processState: 'running',
      processType: 'claudeSession',
      activityState: 'idle',
    };
    const stop = vi.fn(() => Promise.resolve({ ok: true as const }));
    const prepareClaude = vi.fn(() =>
      Promise.resolve({
        ...successfulClaudePreparation('resumeSpecific'),
        hasActiveProcess: true,
      }),
    );
    const bridge = createMockBridge(snapshot, {}, { stop, prepareClaude });
    window.commandDeck = bridge;

    render(<App />);
    const article = await screen.findByRole('article', {
      name: /Session 1 session bay/i,
    });
    const continueButton = within(article).getByRole('button', { name: 'Continue' });
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    await waitFor(() =>
      expect(stop).toHaveBeenCalledWith({
        sessionId: 'session-1',
        planId: '11111111-1111-4111-8111-111111111111',
      }),
    );
    await waitFor(() => expect(bridge.terminal.startClaude).toHaveBeenCalledTimes(1));
  });

  it('applies a main-confirmed conversation binding to the local session view', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    snapshot.sessions[0]!.configuration.workingDirectory = '/Users/example/project';
    let bindingListener:
      Parameters<CommandDeckBridge['terminal']['onConversationBinding']>[0] | undefined;
    const bridge = createMockBridge(
      snapshot,
      {},
      {
        onConversationBinding: vi.fn<CommandDeckBridge['terminal']['onConversationBinding']>(
          (listener) => {
            bindingListener = listener;
            return () => undefined;
          },
        ),
      },
    );
    window.commandDeck = bridge;

    render(<App />);
    const article = await screen.findByRole('article', {
      name: /Session 1 session bay/i,
    });
    fireEvent.click(within(article).getByRole('button', { name: 'Start Claude' }));
    await waitFor(() => expect(bridge.terminal.startClaude).toHaveBeenCalledTimes(1));

    act(() => {
      bindingListener?.({
        sessionId: 'session-1',
        processId: 'process-claude-1',
        claudeSessionName: 'deck-session-1-authoritative',
      });
    });
    expect(within(article).getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('refuses to degrade an exact named resume to directory-most-recent', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    snapshot.sessions[0]!.configuration = {
      ...snapshot.sessions[0]!.configuration,
      workingDirectory: '/Users/example/project',
      claudeSessionName: 'deck-session-1-1',
      hasNamedConversation: true,
      launchMode: 'continueMostRecent',
    };
    const startClaude = vi.fn(() => Promise.resolve(successfulClaudeStart('deck-session-1-1')));
    const prepareClaude = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: 'The requested Claude conversation cannot be resumed safely.',
      }),
    );
    const bridge = createMockBridge(snapshot, {}, { startClaude, prepareClaude });
    window.commandDeck = bridge;

    render(<App />);
    const article = await screen.findByRole('article', {
      name: /Session 1 session bay/i,
    });
    fireEvent.click(within(article).getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(prepareClaude).toHaveBeenCalled());
    expect(startClaude).not.toHaveBeenCalled();
  });

  it('delegates fresh conversation naming to the main process', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    snapshot.sessions[0]!.configuration = {
      ...snapshot.sessions[0]!.configuration,
      workingDirectory: '/Users/example/project',
      claudeSessionName: 'deck-session-1-1',
      hasNamedConversation: true,
      launchMode: 'continueMostRecent',
    };
    const startClaude = vi.fn<CommandDeckBridge['terminal']['startClaude']>(() =>
      Promise.resolve(successfulClaudeStart('deck-session-1-1-feedbeef')),
    );
    window.commandDeck = createMockBridge(snapshot, {}, { startClaude });

    render(<App />);
    const article = await screen.findByRole('article', {
      name: /Session 1 session bay/i,
    });
    fireEvent.click(within(article).getByRole('button', { name: 'New' }));

    await waitFor(() => expect(startClaude).toHaveBeenCalledTimes(1));
    expect(startClaude).toHaveBeenCalledWith({
      sessionId: 'session-1',
      planId: '11111111-1111-4111-8111-111111111111',
      allowFreshFallback: false,
      allowAmbiguousContinue: false,
      cols: 80,
      rows: 16,
    });
  });

  it('starts the shell from the terminal command controls', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    snapshot.sessions[1]!.configuration.workingDirectory = '/Users/example/project';
    const startShell = vi.fn(() => Promise.resolve({ ok: true as const }));
    window.commandDeck = createMockBridge(snapshot, {}, { startShell });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /^2 Session 2/i }));
    const article = await screen.findByRole('article', {
      name: /Session 2 session bay/i,
    });
    expect(within(article).getByText('Terminal test adapter')).toBeInTheDocument();

    fireEvent.click(within(article).getByRole('button', { name: 'Shell' }));

    await waitFor(() =>
      expect(startShell).toHaveBeenCalledWith({
        sessionId: 'session-2',
        workingDirectory: '/Users/example/project',
        cols: 80,
        rows: 16,
      }),
    );
  });

  it('verifies connected auth and starts refresh from one action when the check fails', async () => {
    const snapshot = createPhaseOneState('test');
    const lastCheckedAt = new Date().toISOString();
    snapshot.settings.auth = {
      ...snapshot.settings.auth,
      startupChecksEnabled: false,
      refreshExecutable: 'aws',
      refreshArgs: ['sso', 'login'],
      checkIntervalSeconds: 3600,
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
      name: /Verify or connect authentication/i,
    });
    await waitFor(() =>
      expect(authButton).toHaveAttribute('title', expect.stringContaining('Connected')),
    );

    fireEvent.click(authButton);

    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(startRefresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Credential login console test adapter')).toBeInTheDocument();
  });
});

function createMockBridge(
  snapshot: AppStateSnapshot,
  authOverrides: Partial<CommandDeckBridge['auth']> = {},
  terminalOverrides: Partial<CommandDeckBridge['terminal']> = {},
): CommandDeckBridge {
  const off = () => undefined;

  return {
    getAppState: vi.fn(() => Promise.resolve(snapshot)),
    onShortcut: vi.fn(() => off),
    addSession: vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: 'Not available.',
        cancelled: true,
      }),
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
          resolvedPath: '/mock/claude',
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
      startShell: vi.fn(() => Promise.resolve({ ok: true as const })),
      prepareClaude: vi.fn<CommandDeckBridge['terminal']['prepareClaude']>(({ launchMode }) =>
        Promise.resolve(successfulClaudePreparation(launchMode)),
      ),
      startClaude: vi.fn(() => Promise.resolve(successfulClaudeStart('deck-session-1-1'))),
      write: vi.fn(() => Promise.resolve({ ok: true as const })),
      resize: vi.fn(() => Promise.resolve({ ok: true as const })),
      stop: vi.fn(() => Promise.resolve({ ok: true as const })),
      getSnapshots: vi.fn(() => Promise.resolve([])),
      onOutput: vi.fn(() => off),
      onExit: vi.fn(() => off),
      onState: vi.fn(() => off),
      onConversationBinding: vi.fn(() => off),
      ...terminalOverrides,
    },
  };
}

function successfulClaudeStart(newConversationBinding: string | null) {
  return {
    ok: true as const,
    processId: 'process-claude-1',
    strategy: 'new' as const,
    newConversationBinding,
    warnings: [],
  };
}

function successfulClaudePreparation(launchMode: 'new' | 'continueMostRecent' | 'resumeSpecific') {
  return {
    ok: true as const,
    planId: '11111111-1111-4111-8111-111111111111',
    strategy:
      launchMode === 'resumeSpecific'
        ? ('resumeSpecific' as const)
        : launchMode === 'continueMostRecent'
          ? ('continueMostRecent' as const)
          : ('new' as const),
    requiresFreshFallbackConsent: false,
    requiresAmbiguousContinueConsent: false,
    hasActiveProcess: false,
    warnings: [],
  };
}
