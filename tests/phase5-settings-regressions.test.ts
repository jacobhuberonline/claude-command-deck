import type { SafeLogger } from '../src/main/logging/SafeLogger';
import { SettingsStore } from '../src/main/persistence/SettingsStore';
import {
  createDefaultSessionConfiguration,
  createDefaultSettings,
  normalizeApplicationSettings,
} from '../src/shared/domain/defaults';
import { applicationSettingsSchema } from '../src/shared/schemas/settings';

const storeState = vi.hoisted<{ settings: unknown }>(() => ({
  settings: undefined,
}));

vi.mock('electron-store', () => ({
  default: class {
    get(key: string) {
      return key === 'settings' ? storeState.settings : undefined;
    }

    set(key: string, value: unknown) {
      if (key === 'settings') {
        storeState.settings = value;
      }
    }
  },
}));

const logger = {
  warn: vi.fn(),
} as unknown as SafeLogger;

describe('phase 5 settings migration regressions', () => {
  beforeEach(() => {
    storeState.settings = undefined;
    vi.clearAllMocks();
  });

  it('migrates the legacy per-session claude default to global executable inheritance', () => {
    const legacy = createVersionOneSettings();
    legacy.sessions[0]!.executable = 'claude';
    legacy.sessions[1]!.executable = '/opt/claude-custom';
    storeState.settings = legacy;

    const loaded = new SettingsStore(logger).load();

    expect(loaded.schemaVersion).toBe(4);
    expect(loaded.sessions[0]?.executable).toBe('');
    expect(loaded.sessions[1]?.executable).toBe('/opt/claude-custom');
  });

  it('migrates v2 shell settings to automatic discovery without retaining the legacy field', () => {
    storeState.settings = createVersionTwoSettings();

    const loaded = new SettingsStore(logger).load();

    expect(loaded.schemaVersion).toBe(4);
    expect(loaded.shellKind).toBe('auto');
    expect(loaded).not.toHaveProperty('shellExecutable');
  });

  it('migrates v3 audio timing and hidden focus suppression defaults', () => {
    const legacy = createVersionThreeSettings();
    storeState.settings = legacy;

    const loaded = new SettingsStore(logger).load();

    expect(loaded.schemaVersion).toBe(4);
    expect(loaded.audio.completionSilenceMs).toBe(3500);
    expect(loaded.sessions[0]?.audio.onlyWhenUnfocused).toBe(false);
    expect(storeState.settings).toMatchObject({
      schemaVersion: 4,
      audio: { completionSilenceMs: 3500 },
    });
  });

  it('preserves an unnamed v1 continue-most-recent session as legacy-continuable', () => {
    const legacy = createVersionOneSettings();
    legacy.sessions[0] = {
      ...legacy.sessions[0]!,
      launchMode: 'continueMostRecent',
      claudeSessionName: '',
      hasNamedConversation: false,
    };
    storeState.settings = legacy;

    const loaded = new SettingsStore(logger).load();

    expect(loaded.sessions[0]).toMatchObject({
      launchMode: 'continueMostRecent',
      claudeSessionName: '',
      hasNamedConversation: false,
    });
  });

  it('deduplicates session IDs with the first configuration winning', () => {
    const settings = createDefaultSettings();
    const original = {
      ...settings.sessions[0]!,
      name: 'Original project',
    };
    const duplicate = {
      ...original,
      name: 'Duplicate project',
    };

    const normalized = normalizeApplicationSettings({
      ...settings,
      sessions: [original, duplicate, ...settings.sessions.slice(1)],
    });

    expect(normalized.sessions.filter((session) => session.id === original.id)).toHaveLength(1);
    expect(normalized.sessions[0]?.name).toBe('Original project');
    expect(new Set(normalized.sessions.map((session) => session.id)).size).toBe(
      normalized.sessions.length,
    );
  });

  it('rejects duplicate session IDs at the persisted settings boundary', () => {
    const settings = createDefaultSettings();
    const duplicate = {
      ...settings.sessions[0]!,
      name: 'Duplicate project',
    };

    expect(
      applicationSettingsSchema.safeParse({
        ...settings,
        sessions: [settings.sessions[0]!, duplicate, ...settings.sessions.slice(1)],
      }).success,
    ).toBe(false);
  });

  it('persists a complete session reorder and rejects partial orders', () => {
    const settings = createDefaultSettings();
    settings.sessions.push(
      createDefaultSessionConfiguration('session-2', 2),
      createDefaultSessionConfiguration('session-3', 3),
    );
    storeState.settings = settings;
    const store = new SettingsStore(logger);

    expect(store.updateSessionOrder(['session-3', 'session-1', 'session-2'])).toBe(true);
    expect(store.load().sessions.map((session) => session.id)).toEqual([
      'session-3',
      'session-1',
      'session-2',
    ]);
    expect(store.updateSessionOrder(['session-3', 'session-1'])).toBe(false);
    expect(store.updateSessionOrder(['session-3', 'session-1', 'session-unknown'])).toBe(false);
    expect(store.load().sessions.map((session) => session.id)).toEqual([
      'session-3',
      'session-1',
      'session-2',
    ]);
  });
});

function createVersionOneSettings() {
  const current = createDefaultSettings();
  current.sessions.push(createDefaultSessionConfiguration('session-2', 2));
  const legacy = { ...current, shellExecutable: 'pwsh.exe' };
  Reflect.deleteProperty(legacy, 'shellKind');
  return {
    ...legacy,
    schemaVersion: 1,
    sessions: current.sessions.map((session) => ({ ...session })),
  };
}

function createVersionTwoSettings() {
  const current = createDefaultSettings();
  const legacy = { ...current, shellExecutable: 'pwsh.exe' };
  Reflect.deleteProperty(legacy, 'shellKind');
  return {
    ...legacy,
    schemaVersion: 2,
    sessions: current.sessions.map((session) => ({ ...session })),
  };
}

function createVersionThreeSettings() {
  const current = createDefaultSettings();
  const legacyAudio = { ...current.audio };
  Reflect.deleteProperty(legacyAudio, 'completionSilenceMs');
  return {
    ...current,
    schemaVersion: 3,
    audio: legacyAudio,
    sessions: current.sessions.map((session) => ({
      ...session,
      audio: {
        ...session.audio,
        onlyWhenUnfocused: true,
      },
    })),
  };
}
