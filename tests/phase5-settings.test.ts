import {
  createDefaultSettings,
  defaultGlobalAssistantModel,
  defaultGlobalAssistantName,
  normalizeApplicationSettings,
} from '../src/shared/domain/defaults';
import { applicationSettingsSchema } from '../src/shared/schemas/settings';

describe('phase 5 settings validation', () => {
  it('accepts the default settings shape', () => {
    const parsed = applicationSettingsSchema.safeParse(createDefaultSettings());

    expect(parsed.success).toBe(true);
  });

  it('defaults restore-on-launch to false for every bay', () => {
    const settings = createDefaultSettings();

    expect(settings.sessions).toHaveLength(4);
    expect(settings.sessions.every((session) => session.restoreOnLaunch === false)).toBe(true);
  });

  it('configures the first default bay as the low-model global assistant', () => {
    const [globalAssistant] = createDefaultSettings().sessions;

    expect(globalAssistant?.name).toBe(defaultGlobalAssistantName);
    expect(globalAssistant?.role).toBe('globalAssistant');
    expect(globalAssistant?.model).toBe(defaultGlobalAssistantModel);
  });

  it('normalizes legacy sessions with a global assistant role and model', () => {
    const legacySettings = {
      ...createDefaultSettings(),
      sessions: createDefaultSettings().sessions.map((session) => {
        const legacySession = { ...session } as Partial<typeof session>;
        delete legacySession.role;
        delete legacySession.model;
        if (legacySession.id === 'session-1') {
          legacySession.name = 'Existing Project';
        }
        return legacySession;
      }),
    };

    const parsed = applicationSettingsSchema.safeParse(legacySettings);
    expect(parsed.success).toBe(true);

    if (parsed.success) {
      const normalized = normalizeApplicationSettings(parsed.data);
      expect(normalized.sessions[0]?.name).toBe(defaultGlobalAssistantName);
      expect(normalized.sessions[0]?.role).toBe('globalAssistant');
      expect(normalized.sessions[0]?.model).toBe(defaultGlobalAssistantModel);
    }
  });

  it('rejects invalid session arrays', () => {
    const settings = {
      ...createDefaultSettings(),
      sessions: createDefaultSettings().sessions.slice(0, 3),
    };

    expect(applicationSettingsSchema.safeParse(settings).success).toBe(false);
  });
});
