import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../src/renderer/app/App';
import { createPhaseOneState } from '../src/shared/domain/defaults';
import type { AppStateSnapshot, AuthCheckResult } from '../src/shared/domain/types';
import type { CommandDeckBridge } from '../src/shared/ipc/contracts';

describe('phase 1 visual shell', () => {
  afterEach(() => {
    delete (window as unknown as { commandDeck?: CommandDeckBridge }).commandDeck;
  });

  it('renders the command bar, compact auth status, and exactly four session bay articles', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Claude Command Deck' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /Verify or connect authentication/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(4);
  });

  it('opens the settings shell from the command bar', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open Settings' }));

    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(within(dialog).getByRole('button', { name: 'Authentication' })).toBeInTheDocument();
    expect(within(dialog).getByText('Schema v1')).toBeInTheDocument();
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
    expect(within(status).getByText('Global Assistant')).toBeInTheDocument();

    terminal.remove();
  });

  it('focuses the global assistant from the Electron shortcut event', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    const bridge = createMockBridge(snapshot);
    window.commandDeck = bridge;

    render(<App />);

    const status = await screen.findByRole('contentinfo', { name: 'Application status' });
    expect(within(status).getByText('Global Assistant')).toBeInTheDocument();

    fireEvent.keyDown(window, { altKey: true, key: '2', code: 'Digit2' });
    expect(within(status).getByText('Session 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Global Assistant' }));
    expect(within(status).getByText('Global Assistant')).toBeInTheDocument();

    fireEvent.keyDown(window, { altKey: true, key: '2', code: 'Digit2' });
    expect(within(status).getByText('Session 2')).toBeInTheDocument();

    const shortcutListener = vi.mocked(bridge.onShortcut).mock.calls[0]?.[0];
    expect(shortcutListener).toBeDefined();

    act(() => {
      shortcutListener?.({ shortcut: 'focusGlobalAssistant' });
    });

    expect(within(status).getByText('Global Assistant')).toBeInTheDocument();
  });

  it('opens the directory picker from the session title', async () => {
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

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Change directory for Session 2',
      }),
    );

    await waitFor(() => expect(selectDirectory).toHaveBeenCalledWith({ sessionId: 'session-2' }));
  });

  it('renders the terminal as the primary session workbench', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;

    window.commandDeck = createMockBridge(snapshot);

    render(<App />);

    const article = await screen.findByRole('article', {
      name: /Global Assistant session bay/i,
    });
    expect(
      within(article).getByRole('region', { name: 'Global Assistant terminal' }),
    ).toBeInTheDocument();
    expect(within(article).getByText('haiku')).toBeInTheDocument();
    expect(within(article).getByText('Terminal test adapter')).toBeInTheDocument();
  });

  it('does not show the retired GUI prompt or output-preview layer', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    window.commandDeck = createMockBridge(snapshot);

    render(<App />);

    const article = await screen.findByRole('article', {
      name: /Global Assistant session bay/i,
    });
    expect(within(article).queryByRole('textbox', { name: /Prompt Global Assistant/i })).toBeNull();
    expect(within(article).queryByRole('button', { name: /Send prompt/i })).toBeNull();
    expect(within(article).queryByRole('button', { name: 'Console' })).toBeNull();
    expect(within(article).queryByRole('button', { name: 'Paste clipboard' })).toBeNull();
  });

  it('launches the global assistant with the configured low model', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    snapshot.sessions[0]!.configuration.workingDirectory = '/Users/example/global';
    const startClaude = vi.fn(() => Promise.resolve({ ok: true as const }));
    window.commandDeck = createMockBridge(snapshot, {}, { startClaude });

    render(<App />);

    const article = await screen.findByRole('article', {
      name: /Global Assistant session bay/i,
    });

    fireEvent.click(within(article).getByRole('button', { name: 'New' }));

    await waitFor(() =>
      expect(startClaude).toHaveBeenCalledWith({
        sessionId: 'session-1',
        workingDirectory: '/Users/example/global',
        executable: 'claude',
        args: ['--model', 'haiku'],
        cols: 80,
        rows: 16,
      }),
    );
  });

  it('starts the shell from the terminal command controls', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    snapshot.sessions[1]!.configuration.workingDirectory = '/Users/example/project';
    const startShell = vi.fn(() => Promise.resolve({ ok: true as const }));
    window.commandDeck = createMockBridge(snapshot, {}, { startShell });

    render(<App />);

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
    expect(await screen.findByText('Authentication console test adapter')).toBeInTheDocument();
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
      startClaude: vi.fn(() => Promise.resolve({ ok: true as const })),
      write: vi.fn(() => Promise.resolve({ ok: true as const })),
      resize: vi.fn(() => Promise.resolve({ ok: true as const })),
      stop: vi.fn(() => Promise.resolve({ ok: true as const })),
      getSnapshots: vi.fn(() => Promise.resolve([])),
      onOutput: vi.fn(() => off),
      onExit: vi.fn(() => off),
      onState: vi.fn(() => off),
      ...terminalOverrides,
    },
  };
}
