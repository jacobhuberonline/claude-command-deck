import type { AudioEvent, NotificationPreferences, SessionId } from '../../../shared/domain/types';

export interface DesktopNotificationContext {
  preferences: NotificationPreferences;
  sessionId?: SessionId | undefined;
  sessionName?: string | undefined;
  now?: Date | undefined;
  onFocusSession?: ((sessionId: SessionId) => void) | undefined;
  onOpenAuthentication?: (() => void) | undefined;
}

export type DesktopNotificationReason =
  | 'shown'
  | 'disabled'
  | 'event_disabled'
  | 'unsupported'
  | 'permission_not_granted'
  | 'cooldown'
  | 'not_notifiable'
  | 'failed';

export interface DesktopNotificationDecision {
  event: AudioEvent;
  shown: boolean;
  reason: DesktopNotificationReason;
}

interface NotificationCopy {
  title: string;
  body: string;
}

export class DesktopNotificationService {
  private readonly cooldowns = new Map<string, number>();

  notify(event: AudioEvent, context: DesktopNotificationContext): DesktopNotificationDecision {
    const decision = this.decide(event, context);
    if (!decision.shown) {
      return decision;
    }

    const copy = notificationCopy(event, context);
    if (!copy) {
      return { event, shown: false, reason: 'not_notifiable' };
    }

    try {
      const notification = new Notification(copy.title, { body: copy.body, silent: true });
      notification.onclick = () => {
        window.focus();
        if (context.sessionId) {
          context.onFocusSession?.(context.sessionId);
        }
        if (isAuthEvent(event)) {
          context.onOpenAuthentication?.();
        }
      };
    } catch {
      return { event, shown: false, reason: 'failed' };
    }

    const now = context.now ?? new Date();
    this.cooldowns.set(this.cooldownKey(event, context.sessionId), now.getTime());
    return decision;
  }

  decide(event: AudioEvent, context: DesktopNotificationContext): DesktopNotificationDecision {
    if (!context.preferences.enabled) {
      return { event, shown: false, reason: 'disabled' };
    }

    if (!isNotificationEnabled(event, context.preferences)) {
      return { event, shown: false, reason: 'event_disabled' };
    }

    if (!notificationCopy(event, context)) {
      return { event, shown: false, reason: 'not_notifiable' };
    }

    const notificationApi = globalThis.Notification;
    if (!notificationApi) {
      return { event, shown: false, reason: 'unsupported' };
    }

    if (notificationApi.permission !== 'granted') {
      return { event, shown: false, reason: 'permission_not_granted' };
    }

    const now = context.now ?? new Date();
    const lastShownAt = this.cooldowns.get(this.cooldownKey(event, context.sessionId));
    if (lastShownAt !== undefined && now.getTime() - lastShownAt < context.preferences.cooldownMs) {
      return { event, shown: false, reason: 'cooldown' };
    }

    return { event, shown: true, reason: 'shown' };
  }

  private cooldownKey(event: AudioEvent, sessionId?: SessionId): string {
    return sessionId ? `${event}:${sessionId}` : event;
  }
}

function isNotificationEnabled(event: AudioEvent, preferences: NotificationPreferences): boolean {
  if (isAuthEvent(event)) {
    return preferences.authTransitions;
  }

  if (isSessionAttentionEvent(event)) {
    return preferences.sessionAttention;
  }

  if (event === 'session.crashed' || event === 'session.reload_failed') {
    return preferences.sessionCrash;
  }

  if (event === 'reload_all.completed' || event === 'reload_all.partially_failed') {
    return preferences.reloadAllSummary;
  }

  return false;
}

function notificationCopy(
  event: AudioEvent,
  context: DesktopNotificationContext,
): NotificationCopy | null {
  const name = context.sessionName ?? 'Claude session';

  if (event === 'session.likely_awaiting_input') {
    return {
      title: `${name} may be waiting`,
      body: 'Local activity detection suggests this session may need input.',
    };
  }

  if (event === 'session.possible_permission_prompt') {
    return {
      title: `${name} may need approval`,
      body: 'A possible permission or confirmation prompt was detected.',
    };
  }

  if (event === 'session.authentication_may_be_required') {
    return {
      title: `${name} may need authentication`,
      body: 'Credential-related terminal output was detected locally.',
    };
  }

  if (event === 'auth.disconnected') {
    return {
      title: 'Authentication appears disconnected',
      body: 'Use the authentication console to refresh credentials.',
    };
  }

  if (event === 'auth.connected') {
    return {
      title: 'Authentication connected',
      body: 'The credential check completed successfully.',
    };
  }

  if (event === 'session.crashed' || event === 'session.reload_failed') {
    return {
      title: `${name} needs attention`,
      body: 'The session failed or exited unexpectedly.',
    };
  }

  if (event === 'reload_all.completed') {
    return {
      title: 'Reload All completed',
      body: 'All configured sessions finished the reload sequence.',
    };
  }

  if (event === 'reload_all.partially_failed') {
    return {
      title: 'Reload All completed with failures',
      body: 'One or more sessions failed during the reload sequence.',
    };
  }

  return null;
}

function isAuthEvent(event: AudioEvent): boolean {
  return (
    event === 'auth.connected' || event === 'auth.disconnected' || event === 'auth.refresh_failed'
  );
}

function isSessionAttentionEvent(event: AudioEvent): boolean {
  return (
    event === 'session.likely_awaiting_input' ||
    event === 'session.possible_permission_prompt' ||
    event === 'session.authentication_may_be_required'
  );
}
