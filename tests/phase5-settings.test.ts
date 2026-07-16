import { createDefaultSettings } from '../src/shared/domain/defaults';
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

  it('rejects invalid session arrays', () => {
    const settings = {
      ...createDefaultSettings(),
      sessions: createDefaultSettings().sessions.slice(0, 3),
    };

    expect(applicationSettingsSchema.safeParse(settings).success).toBe(false);
  });
});
