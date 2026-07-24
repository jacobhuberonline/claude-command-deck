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

  it('keeps permission prompts visible across harmless terminal repaint output', () => {
    const classifier = new ActivityClassifier({ minimumActivityMs: 10000 });

    classifier.recordOutput('session-1', 'Do you want to proceed with this command?', 1000);
    const repainted = classifier.recordOutput('session-1', '\u001b[2K\r', 1100);

    expect(repainted.activityState).toBe('possiblePermissionPrompt');
    expect(repainted.attention).toBe(true);
  });

  it('detects authentication warnings without persisting terminal content', () => {
    const classifier = new ActivityClassifier({ minimumActivityMs: 10000 });

    const result = classifier.recordOutput(
      'session-1',
      'AWS returned ExpiredToken while loading credentials.',
      1000,
    );

    expect(result.activityState).toBe('authenticationMayBeRequired');
    expect(result.confidence).toBe('medium');
    expect(result.events).toContain('session.authentication_may_be_required');
  });

  it('clears a credential warning when later terminal output is healthy', () => {
    const classifier = new ActivityClassifier({ minimumActivityMs: 10000 });

    const warning = classifier.recordOutput(
      'session-1',
      'AWS returned ExpiredToken while loading credentials.',
      1000,
    );
    const recovered = classifier.recordOutput(
      'session-1',
      'Claude continued and completed the request successfully.',
      2000,
    );

    expect(warning.activityState).toBe('authenticationMayBeRequired');
    expect(recovered.activityState).toBe('active');
    expect(recovered.attention).toBe(false);
    expect(recovered.events).not.toContain('session.authentication_may_be_required');
  });

  it('does not interpret generic access-denied prose as an authentication failure', () => {
    const classifier = new ActivityClassifier({ minimumActivityMs: 10000 });

    const result = classifier.recordOutput(
      'session-1',
      'The application test expects HTTP 403 Access Denied for this route.',
      1000,
    );

    expect(result.activityState).toBe('active');
    expect(result.attention).toBe(false);
  });

  it('detects access denied when nearby output identifies a credential source', () => {
    const classifier = new ActivityClassifier({ minimumActivityMs: 10000 });

    const result = classifier.recordOutput(
      'session-1',
      'Access denied because the SSO token expired.',
      1000,
    );

    expect(result.activityState).toBe('authenticationMayBeRequired');
    expect(result.attention).toBe(true);
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
