import { ActivityClassifier } from '../src/renderer/services/activity/ActivityClassifier';

describe('phase 7 activity classifier', () => {
  it('detects possible permission prompts conservatively', () => {
    const classifier = new ActivityClassifier({ minimumActivityMs: 10000 });

    const result = classifier.recordOutput(
      'session-1',
      'Claude asks: Do you want to proceed with this command?',
      1000,
    );

    expect(result.activityState).toBe('possiblePermissionPrompt');
    expect(result.confidence).toBe('high');
    expect(result.attention).toBe(true);
    expect(result.events).toContain('session.possible_permission_prompt');
  });

  it('detects authentication warnings without persisting terminal content', () => {
    const classifier = new ActivityClassifier({ minimumActivityMs: 10000 });

    const result = classifier.recordOutput(
      'session-1',
      'AWS returned ExpiredToken while loading credentials.',
      1000,
    );

    expect(result.activityState).toBe('authenticationMayBeRequired');
    expect(result.confidence).toBe('high');
    expect(result.events).toContain('session.authentication_may_be_required');
  });

  it('emits one estimated completion after sustained activity goes quiet', () => {
    const classifier = new ActivityClassifier({
      idleWindowMs: 1000,
      minimumActivityMs: 10000,
    });

    classifier.recordOutput('session-1', 'working\n', 0);
    classifier.recordOutput('session-1', 'still working\n', 11000);

    const firstQuietTick = classifier.tick('session-1', 'running', 12500);
    const secondQuietTick = classifier.tick('session-1', 'running', 14000);

    expect(firstQuietTick?.activityState).toBe('idle');
    expect(firstQuietTick?.events).toContain('session.estimated_completion');
    expect(secondQuietTick?.events).not.toContain('session.estimated_completion');
  });

  it('does not treat a short output burst as completion', () => {
    const classifier = new ActivityClassifier({
      idleWindowMs: 1000,
      minimumActivityMs: 10000,
    });

    classifier.recordOutput('session-1', 'short burst\n', 0);
    const result = classifier.tick('session-1', 'running', 1500);

    expect(result?.activityState).toBe('idle');
    expect(result?.confidence).toBe('low');
    expect(result?.events).not.toContain('session.estimated_completion');
  });

  it('clears local rolling state when a session ends', () => {
    const classifier = new ActivityClassifier({ idleWindowMs: 1000 });

    classifier.recordOutput('session-1', 'Do you want to proceed?', 1000);
    classifier.clearSession('session-1');
    const result = classifier.recordOutput('session-1', 'ordinary output', 2000);

    expect(result.activityState).toBe('active');
    expect(result.attention).toBe(false);
  });
});
