import { randomUUID } from 'node:crypto';
import Store from 'electron-store';
import {
  createClaudeSessionName,
  createDefaultSessionConfiguration,
  createDefaultSettings,
  normalizeApplicationSettings,
} from '../../shared/domain/defaults';
import type {
  ApplicationSettings,
  AuthConfiguration,
  AudioPreferences,
  NotificationPreferences,
  SessionAudioPreferences,
  SessionConfiguration,
  SessionId,
} from '../../shared/domain/types';
import { MAX_SESSION_COUNT, SETTINGS_SCHEMA_VERSION } from '../../shared/domain/types';
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
  private cachedSettings: ApplicationSettings | null = null;

  constructor(private readonly logger: SafeLogger) {}

  load(): ApplicationSettings {
    if (this.cachedSettings) {
      return this.cachedSettings;
    }

    const raw = this.store.get('settings');
    if (!raw) {
      this.cachedSettings = createDefaultSettings();
      return this.cachedSettings;
    }

    const migrated = migrateSettings(raw);
    const parsed = applicationSettingsSchema.safeParse(migrated);

    if (!parsed.success) {
      this.logger.warn('Settings validation failed; using defaults', {
        issues: parsed.error.issues.length,
      });
      this.cachedSettings = createDefaultSettings();
      return this.cachedSettings;
    }

    const normalized = ensureSessionSet(parsed.data);
    if ((raw as Partial<ApplicationSettings>).schemaVersion !== SETTINGS_SCHEMA_VERSION) {
      this.store.set('settings', normalized);
    }
    this.cachedSettings = normalized;
    return normalized;
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
    this.cachedSettings = parsed.data;
  }

  updateSessionConfiguration(configuration: SessionConfiguration): boolean {
    const current = this.load();
    if (!current.sessions.some((session) => session.id === configuration.id)) {
      return false;
    }

    const next: ApplicationSettings = {
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === configuration.id ? configuration : session,
      ),
    };
    this.save(next);
    return true;
  }

  addSession(directory: string): SessionConfiguration | null {
    const current = this.load();
    if (current.sessions.length >= MAX_SESSION_COUNT) {
      return null;
    }

    const id = `session-${randomUUID()}`;
    const name = directoryLeaf(directory) || `Session ${current.sessions.length + 1}`;
    const configuration: SessionConfiguration = {
      ...createDefaultSessionConfiguration(id, current.sessions.length + 1),
      name,
      workingDirectory: directory,
      claudeSessionName: createClaudeSessionName(name, id),
      launchMode: 'new',
    };
    this.save({
      ...current,
      sessions: [...current.sessions, configuration],
      focusedSessionId: id,
    });
    return configuration;
  }

  removeSession(sessionId: SessionId): boolean {
    const current = this.load();
    if (
      current.sessions.length <= 1 ||
      !current.sessions.some((session) => session.id === sessionId)
    ) {
      return false;
    }

    const sessions = current.sessions.filter((session) => session.id !== sessionId);
    this.save({
      ...current,
      sessions,
      focusedSessionId:
        current.focusedSessionId === sessionId
          ? (sessions[0]?.id ?? current.focusedSessionId)
          : current.focusedSessionId,
    });
    return true;
  }

  updateSessionDirectory(sessionId: SessionId, directory: string): boolean {
    const current = this.load();
    if (!current.sessions.some((session) => session.id === sessionId)) {
      return false;
    }

    const next: ApplicationSettings = {
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              workingDirectory: directory,
              name: directoryLeaf(directory),
              claudeSessionName: createClaudeSessionName(directoryLeaf(directory), session.id),
              hasNamedConversation: false,
              launchMode: 'new',
              restoreOnLaunch: false,
            }
          : session,
      ),
    };
    this.save(next);
    return true;
  }

  updateSessionConversation(sessionId: SessionId, claudeSessionName: string | null): boolean {
    const current = this.load();
    if (!current.sessions.some((session) => session.id === sessionId)) {
      return false;
    }

    this.save({
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              claudeSessionName: claudeSessionName ?? '',
              hasNamedConversation: claudeSessionName !== null,
              launchMode: 'continueMostRecent',
            }
          : session,
      ),
    });
    return true;
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

  updateAuthConfiguration(auth: AuthConfiguration): ApplicationSettings {
    const current = this.load();
    const next: ApplicationSettings = {
      ...current,
      auth,
    };
    this.save(next);
    return next;
  }

  updateClaudeConfiguration(executable: string, baseArgs: string[]): ApplicationSettings {
    const current = this.load();
    const next: ApplicationSettings = {
      ...current,
      claudeExecutable: executable,
      claudeBaseArgs: baseArgs,
    };
    this.save(next);
    return next;
  }

  updateDeckPreferences(focusedSessionId: SessionId, focusMode: boolean): ApplicationSettings {
    const current = this.load();
    const next: ApplicationSettings = {
      ...current,
      focusedSessionId,
      focusMode,
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
  ): boolean {
    const current = this.load();
    if (!current.sessions.some((session) => session.id === sessionId)) {
      return false;
    }

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
    return true;
  }
}

export function migrateSettings(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') {
    return raw;
  }

  const candidate = raw as Partial<ApplicationSettings>;
  if (candidate.schemaVersion === 1) {
    return {
      ...candidate,
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      sessions: Array.isArray(candidate.sessions)
        ? candidate.sessions.map((session) => ({
            ...session,
            executable: session.executable === 'claude' ? '' : session.executable,
          }))
        : candidate.sessions,
    };
  }

  return {
    ...createDefaultSettings(),
    ...candidate,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    restoreOnLaunch: undefined,
  };
}

function ensureSessionSet(settings: ApplicationSettings): ApplicationSettings {
  return normalizeApplicationSettings(settings);
}

function directoryLeaf(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? value;
}
