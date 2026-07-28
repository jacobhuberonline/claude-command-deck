import { ActivityClassifier } from '../src/renderer/services/activity/ActivityClassifier';
import { writeWithActivityTracking } from '../src/renderer/services/activity/ActivityTrackingTerminalBridge';
import type { TerminalBridge } from '../src/shared/ipc/contracts';

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

  it('does not interpret yes/no prose as a waiting prompt', () => {
    const classifier = new ActivityClassifier({ minimumActivityMs: 10000 });

    const result = classifier.recordOutput(
      'session-1',
      'The parser stores yes/no values in the generated documentation.',
      1000,
    );

    expect(result.activityState).toBe('active');
    expect(result.attention).toBe(false);
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
    expect(secondQuietTick).toBeNull();
  });

  it('emits completion for a short task that follows submitted terminal input', () => {
    const classifier = new ActivityClassifier({
      idleWindowMs: 1000,
      minimumActivityMs: 10000,
    });

    classifier.recordInput('session-1', 'short request\r', 0);
    classifier.recordOutput('session-1', 'Done.\n', 100);
    const result = classifier.tick('session-1', 'running', 1100);

    expect(result?.events).toEqual(['session.activity_stopped', 'session.estimated_completion']);
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

  it('does not emit a late completion after a short output burst already became idle', () => {
    const classifier = new ActivityClassifier({
      idleWindowMs: 1000,
      minimumActivityMs: 10000,
    });

    classifier.recordOutput('session-1', 'short burst\n', 0);

    expect(classifier.tick('session-1', 'running', 1000)?.events).not.toContain(
      'session.estimated_completion',
    );
    expect(classifier.tick('session-1', 'running', 12000)).toBeNull();
  });

  it('normalizes split ANSI prompt output and edge-triggers attention once', () => {
    const classifier = new ActivityClassifier({ minimumActivityMs: 10000 });

    const partial = classifier.recordOutput('session-1', '\u001b[33mDo you want to ', 1000);
    const detected = classifier.recordOutput(
      'session-1',
      'proceed with this command?\u001b[0m',
      1100,
    );
    const repainted = classifier.recordOutput(
      'session-1',
      '\u001b[2K\rDo you want to proceed with this command?',
      1200,
    );

    expect(partial.activityState).toBe('active');
    expect(detected.events).toEqual(['session.possible_permission_prompt']);
    expect(repainted.activityState).toBe('possiblePermissionPrompt');
    expect(repainted.events).toEqual([]);
  });

  it('lets an attention prompt supersede estimated completion', () => {
    const classifier = new ActivityClassifier({
      idleWindowMs: 1000,
      minimumActivityMs: 10000,
    });

    classifier.recordOutput('session-1', 'Working...\n', 0);
    const prompt = classifier.recordOutput(
      'session-1',
      'Do you want to proceed with this command?',
      11000,
    );

    expect(prompt.events).toEqual(['session.possible_permission_prompt']);
    expect(prompt.events).not.toContain('session.estimated_completion');
  });

  it('clears local rolling state when a session ends', () => {
    const classifier = new ActivityClassifier({ idleWindowMs: 1000 });

    classifier.recordOutput('session-1', 'Do you want to proceed?', 1000);
    classifier.clearSession('session-1');
    const result = classifier.recordOutput('session-1', 'ordinary output', 2000);

    expect(result.activityState).toBe('active');
    expect(result.attention).toBe(false);
  });

  it('records submitted input only after the terminal accepts the write', async () => {
    const classifier = new ActivityClassifier();
    const recordInput = vi.spyOn(classifier, 'recordInput');
    const failedBridge = {
      write: vi.fn(() => Promise.resolve({ ok: false as const, error: 'No active process.' })),
    } as unknown as TerminalBridge;
    const successfulBridge = {
      write: vi.fn(() => Promise.resolve({ ok: true as const })),
    } as unknown as TerminalBridge;

    await writeWithActivityTracking(
      failedBridge,
      { sessionId: 'session-1', data: 'ignored\r' },
      (sessionId, data, nowMs) => classifier.recordInput(sessionId, data, nowMs),
      () => 1234,
    );
    expect(recordInput).not.toHaveBeenCalled();

    await writeWithActivityTracking(
      successfulBridge,
      { sessionId: 'session-1', data: 'accepted\r' },
      (sessionId, data, nowMs) => classifier.recordInput(sessionId, data, nowMs),
      () => 5678,
    );
    expect(recordInput).toHaveBeenCalledWith('session-1', 'accepted\r', 5678);
  });
});
