import {
  createDefaultSessionConfiguration,
  createDefaultSettings,
  normalizeApplicationSettings,
} from '../src/shared/domain/defaults';
import { MAX_SESSION_COUNT, SHELL_KINDS } from '../src/shared/domain/types';
import { applicationSettingsSchema } from '../src/shared/schemas/settings';

describe('phase 5 settings validation', () => {
  it('accepts the default settings shape', () => {
    const parsed = applicationSettingsSchema.safeParse(createDefaultSettings());

    expect(parsed.success).toBe(true);
  });

  it('accepts only supported shell kinds and defaults to automatic discovery', () => {
    const settings = createDefaultSettings();

    expect(settings.shellKind).toBe('auto');
    for (const shellKind of SHELL_KINDS) {
      expect(applicationSettingsSchema.safeParse({ ...settings, shellKind }).success).toBe(true);
    }
    expect(
      applicationSettingsSchema.safeParse({ ...settings, shellKind: 'unsupported-shell' }).success,
    ).toBe(false);
  });

  it('starts with one ordinary project profile and an opt-in credential monitor', () => {
    const settings = createDefaultSettings();

    expect(settings.sessions).toHaveLength(1);
    expect(settings.sessions.every((session) => session.role === 'project')).toBe(true);
    expect(settings.sessions.every((session) => session.model === '')).toBe(true);
    expect(settings.sessions.every((session) => session.executable === '')).toBe(true);
    expect(settings.sessions.every((session) => session.restoreOnLaunch === false)).toBe(true);
    expect(settings.auth).toMatchObject({
      provider: 'disabled',
      checkExecutable: '',
      checkArgs: [],
      startupChecksEnabled: false,
    });
  });

  it('accepts dynamic opaque session IDs beyond the original four bays', () => {
    const settings = createDefaultSettings();
    settings.sessions = Array.from({ length: 12 }, (_, index) =>
      createDefaultSessionConfiguration(`session-dynamic-${index + 1}`, index + 1),
    );
    settings.focusedSessionId = settings.sessions[11]!.id;

    expect(applicationSettingsSchema.safeParse(settings).success).toBe(true);
    expect(normalizeApplicationSettings(settings).sessions).toHaveLength(12);
  });

  it('retires a legacy Global Assistant without preserving its forced haiku override', () => {
    const settings = createDefaultSettings();
    settings.sessions[0] = {
      ...settings.sessions[0]!,
      name: 'Global Assistant',
      role: 'globalAssistant',
      model: 'haiku',
      claudeSessionName: '',
    };

    const normalized = normalizeApplicationSettings(settings);

    expect(normalized.sessions[0]?.name).toBe('Session 1');
    expect(normalized.sessions[0]?.role).toBe('project');
    expect(normalized.sessions[0]?.model).toBe('');
  });

  it('repairs a focused session ID that no longer exists', () => {
    const settings = createDefaultSettings();
    settings.focusedSessionId = 'removed-session';

    expect(normalizeApplicationSettings(settings).focusedSessionId).toBe(settings.sessions[0]?.id);
  });

  it('rejects empty or unbounded session arrays', () => {
    const settings = createDefaultSettings();
    const tooMany = Array.from({ length: MAX_SESSION_COUNT + 1 }, (_, index) =>
      createDefaultSessionConfiguration(`session-${index + 1}`, index + 1),
    );

    expect(applicationSettingsSchema.safeParse({ ...settings, sessions: [] }).success).toBe(false);
    expect(applicationSettingsSchema.safeParse({ ...settings, sessions: tooMany }).success).toBe(
      false,
    );
  });
});
