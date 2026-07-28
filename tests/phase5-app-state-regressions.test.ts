import type { SafeLogger } from '../src/main/logging/SafeLogger';
import { registerAppStateHandlers } from '../src/main/ipc/appState';
import type { SettingsStore } from '../src/main/persistence/SettingsStore';
import type { ProcessManager } from '../src/main/processes/ProcessManager';
import type { UsageService } from '../src/main/usage/UsageService';
import type { EntraAuthService } from '../src/main/usage/EntraAuthService';
import {
  createDefaultSessionConfiguration,
  createDefaultSettings,
} from '../src/shared/domain/defaults';
import { IPC_CHANNELS } from '../src/shared/ipc/channels';

type IpcHandler = (event: unknown, payload?: unknown) => unknown;

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  showOpenDialog: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMocks.handlers.set(channel, handler);
    }),
  },
  shell: {
    openPath: electronMocks.openPath,
    openExternal: vi.fn(),
  },
}));

describe('phase 5 app-state mutation regressions', () => {
  const settings = createDefaultSettings();
  const updateSessionConfiguration = vi.fn();
  const updateSessionOrder = vi.fn(() => true);
  const updateSessionAudioPreferences = vi.fn();
  const updateShellConfiguration = vi.fn();
  const settingsStore = {
    load: vi.fn(() => settings),
    updateSessionConfiguration,
    updateSessionOrder,
    updateSessionAudioPreferences,
    updateShellConfiguration,
  } as unknown as SettingsStore;
  const logger = {
    getLogDirectory: vi.fn(() => '/tmp/logs'),
  } as unknown as SafeLogger;
  const processManager = {
    hasActiveProcess: vi.fn(() => false),
    processEpoch: vi.fn(() => 0),
  } as unknown as ProcessManager;
  const usageService = {
    getMonthlyUsage: vi.fn(() => Promise.resolve({ ok: false as const, error: 'Not available.' })),
  } as unknown as UsageService;
  const usageAuthService = {
    getAccount: vi.fn(() => null),
    isSignedIn: vi.fn(() => false),
    signIn: vi.fn(),
    signOut: vi.fn(),
  } as unknown as EntraAuthService;

  beforeEach(() => {
    electronMocks.handlers.clear();
    vi.clearAllMocks();
    registerAppStateHandlers(
      '0.1.0-test',
      settingsStore,
      logger,
      processManager,
      usageService,
      usageAuthService,
    );
  });

  it('rejects a configuration update for an unknown session', async () => {
    const handler = getHandler(IPC_CHANNELS.appUpdateSessionConfiguration);
    const result = await handler(undefined, {
      configuration: createDefaultSessionConfiguration('session-unknown'),
    });

    expect(result).toEqual({
      ok: false,
      error: 'The selected session no longer exists.',
    });
    expect(updateSessionConfiguration).not.toHaveBeenCalled();
  });

  it('rejects an audio update for an unknown session', async () => {
    const handler = getHandler(IPC_CHANNELS.appUpdateSessionAudioPreferences);
    const result = await handler(undefined, {
      sessionId: 'session-unknown',
      preferences: createDefaultSessionConfiguration('session-unknown').audio,
    });

    expect(result).toEqual({
      ok: false,
      error: 'The selected session no longer exists.',
    });
    expect(updateSessionAudioPreferences).not.toHaveBeenCalled();
  });

  it('persists a complete validated session order', async () => {
    const handler = getHandler(IPC_CHANNELS.appUpdateSessionOrder);
    const result = await handler(undefined, {
      sessionIds: settings.sessions.map((session) => session.id),
    });

    expect(result).toEqual({ ok: true });
    expect(updateSessionOrder).toHaveBeenCalledWith(settings.sessions.map((session) => session.id));
  });

  it('rejects a session order with duplicates or unknown IDs', async () => {
    const handler = getHandler(IPC_CHANNELS.appUpdateSessionOrder);
    const duplicateResult = await handler(undefined, {
      sessionIds: [settings.sessions[0]!.id, settings.sessions[0]!.id],
    });
    const unknownResult = await handler(undefined, {
      sessionIds: ['session-unknown'],
    });

    expect(duplicateResult).toEqual({ ok: false, error: 'Invalid session order.' });
    expect(unknownResult).toEqual({
      ok: false,
      error: 'The session list changed before its order could be saved.',
    });
    expect(updateSessionOrder).not.toHaveBeenCalled();
  });

  it('persists a validated shell preference', async () => {
    const handler = getHandler(IPC_CHANNELS.appUpdateShellConfiguration);
    const result = await handler(undefined, { shellKind: 'commandPrompt' });

    expect(result).toEqual({ ok: true });
    expect(updateShellConfiguration).toHaveBeenCalledWith('commandPrompt');
  });

  it('rejects an invalid shell preference without persisting it', async () => {
    const handler = getHandler(IPC_CHANNELS.appUpdateShellConfiguration);
    const result = await handler(undefined, { shellKind: 'not-a-shell' });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid shell preference.',
    });
    expect(updateShellConfiguration).not.toHaveBeenCalled();
  });
});

function getHandler(channel: string): IpcHandler {
  const handler = electronMocks.handlers.get(channel);
  if (!handler) {
    throw new Error(`Missing IPC handler for ${channel}`);
  }
  return handler;
}
