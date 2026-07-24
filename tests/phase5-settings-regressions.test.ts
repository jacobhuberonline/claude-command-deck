import type { SafeLogger } from '../src/main/logging/SafeLogger';
import { SettingsStore } from '../src/main/persistence/SettingsStore';
import { createDefaultSettings, normalizeApplicationSettings } from '../src/shared/domain/defaults';
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

    expect(loaded.schemaVersion).toBe(2);
    expect(loaded.sessions[0]?.executable).toBe('');
    expect(loaded.sessions[1]?.executable).toBe('/opt/claude-custom');
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
});

function createVersionOneSettings() {
  const current = createDefaultSettings();
  return {
    ...current,
    schemaVersion: 1,
    sessions: current.sessions.map((session) => ({ ...session })),
  };
}
