import type {
  ActivityConfidence,
  ActivityState,
  AudioEvent,
  ProcessState,
  SessionId,
} from '../../../shared/domain/types';

export type ActivitySemanticEvent = Extract<
  AudioEvent,
  | 'session.activity_started'
  | 'session.activity_stopped'
  | 'session.likely_awaiting_input'
  | 'session.possible_permission_prompt'
  | 'session.authentication_may_be_required'
  | 'session.estimated_completion'
>;

export interface ActivityClassification {
  activityState: ActivityState;
  confidence: ActivityConfidence;
  attention: boolean;
  statusMessage: string;
  events: ActivitySemanticEvent[];
  lastOutputAt?: string | undefined;
}

export interface ActivityClassifierOptions {
  rollingWindowChars: number;
  activeWindowMs: number;
  idleWindowMs: number;
  minimumActivityMs: number;
}

interface ActivityTracker {
  rollingText: string;
  activityState: ActivityState;
  confidence: ActivityConfidence;
  activeSinceMs: number | null;
  lastOutputMs: number | null;
  completionEmitted: boolean;
}

const defaultOptions: ActivityClassifierOptions = {
  rollingWindowChars: 2400,
  activeWindowMs: 2500,
  idleWindowMs: 6500,
  minimumActivityMs: 10000,
};

const permissionPromptPatterns = [
  /\bdo you want to (proceed|continue|allow)\b/i,
  /\b(approve|allow) (this )?(command|operation|change)\b/i,
  /\bpermission (prompt|required|needed)\b/i,
  /\bconfirm (the )?(command|operation|action)\b/i,
];

const authenticationWarningPatterns = [
  /\bunable to locate credentials\b/i,
  /\bcould not load credentials\b/i,
  /\bexpired(token| credentials| session)\b/i,
  /\bsso session.*expired\b/i,
  /\b(?:credential|token|sso|authentication)\b.{0,80}\baccess denied\b/i,
  /\baccess denied\b.{0,80}\b(?:credential|token|sso|authentication)\b/i,
  /\bauthentication (failed|required|expired)\b/i,
  /\blogin required\b/i,
];

const awaitingInputPatterns = [
  /\bpress enter\b/i,
  /\bselect an option\b/i,
  /\btype (a )?(choice|response)\b/i,
  /\bwaiting for (your )?(input|response)\b/i,
  /\bcontinue\?\s*$/i,
];

export class ActivityClassifier {
  private options: ActivityClassifierOptions;

  private readonly trackers = new Map<SessionId, ActivityTracker>();

  constructor(options: Partial<ActivityClassifierOptions> = {}) {
    this.options = { ...defaultOptions, ...options };
  }

  configure(options: Partial<ActivityClassifierOptions>): void {
    this.options = { ...this.options, ...options };
  }

  recordOutput(sessionId: SessionId, data: string, nowMs = Date.now()): ActivityClassification {
    const tracker = this.getTracker(sessionId);
    tracker.lastOutputMs = nowMs;
    tracker.rollingText = this.trimRollingText(`${tracker.rollingText}${data}`);

    const detected = this.detectAttentionState(tracker.rollingText);
    if (detected) {
      if (detected.activityState === 'authenticationMayBeRequired') {
        // Credential warnings are edge-triggered. Keeping one in the rolling window would make
        // every later chunk repeat it until enough unrelated terminal output displaced it.
        tracker.rollingText = '';
      }
      const events = this.eventsForAttentionState(detected.activityState);
      const completionEvent = this.maybeEmitEstimatedCompletion(tracker, nowMs);
      if (completionEvent) {
        events.unshift(completionEvent);
      }

      tracker.activityState = detected.activityState;
      tracker.confidence = detected.confidence;
      tracker.completionEmitted = true;

      return {
        activityState: detected.activityState,
        confidence: detected.confidence,
        attention: true,
        statusMessage: detected.statusMessage,
        events,
        lastOutputAt: new Date(nowMs).toISOString(),
      };
    }

    const events: ActivitySemanticEvent[] =
      tracker.activityState === 'active' ? [] : ['session.activity_started'];
    if (tracker.activityState !== 'active' || tracker.activeSinceMs === null) {
      tracker.activeSinceMs = nowMs;
      tracker.completionEmitted = false;
    }

    tracker.activityState = 'active';
    tracker.confidence = 'medium';

    return {
      activityState: 'active',
      confidence: 'medium',
      attention: false,
      statusMessage: 'Recent terminal output received.',
      events,
      lastOutputAt: new Date(nowMs).toISOString(),
    };
  }

