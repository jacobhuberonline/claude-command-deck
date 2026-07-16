import { buildClaudeCommand } from '../src/shared/claude/ClaudeCommandBuilder';
import type { ClaudeContinuationCapabilities } from '../src/shared/domain/types';
import { parseClaudeHelp } from '../src/main/claude/ClaudeDiscovery';

const capabilities: ClaudeContinuationCapabilities = {
  helpAvailable: true,
  continueMostRecent: true,
  continueFlag: '--continue',
  resumeSpecific: true,
  resumeFlag: '--resume',
};

describe('phase 4 Claude command builder', () => {
  it('constructs a new Claude launch without continuation flags', () => {
    const result = buildClaudeCommand({
      executable: 'claude',
      baseArgs: ['--model', 'sonnet'],
      launchMode: 'new',
      capabilities,
    });

    expect(result).toEqual({
      executable: 'claude',
      args: ['--model', 'sonnet'],
      strategy: 'new',
      warnings: [],
    });
  });

  it('constructs continue-most-recent only when help reports support', () => {
    const result = buildClaudeCommand({
      executable: 'claude',
      baseArgs: [],
      launchMode: 'continueMostRecent',
      capabilities,
    });

    expect(result.args).toEqual(['--continue']);
    expect(result.strategy).toBe('continueMostRecent');
  });

  it('constructs specific resume when a known session id and supported flag exist', () => {
    const result = buildClaudeCommand({
      executable: 'claude',
      baseArgs: [],
      launchMode: 'resumeSpecific',
      capabilities,
      knownSessionIdentifier: 'abc123',
    });

    expect(result.args).toEqual(['--resume', 'abc123']);
    expect(result.strategy).toBe('resumeSpecific');
  });

  it('falls back honestly when continuation is unsupported', () => {
    const result = buildClaudeCommand({
      executable: 'claude',
      baseArgs: [],
      launchMode: 'continueMostRecent',
      capabilities: {
        helpAvailable: true,
        continueMostRecent: false,
        continueFlag: null,
        resumeSpecific: false,
        resumeFlag: null,
      },
    });

    expect(result.strategy).toBe('freshFallback');
    expect(result.warnings[0]).toContain('Continuation is unsupported');
  });

  it('parses supported continuation flags from help output', () => {
    const parsed = parseClaudeHelp(`Usage: claude [options]
  --continue
  --resume <id>`);

    expect(parsed.continueMostRecent).toBe(true);
    expect(parsed.resumeSpecific).toBe(true);
  });
});
