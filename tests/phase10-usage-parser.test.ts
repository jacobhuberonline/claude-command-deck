import { parseClaudeUsageOutput } from '../src/renderer/services/usage/ClaudeUsageParser';

describe('phase 10 Claude usage parser', () => {
  it('prefers monthly usage cost when present', () => {
    const parsed = parseClaudeUsageOutput(
      ['Today: $0.42', 'Current month usage: $12.34'].join('\n'),
      '2026-07-17T12:00:00.000Z',
    );

    expect(parsed).toEqual({
      amountUsd: 12.34,
      label: 'Month',
      source: 'Current month usage: $12.34',
      observedAt: '2026-07-17T12:00:00.000Z',
    });
  });

  it('captures generic usage cost when no monthly line is available', () => {
    const parsed = parseClaudeUsageOutput('Total cost: $1.05', '2026-07-17T12:00:00.000Z');

    expect(parsed?.amountUsd).toBe(1.05);
    expect(parsed?.label).toBe('Usage');
  });
});