  tick(
    sessionId: SessionId,
    processState: ProcessState,
    nowMs = Date.now(),
  ): ActivityClassification | null {
    const tracker = this.trackers.get(sessionId);
    if (!tracker) {
      return null;
    }

    if (processState !== 'running') {
      this.clearSession(sessionId);
      return null;
    }

    if (tracker.lastOutputMs === null) {
      return null;
    }

    const msSinceOutput = nowMs - tracker.lastOutputMs;
    if (msSinceOutput < this.options.idleWindowMs) {
      return null;
    }

    const events: ActivitySemanticEvent[] =
      tracker.activityState === 'active' ? ['session.activity_stopped'] : [];
    const completionEvent = this.maybeEmitEstimatedCompletion(tracker, nowMs);
    if (completionEvent) {
      events.push(completionEvent);
    }

    tracker.activityState = 'idle';
    tracker.confidence = completionEvent ? 'medium' : 'low';

    return {
      activityState: 'idle',
      confidence: tracker.confidence,
      attention: false,
      statusMessage: completionEvent
        ? 'No output recently; completion is estimated from local activity only.'
        : 'No output recently.',
      events,
    };
  }

  clearSession(sessionId: SessionId): void {
    this.trackers.delete(sessionId);
  }

  private getTracker(sessionId: SessionId): ActivityTracker {
    const existing = this.trackers.get(sessionId);
    if (existing) {
      return existing;
    }

    const tracker: ActivityTracker = {
      rollingText: '',
      activityState: 'unknown',
      confidence: 'low',
      activeSinceMs: null,
      lastOutputMs: null,
      completionEmitted: false,
    };
    this.trackers.set(sessionId, tracker);
    return tracker;
  }

  private trimRollingText(value: string): string {
    if (value.length <= this.options.rollingWindowChars) {
      return value;
    }

    return value.slice(value.length - this.options.rollingWindowChars);
  }

  private detectAttentionState(
    rollingText: string,
  ): Pick<ActivityClassification, 'activityState' | 'confidence' | 'statusMessage'> | null {
    if (authenticationWarningPatterns.some((pattern) => pattern.test(rollingText))) {
      return {
        activityState: 'authenticationMayBeRequired',
        confidence: 'medium',
        statusMessage: 'Credential-related terminal output detected.',
      };
    }

    if (permissionPromptPatterns.some((pattern) => pattern.test(rollingText))) {
      return {
        activityState: 'possiblePermissionPrompt',
        confidence: 'high',
        statusMessage: 'Possible permission prompt detected.',
      };
    }

    if (awaitingInputPatterns.some((pattern) => pattern.test(rollingText))) {
      return {
        activityState: 'likelyAwaitingInput',
        confidence: 'medium',
        statusMessage: 'Likely awaiting input.',
      };
    }

    return null;
  }

  private eventsForAttentionState(activityState: ActivityState): ActivitySemanticEvent[] {
    if (activityState === 'possiblePermissionPrompt') {
      return ['session.possible_permission_prompt'];
    }

    if (activityState === 'authenticationMayBeRequired') {
      return ['session.authentication_may_be_required'];
    }

    if (activityState === 'likelyAwaitingInput') {
      return ['session.likely_awaiting_input'];
    }

    return [];
  }

  private maybeEmitEstimatedCompletion(
    tracker: ActivityTracker,
    nowMs: number,
  ): ActivitySemanticEvent | null {
    if (tracker.completionEmitted || tracker.activeSinceMs === null) {
      return null;
    }

    const activeDurationMs = nowMs - tracker.activeSinceMs;
    if (activeDurationMs < this.options.minimumActivityMs) {
      return null;
    }

    tracker.completionEmitted = true;
    return 'session.estimated_completion';
  }
}
