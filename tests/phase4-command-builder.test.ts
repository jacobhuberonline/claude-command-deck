import { buildClaudeCommand } from '../src/shared/claude/ClaudeCommandBuilder';
import type { ClaudeContinuationCapabilities } from '../src/shared/domain/types';
import { parseClaudeHelp } from '../src/main/claude/ClaudeDiscovery';

const capabilities: ClaudeContinuationCapabilities = {
  helpAvailable: true,
  continueMostRecent: true,
  continueFlag: '--continue',
  resumeSpecific: true,
  resumeFlag: '--resume',
  nameSession: true,
  nameFlag: '--name',
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

  it('applies a session model and overrides inherited model args', () => {
    const result = buildClaudeCommand({
      executable: 'claude',
      baseArgs: ['--model', 'sonnet', '--permission-mode', 'acceptEdits'],
      model: 'haiku',
      launchMode: 'new',
      capabilities,
    });

    expect(result.args).toEqual(['--model', 'haiku', '--permission-mode', 'acceptEdits']);
  });

  it('removes equals-form inherited model args before applying a session model', () => {
    const result = buildClaudeCommand({
      executable: 'claude',
      baseArgs: ['--model=opus', '--verbose'],
      model: 'haiku',
      launchMode: 'new',
      capabilities,
    });

    expect(result.args).toEqual(['--model', 'haiku', '--verbose']);
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

  it('names fresh conversations and resumes that exact name later', () => {
    const fresh = buildClaudeCommand({
      executable: 'claude',
      baseArgs: [],
      launchMode: 'new',
      capabilities,
      newSessionName: 'deck-api-1234',
    });
    const continued = buildClaudeCommand({
      executable: 'claude',
      baseArgs: [],
      launchMode: 'continueMostRecent',
      capabilities,
      knownSessionIdentifier: 'deck-api-1234',
    });

    expect(fresh.args).toEqual(['--name', 'deck-api-1234']);
    expect(continued.args).toEqual(['--resume', 'deck-api-1234']);
    expect(continued.strategy).toBe('resumeSpecific');
  });

  it('strips inherited launch-control flags before applying the selected strategy', () => {
    const result = buildClaudeCommand({
      executable: 'claude',
      baseArgs: [
        '--continue',
        '--resume',
        'old-id',
        '--name=old-name',
        '-r',
        'older-id',
        '-n',
        'older-name',
        '--verbose',
      ],
      launchMode: 'new',
      capabilities,
      newSessionName: 'deck-new-name',
    });

    expect(result.args).toEqual(['--verbose', '--name', 'deck-new-name']);
  });

  it('keeps custom-mode arguments untouched', () => {
    const result = buildClaudeCommand({
      executable: 'claude',
      baseArgs: ['--continue', '--name', 'custom-name'],
      launchMode: 'custom',
      capabilities,
    });

    expect(result.args).toEqual(['--continue', '--name', 'custom-name']);
    expect(result.strategy).toBe('custom');
  });

  it('warns when an exact named resume would degrade to directory continuation', () => {
    const result = buildClaudeCommand({
      executable: 'claude',
      baseArgs: [],
      launchMode: 'continueMostRecent',
      knownSessionIdentifier: 'deck-api-1234',
      capabilities: {
        ...capabilities,
        resumeSpecific: false,
        resumeFlag: null,
      },
    });

    expect(result.strategy).toBe('continueMostRecent');
    expect(result.warnings[0]).toContain('Exact named resume is unavailable');
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

  it('constructs resume picker when no known session id is provided', () => {
    const result = buildClaudeCommand({
      executable: 'claude',
      baseArgs: [],
      launchMode: 'resumeSpecific',
      capabilities,
    });

    expect(result.args).toEqual(['--resume']);
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
        nameSession: false,
        nameFlag: null,
      },
    });

    expect(result.strategy).toBe('freshFallback');
    expect(result.warnings[0]).toContain('Continuation is unsupported');
  });

  it('parses supported continuation flags from help output', () => {
    const parsed = parseClaudeHelp(`Usage: claude [options]
  --continue
  --resume <id>
  --name <name>`);

    expect(parsed.continueMostRecent).toBe(true);
    expect(parsed.resumeSpecific).toBe(true);
    expect(parsed.nameSession).toBe(true);
  });
});
