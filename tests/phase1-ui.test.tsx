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
        name: /Open credential monitor/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
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
    const snapshot = createMultiSessionState();
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
    expect(within(dialog).getByRole('button', { name: 'Credential monitor' })).toBeInTheDocument();
    expect(within(dialog).getByText('Schema v4')).toBeInTheDocument();
  });

  it('handles bay focus shortcuts while terminal input is focused', async () => {
    const snapshot = createMultiSessionState();
    window.commandDeck = createMockBridge(snapshot);
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
    const snapshot = createMultiSessionState();
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

  it('reorders navigator sessions by drag and keyboard and persists each order', async () => {
    const snapshot = createMultiSessionState();
    snapshot.settings.auth.startupChecksEnabled = false;
    const updateSessionOrder = vi.fn(() => Promise.resolve({ ok: true as const }));
    const bridge = createMockBridge(snapshot);
    bridge.updateSessionOrder = updateSessionOrder;
    window.commandDeck = bridge;

    render(<App />);

    const sourceHandle = await screen.findByRole('button', { name: /^Move Session 3/ });
    const targetButton = screen.getByRole('button', { name: /^1 Session 1/i });
    const targetRow = targetButton.closest<HTMLElement>('.session-list-row');
    expect(targetRow).not.toBeNull();
    vi.spyOn(targetRow!, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 20,
      height: 20,
      left: 0,
      right: 280,
      width: 280,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const dataTransfer = createDataTransfer('session-3');

    fireEvent.dragStart(sourceHandle, { dataTransfer });
    fireEvent.dragOver(targetRow!, { clientY: 1, dataTransfer });
    fireEvent.drop(targetRow!, { clientY: 1, dataTransfer });

    await waitFor(() =>
      expect(updateSessionOrder).toHaveBeenNthCalledWith(1, {
        sessionIds: ['session-1', 'session-3', 'session-2', 'session-4'],
      }),
    );
    expect(screen.getByRole('button', { name: /^2 Session 3/i })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('button', { name: /^Move Session 1/ }), {
      key: 'ArrowDown',
    });

    await waitFor(() =>
      expect(updateSessionOrder).toHaveBeenNthCalledWith(2, {
        sessionIds: ['session-3', 'session-1', 'session-2', 'session-4'],
      }),
    );
    expect(screen.getByRole('button', { name: /^1 Session 3/i })).toBeInTheDocument();
    expect(screen.getByText('Session 1 moved to position 2 of 4.')).toBeInTheDocument();

    fireEvent.keyDown(window, { altKey: true, key: 'Unidentified', code: 'Digit1' });
    expect(
      within(screen.getByRole('contentinfo', { name: 'Application status' })).getByText(
        'Session 3',
      ),
    ).toBeInTheDocument();
  });

  it('restores the saved navigator order when persistence fails', async () => {
    const snapshot = createMultiSessionState();
    snapshot.settings.auth.startupChecksEnabled = false;
    const bridge = createMockBridge(snapshot);
    const updateSessionOrder = vi.fn(() => Promise.reject(new Error('Storage unavailable.')));
    bridge.updateSessionOrder = updateSessionOrder;
    window.commandDeck = bridge;

    render(<App />);
    fireEvent.keyDown(await screen.findByRole('button', { name: /^Move Session 2/ }), {
      key: 'ArrowUp',
    });

    await waitFor(() =>
      expect(updateSessionOrder).toHaveBeenCalledWith({
        sessionIds: ['session-2', 'session-1', 'session-3', 'session-4'],
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^1 Session 1/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /^2 Session 2/i })).toBeInTheDocument();
  });

  it('keeps shared-directory sessions running when bulk restart cannot ask for consent', async () => {
    const snapshot = createMultiSessionState();
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
    const snapshot = createMultiSessionState();
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
    const snapshot = createMultiSessionState();
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

  it('returns keyboard focus to the terminal when a resumed process starts', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    snapshot.sessions[0]!.configuration.workingDirectory = '/Users/example/project';
    let stateListener: Parameters<CommandDeckBridge['terminal']['onState']>[0] | undefined;
    let processCount = 0;
    const bridge = createMockBridge(
      snapshot,
      {},
      {
        startClaude: vi.fn(() => {
          processCount += 1;
          return Promise.resolve(
            successfulClaudeStart('deck-session-1-1', `process-claude-${processCount}`),
          );
        }),
        onState: vi.fn<CommandDeckBridge['terminal']['onState']>((listener) => {
          stateListener = listener;
          return () => undefined;
        }),
      },
    );
    window.commandDeck = bridge;

    render(<App />);
    const article = await screen.findByRole('article', {
      name: /Session 1 session bay/i,
    });
    const resumeButton = within(article).getByRole('button', { name: 'Resume…' });
    const terminalHost = article.querySelector<HTMLElement>('.terminal-host');
    expect(terminalHost).not.toBeNull();

    for (let restart = 1; restart <= 3; restart += 1) {
      resumeButton.focus();
      expect(document.activeElement).toBe(resumeButton);
      fireEvent.click(resumeButton);

      await waitFor(() => expect(bridge.terminal.startClaude).toHaveBeenCalledTimes(restart));
      await waitFor(() => expect(document.activeElement).toBe(terminalHost));

      act(() => {
        stateListener?.({
          sessionId: 'session-1',
          snapshot: {
            id: `process-claude-${restart}`,
            type: 'claudeSession',
            sessionId: 'session-1',
            workingDirectory: '/Users/example/project',
            executable: '/mock/claude',
            args: ['--resume'],
            startedAt: new Date().toISOString(),
            state: 'running',
            restartGeneration: restart,
          },
        });
      });
      await waitFor(() => expect(resumeButton).toBeEnabled());
    }
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
    const snapshot = createMultiSessionState();
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
        shellKind: 'auto',
        cols: 80,
        rows: 16,
      }),
    );
  });

  it('persists an inline shell selection and uses it for the next shell launch', async () => {
    const snapshot = createMultiSessionState();
    snapshot.settings.auth.startupChecksEnabled = false;
    snapshot.sessions[1]!.configuration.workingDirectory = '/Users/example/project';
    const updateShellConfiguration = vi.fn(() => Promise.resolve({ ok: true as const }));
    const startShell = vi.fn(() => Promise.resolve({ ok: true as const }));
    const bridge = createMockBridge(snapshot, {}, { startShell });
    bridge.updateShellConfiguration = updateShellConfiguration;
    window.commandDeck = bridge;

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /^2 Session 2/i }));
    const article = await screen.findByRole('article', {
      name: /Session 2 session bay/i,
    });
    const shellSelector = await within(article).findByRole('combobox', {
      name: 'Session 2 default shell for all new shell launches',
    });

    fireEvent.change(shellSelector, { target: { value: 'commandPrompt' } });

    await waitFor(() =>
      expect(updateShellConfiguration).toHaveBeenCalledWith({ shellKind: 'commandPrompt' }),
    );
    fireEvent.click(within(article).getByRole('button', { name: 'Shell' }));

    await waitFor(() =>
      expect(startShell).toHaveBeenCalledWith({
        sessionId: 'session-2',
        workingDirectory: '/Users/example/project',
        shellKind: 'commandPrompt',
        cols: 80,
        rows: 16,
      }),
    );
  });

  it('rolls back an inline shell selection when the preference cannot be saved', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    snapshot.sessions[0]!.configuration.workingDirectory = '/Users/example/project';
    const updateShellConfiguration = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: 'Settings are unavailable.' }),
    );
    const bridge = createMockBridge(snapshot);
    bridge.updateShellConfiguration = updateShellConfiguration;
    window.commandDeck = bridge;

    render(<App />);

    const article = await screen.findByRole('article', {
      name: /Session 1 session bay/i,
    });
    const shellSelector = await within(article).findByRole('combobox', {
      name: 'Session 1 default shell for all new shell launches',
    });

    fireEvent.change(shellSelector, { target: { value: 'commandPrompt' } });

    await waitFor(() =>
      expect(updateShellConfiguration).toHaveBeenCalledWith({ shellKind: 'commandPrompt' }),
    );
    await waitFor(() => expect(shellSelector).toHaveValue('auto'));
  });

  it('commits text settings on blur and restores the saved value after an IPC failure', async () => {
    const snapshot = createPhaseOneState('test');
    const updateClaudeConfiguration = vi.fn(() =>
      Promise.reject(new Error('Settings storage is unavailable.')),
    );
    const bridge = createMockBridge(snapshot);
    bridge.updateClaudeConfiguration = updateClaudeConfiguration;
    window.commandDeck = bridge;

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Claude Code' }));
    const executable = within(dialog).getByRole('textbox', { name: 'Default executable' });

    fireEvent.change(executable, { target: { value: '/missing/claude' } });
    expect(updateClaudeConfiguration).not.toHaveBeenCalled();
    fireEvent.blur(executable);

    await waitFor(() =>
      expect(updateClaudeConfiguration).toHaveBeenCalledWith({
        executable: '/missing/claude',
        baseArgs: [],
      }),
    );
    await waitFor(() =>
      expect(within(dialog).getByRole('textbox', { name: 'Default executable' })).toHaveValue(
        'claude',
      ),
    );
  });

  it('ignores stale state and exit events after a newer process becomes active', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.sessions[0]!.configuration.workingDirectory = '/Users/example/project';
    const stateListeners: Array<Parameters<CommandDeckBridge['terminal']['onState']>[0]> = [];
    const exitListeners: Array<Parameters<CommandDeckBridge['terminal']['onExit']>[0]> = [];
    window.commandDeck = createMockBridge(
      snapshot,
      {},
      {
        onState: vi.fn<CommandDeckBridge['terminal']['onState']>((listener) => {
          stateListeners.push(listener);
          return () => undefined;
        }),
        onExit: vi.fn<CommandDeckBridge['terminal']['onExit']>((listener) => {
          exitListeners.push(listener);
          return () => undefined;
        }),
      },
    );

    render(<App />);
    const article = await screen.findByRole('article', {
      name: /Session 1 session bay/i,
    });
    act(() => {
      stateListeners.forEach((listener) =>
        listener({
          sessionId: 'session-1',
          snapshot: {
            id: 'process-current',
            type: 'shellSession',
            sessionId: 'session-1',
            workingDirectory: '/Users/example/project',
            executable: 'zsh',
            args: [],
            startedAt: new Date().toISOString(),
            state: 'running',
            restartGeneration: 0,
          },
        }),
      );
    });
    expect(await within(article).findByText('zsh is attached to this bay.')).toBeInTheDocument();

    act(() => {
      stateListeners.forEach((listener) =>
        listener({
          sessionId: 'session-1',
          snapshot: {
            id: 'process-stale',
            type: 'claudeSession',
            sessionId: 'session-1',
            workingDirectory: '/Users/example/project',
            executable: 'claude',
            args: [],
            startedAt: new Date().toISOString(),
            state: 'running',
            restartGeneration: 0,
          },
        }),
      );
      exitListeners.forEach((listener) =>
        listener({
          sessionId: 'session-1',
          processId: 'process-stale',
          exitCode: 0,
          signal: null,
          crashed: false,
        }),
      );
    });

    expect(within(article).getByText('zsh is attached to this bay.')).toBeInTheDocument();
  });

  it('plays the error cue when the active session process crashes', async () => {
    const snapshot = createPhaseOneState('test');
    snapshot.settings.auth.startupChecksEnabled = false;
    snapshot.sessions[0]!.configuration.workingDirectory = '/Users/example/project';
    const stateListeners: Array<Parameters<CommandDeckBridge['terminal']['onState']>[0]> = [];
    const exitListeners: Array<Parameters<CommandDeckBridge['terminal']['onExit']>[0]> = [];
    window.commandDeck = createMockBridge(
      snapshot,
      {},
      {
        onState: vi.fn<CommandDeckBridge['terminal']['onState']>((listener) => {
          stateListeners.push(listener);
          return () => undefined;
        }),
        onExit: vi.fn<CommandDeckBridge['terminal']['onExit']>((listener) => {
          exitListeners.push(listener);
          return () => undefined;
        }),
      },
    );
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    play.mockClear();

    render(<App />);
    const article = await screen.findByRole('article', {
      name: /Session 1 session bay/i,
    });

    act(() => {
      stateListeners.forEach((listener) =>
        listener({
          sessionId: 'session-1',
          snapshot: {
            id: 'process-current',
            type: 'claudeSession',
            sessionId: 'session-1',
            workingDirectory: '/Users/example/project',
            executable: 'claude',
            args: [],
            startedAt: new Date().toISOString(),
            state: 'running',
            restartGeneration: 0,
          },
        }),
      );
      exitListeners.forEach((listener) =>
        listener({
          sessionId: 'session-1',
          processId: 'process-current',
          exitCode: 1,
          signal: null,
          crashed: true,
        }),
      );
    });

    expect(await within(article).findByText('Process exited unexpectedly.')).toBeInTheDocument();
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
  });

  it('verifies connected auth and starts refresh from one action when the check fails', async () => {
    const snapshot = createPhaseOneState('test');
    const lastCheckedAt = new Date().toISOString();
    snapshot.settings.auth = {
      ...snapshot.settings.auth,
      provider: 'aws',
      checkExecutable: 'aws',
      checkArgs: ['sts', 'get-caller-identity', '--output', 'json'],
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
      name: /Open credential monitor/i,
    });
    await waitFor(() =>
      expect(authButton).toHaveAttribute('title', expect.stringContaining('Connected')),
    );

    fireEvent.click(authButton);

    await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
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
    updateShellConfiguration: vi.fn(() => Promise.resolve({ ok: true as const })),
    updateAudioPreferences: vi.fn(() => Promise.resolve({ ok: true as const })),
    updateClaudeConfiguration: vi.fn(() => Promise.resolve({ ok: true as const })),
    updateDeckPreferences: vi.fn(() => Promise.resolve({ ok: true as const })),
    updateNotificationPreferences: vi.fn(() => Promise.resolve({ ok: true as const })),
    updateSessionConfiguration: vi.fn(() => Promise.resolve({ ok: true as const })),
    updateSessionOrder: vi.fn(() => Promise.resolve({ ok: true as const })),
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
      getShellOptions: vi.fn(() =>
        Promise.resolve([
          { kind: 'auto' as const, label: 'Automatic', available: true },
          { kind: 'commandPrompt' as const, label: 'Command Prompt', available: true },
        ]),
      ),
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

function createMultiSessionState(): AppStateSnapshot {
  const snapshot = createPhaseOneState('test');
  const runtimeTemplate = snapshot.sessions[0]!.runtime;
  for (let index = 2; index <= 4; index += 1) {
    const configuration = createDefaultSessionConfiguration(`session-${index}`, index);
    snapshot.settings.sessions.push(configuration);
    snapshot.sessions.push({
      configuration,
      runtime: { ...runtimeTemplate },
    });
  }
  return snapshot;
}

function successfulClaudeStart(
  newConversationBinding: string | null,
  processId = 'process-claude-1',
) {
  return {
    ok: true as const,
    processId,
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

function createDataTransfer(sessionId: string): DataTransfer {
  let storedSessionId = sessionId;
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: vi.fn((_format: string, value: string) => {
      storedSessionId = value;
    }),
    getData: vi.fn(() => storedSessionId),
  } as unknown as DataTransfer;
}
