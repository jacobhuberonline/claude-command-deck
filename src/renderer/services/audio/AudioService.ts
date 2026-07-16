import type {
  AudioEvent,
  AudioPreferences,
  SessionAudioPreferences,
  SessionId,
} from '../../../shared/domain/types';

export interface SoundAsset {
  id: string;
  url: string;
}

export type SoundRegistry = Partial<Record<AudioEvent, SoundAsset>>;

export interface AudioEventContext {
  preferences: AudioPreferences;
  sessionId?: SessionId | undefined;
  sessionPreferences?: SessionAudioPreferences | undefined;
  focusedSessionId?: SessionId | undefined;
  appFocused: boolean;
  relevantSessionWatched: boolean;
  now?: Date | undefined;
  force?: boolean | undefined;
}

export type AudioDecisionReason =
  | 'played'
  | 'state_reset'
  | 'no_sound'
  | 'master_muted'
  | 'do_not_disturb'
  | 'quiet_hours'
  | 'event_disabled'
  | 'session_disabled'
  | 'focused_suppression'
  | 'latched'
  | 'cooldown'
  | 'playback_failed';

export interface AudioDecision {
  event: AudioEvent;
  played: boolean;
  reason: AudioDecisionReason;
  asset?: SoundAsset | undefined;
}

export type SoundPlayer = (asset: SoundAsset, volume: number) => Promise<void> | void;

export const defaultSoundRegistry: SoundRegistry = {
  'session.ready': { id: 'session-ready', url: '/sounds/session-ready.wav' },
  'session.estimated_completion': {
    id: 'estimated-completion',
    url: '/sounds/estimated-completion.wav',
  },
  'session.likely_awaiting_input': { id: 'attention', url: '/sounds/attention.wav' },
  'session.possible_permission_prompt': { id: 'attention', url: '/sounds/attention.wav' },
  'session.authentication_may_be_required': { id: 'attention', url: '/sounds/attention.wav' },
  'session.reload_completed': { id: 'session-ready', url: '/sounds/session-ready.wav' },
  'session.reload_failed': { id: 'error', url: '/sounds/error.wav' },
  'session.crashed': { id: 'error', url: '/sounds/error.wav' },
  'auth.connected': { id: 'auth-connected', url: '/sounds/auth-connected.wav' },
  'auth.disconnected': { id: 'auth-disconnected', url: '/sounds/auth-disconnected.wav' },
  'auth.refresh_failed': { id: 'error', url: '/sounds/error.wav' },
  'reload_all.completed': { id: 'reload-all-complete', url: '/sounds/reload-all-complete.wav' },
  'reload_all.partially_failed': {
    id: 'reload-all-warning',
    url: '/sounds/reload-all-warning.wav',
  },
};

export class AudioService {
  private readonly cooldowns = new Map<string, number>();

  private readonly completionLatch = new Set<SessionId>();

  private authDisconnectedLatched = false;

  constructor(
    private readonly registry: SoundRegistry = defaultSoundRegistry,
    private readonly player: SoundPlayer = htmlAudioPlayer,
  ) {}

  async handleEvent(event: AudioEvent, context: AudioEventContext): Promise<AudioDecision> {
    const now = context.now ?? new Date();

    if (event === 'session.activity_started') {
      if (context.sessionId) {
        this.completionLatch.delete(context.sessionId);
      }
      return { event, played: false, reason: 'state_reset' };
    }

    if (event === 'auth.connected') {
      this.authDisconnectedLatched = false;
    }

    if (event === 'session.activity_stopped') {
      return { event, played: false, reason: 'no_sound' };
    }

    const asset = this.registry[event];
    if (!asset) {
      return { event, played: false, reason: 'no_sound' };
    }

    const suppression = this.getSuppressionReason(event, context, now);
    if (suppression) {
      return { event, played: false, reason: suppression, asset };
    }

    if (!context.force && this.isLatched(event, context.sessionId)) {
      return { event, played: false, reason: 'latched', asset };
    }

    const cooldownKey = this.cooldownKey(event, context.sessionId);
    const lastPlayedAt = this.cooldowns.get(cooldownKey);
    if (
      !context.force &&
      lastPlayedAt !== undefined &&
      now.getTime() - lastPlayedAt < context.preferences.cooldownMs
    ) {
      return { event, played: false, reason: 'cooldown', asset };
    }

    try {
      await this.player(asset, this.volumeFor(context.preferences, context.sessionPreferences));
    } catch {
      return { event, played: false, reason: 'playback_failed', asset };
    }

    this.cooldowns.set(cooldownKey, now.getTime());
    this.latch(event, context.sessionId);
    return { event, played: true, reason: 'played', asset };
  }

  private getSuppressionReason(
    event: AudioEvent,
    context: AudioEventContext,
    now: Date,
  ): AudioDecisionReason | null {
    if (!context.preferences.masterEnabled) {
      return 'master_muted';
    }

    if (isDoNotDisturbActive(context.preferences, now)) {
      return 'do_not_disturb';
    }

    if (
      isQuietHoursActive(context.preferences.quietHours, now) &&
      !quietHoursAllows(event, context)
    ) {
      return 'quiet_hours';
    }

    if (!context.force && !isEventEnabled(event, context.preferences)) {
      return 'event_disabled';
    }

    if (!context.force && context.sessionPreferences) {
      const sessionSuppression = sessionSuppressionReason(event, context.sessionPreferences);
      if (sessionSuppression) {
        return sessionSuppression;
      }
    }

    if (!context.force && isRoutineSessionEvent(event) && shouldSuppressForFocus(event, context)) {
      return 'focused_suppression';
    }

    return null;
  }

