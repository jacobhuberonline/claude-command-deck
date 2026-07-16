import { createPhaseOneState } from '../src/shared/domain/defaults';
import { buildSanitizedDiagnosticsReport } from '../src/renderer/services/diagnostics/DiagnosticsReport';

describe('phase 9 diagnostics report', () => {
  it('redacts secret-shaped diagnostic values and avoids transcripts', () => {
    const state = createPhaseOneState('test');
    state.settings.claudeExecutable = '/Users/example/bin/claude';
    state.diagnostics.push({
      id: 'secret-shaped',
      label: 'Secret shaped value',
      status: 'warn',
      detail: 'Bearer abcdefghijklmnopqrstuvwxyz0123456789 should not appear',
    });

    const report = buildSanitizedDiagnosticsReport(state, {
      platform: 'test-platform',
      userAgent: 'test-agent',
      notificationSupport: 'unsupported',
      clipboardSupport: 'available',
    });

    expect(report).toContain('Claude executable: [path]/claude');
    expect(report).toContain('Bearer [REDACTED]');
    expect(report).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(report).toContain('Terminal transcripts: not included');
    expect(report).toContain('Environment variables: not included');
  });
});
