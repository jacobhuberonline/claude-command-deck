import Store from 'electron-store';
import { createDefaultSettings } from '../../shared/domain/defaults';
import type {
  ApplicationSettings,
  AudioPreferences,
  NotificationPreferences,
  SessionAudioPreferences,
  SessionConfiguration,
  SessionId,
} from '../../shared/domain/types';
import { applicationSettingsSchema } from '../../shared/schemas/settings';
import type { SafeLogger } from '../logging/SafeLogger';

interface StoredShape {
  settings?: unknown;
}

export class SettingsStore {
  private readonly store = new Store<StoredShape>({
    name: 'settings',
    clearInvalidConfig: false,
  });

  constructor(private readonly logger: SafeLogger) {}

  load(): ApplicationSettings {
    const raw = this.store.get('settings');
    if (!raw) {
      return createDefaultSettings();
    }

    const migrated = migrateSettings(raw);
    const parsed = applicationSettingsSchema.safeParse(migrated);

    if (!parsed.success) {
      this.logger.warn('Settings validation failed; using defaults', {
        issues: parsed.error.issues.length,
      });
      return createDefaultSettings();
    }

    return ensureSessionSet(parsed.data);
  }

  save(settings: ApplicationSettings): void {
    const parsed = applicationSettingsSchema.safeParse(ensureSessionSet(settings));
    if (!parsed.success) {
      this.logger.warn('Refused to persist invalid settings', {
        issues: parsed.error.issues.length,
      });
      return;
    }

    this.store.set('settings', parsed.data);
  }

  updateSessionConfiguration(configuration: SessionConfiguration): ApplicationSettings {
    const current = this.load();
    const next: ApplicationSettings = {
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === configuration.id ? configuration : session,
      ),
    };
    this.save(next);
    return next;
  }

  updateSessionDirectory(sessionId: SessionId, directory: string): ApplicationSettings {
    const current = this.load();
    const next: ApplicationSettings = {
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              workingDirectory: directory,
              name: session.name.startsWith('Session ') ? directoryLeaf(directory) : session.name,
              restoreOnLaunch: false,
            }
          : session,
      ),
    };
    this.save(next);
    return next;
  }

  updateAudioPreferences(preferences: AudioPreferences): ApplicationSettings {
    const current = this.load();
    const next: ApplicationSettings = {
      ...current,
      audio: preferences,
    };
    this.save(next);
    return next;
  }

  updateNotificationPreferences(preferences: NotificationPreferences): ApplicationSettings {
    const current = this.load();
    const next: ApplicationSettings = {
      ...current,
      notifications: preferences,
    };
    this.save(next);
    return next;
  }

  updateSessionAudioPreferences(
    sessionId: SessionId,
    preferences: SessionAudioPreferences,
  ): ApplicationSettings {
    const current = this.load();
    const next: ApplicationSettings = {
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              audio: preferences,
            }
          : session,
      ),
    };
    this.save(next);
    return next;
  }
}

function migrateSettings(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') {
    return raw;
  }

  const candidate = raw as Partial<ApplicationSettings>;
  if (candidate.schemaVersion === 1) {
    return raw;
  }

  return {
    ...createDefaultSettings(),
    ...candidate,
    schemaVersion: 1,
    restoreOnLaunch: undefined,
  };
}

function ensureSessionSet(settings: ApplicationSettings): ApplicationSettings {
  const defaults = createDefaultSettings();
  const byId = new Map(settings.sessions.map((session) => [session.id, session]));
  return {
    ...settings,
    sessions: defaults.sessions.map((session) => byId.get(session.id) ?? session),
  };
}

function directoryLeaf(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? value;
}