  private isLatched(event: AudioEvent, sessionId?: SessionId): boolean {
    if (event === 'session.estimated_completion' && sessionId) {
      return this.completionLatch.has(sessionId);
    }

    return event === 'auth.disconnected' && this.authDisconnectedLatched;
  }

  private latch(event: AudioEvent, sessionId?: SessionId): void {
    if (event === 'session.estimated_completion' && sessionId) {
      this.completionLatch.add(sessionId);
    }

    if (event === 'auth.disconnected') {
      this.authDisconnectedLatched = true;
    }
  }

  private cooldownKey(event: AudioEvent, sessionId?: SessionId): string {
    if (event.startsWith('session.') && sessionId) {
      return `${event}:${sessionId}`;
    }

    return event;
  }

  private volumeFor(
    preferences: AudioPreferences,
    sessionPreferences?: SessionAudioPreferences,
  ): number {
    return Math.max(
      0,
      Math.min(1, preferences.masterVolume * (sessionPreferences?.volumeMultiplier ?? 1)),
    );
  }
}

function htmlAudioPlayer(asset: SoundAsset, volume: number): Promise<void> {
  const audio = new Audio(asset.url);
  audio.volume = volume;
  return audio.play();
}

function isDoNotDisturbActive(preferences: AudioPreferences, now: Date): boolean {
  if (preferences.doNotDisturb) {
    return true;
  }

  return preferences.doNotDisturbUntil
    ? new Date(preferences.doNotDisturbUntil).getTime() > now.getTime()
    : false;
}

export function isQuietHoursActive(
  quietHours: AudioPreferences['quietHours'],
  now = new Date(),
): boolean {
  if (!quietHours.enabled) {
    return false;
  }

  const start = minutesFromTime(quietHours.startTime);
  const end = minutesFromTime(quietHours.endTime);
  const current = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();
  const yesterday = (today + 6) % 7;

  if (start <= end) {
    return quietHours.days.includes(today) && current >= start && current < end;
  }

  return (
    (quietHours.days.includes(today) && current >= start) ||
    (quietHours.days.includes(yesterday) && current < end)
  );
}

function minutesFromTime(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function quietHoursAllows(event: AudioEvent, context: AudioEventContext): boolean {
  if (event === 'auth.disconnected' && context.preferences.quietHours.allowAuthDisconnectSounds) {
    return true;
  }

  return isErrorEvent(event) && context.preferences.quietHours.allowCrashSounds;
}

function isEventEnabled(event: AudioEvent, preferences: AudioPreferences): boolean {
  if (event === 'session.ready' || event === 'session.reload_completed') {
    return preferences.sessionReadyEnabled;
  }

  if (event === 'session.estimated_completion') {
    return preferences.completionEnabled;
  }

  if (isAttentionEvent(event)) {
    return preferences.attentionEnabled;
  }

  if (event === 'auth.connected' || event === 'auth.disconnected') {
    return preferences.authenticationEnabled;
  }

  if (isErrorEvent(event)) {
    return preferences.errorEnabled;
  }

  return true;
}

function sessionSuppressionReason(
  event: AudioEvent,
  preferences: SessionAudioPreferences,
): AudioDecisionReason | null {
  if (!preferences.enabled) {
    return 'session_disabled';
  }

  if (event === 'session.estimated_completion' && !preferences.completionEnabled) {
    return 'session_disabled';
  }

  if (isAttentionEvent(event) && !preferences.attentionEnabled) {
    return 'session_disabled';
  }

  if (isErrorEvent(event) && !preferences.errorEnabled) {
    return 'session_disabled';
  }

  return null;
}

function shouldSuppressForFocus(event: AudioEvent, context: AudioEventContext): boolean {
  if (!context.appFocused || !context.relevantSessionWatched) {
    return false;
  }

  if (!context.preferences.onlyWhenUnfocused && !context.sessionPreferences?.onlyWhenUnfocused) {
    return false;
  }

  return isRoutineSessionEvent(event);
}

function isRoutineSessionEvent(event: AudioEvent): boolean {
  return (
    event === 'session.ready' ||
    event === 'session.estimated_completion' ||
    event === 'session.likely_awaiting_input' ||
    event === 'session.possible_permission_prompt'
  );
}

function isAttentionEvent(event: AudioEvent): boolean {
  return (
    event === 'session.likely_awaiting_input' ||
    event === 'session.possible_permission_prompt' ||
    event === 'session.authentication_may_be_required'
  );
}

function isErrorEvent(event: AudioEvent): boolean {
  return (
    event === 'session.reload_failed' ||
    event === 'session.crashed' ||
    event === 'auth.refresh_failed' ||
    event === 'reload_all.partially_failed'
  );
}
