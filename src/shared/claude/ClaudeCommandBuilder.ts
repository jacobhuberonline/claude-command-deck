import type { ClaudeContinuationCapabilities, SessionLaunchMode } from '../domain/types';

export interface ClaudeCommandBuildInput {
  executable: string;
  baseArgs: string[];
  launchMode: SessionLaunchMode;
  capabilities: ClaudeContinuationCapabilities;
  knownSessionIdentifier?: string;
}

export interface ClaudeCommandBuildResult {
  executable: string;
  args: string[];
  strategy: 'new' | 'continueMostRecent' | 'resumeSpecific' | 'custom' | 'freshFallback';
  warnings: string[];
}

export function buildClaudeCommand(input: ClaudeCommandBuildInput): ClaudeCommandBuildResult {
  const baseArgs = [...input.baseArgs];

  if (input.launchMode === 'custom') {
    return {
      executable: input.executable,
      args: baseArgs,
      strategy: 'custom',
      warnings: [],
    };
  }

  if (input.launchMode === 'new') {
    return {
      executable: input.executable,
      args: baseArgs,
      strategy: 'new',
      warnings: [],
    };
  }

  if (
    input.launchMode === 'resumeSpecific' &&
    input.capabilities.resumeSpecific &&
    input.capabilities.resumeFlag
  ) {
    return {
      executable: input.executable,
      args: [
        ...baseArgs,
        input.capabilities.resumeFlag,
        ...(input.knownSessionIdentifier ? [input.knownSessionIdentifier] : []),
      ],
      strategy: 'resumeSpecific',
      warnings: [],
    };
  }

  if (input.capabilities.continueMostRecent && input.capabilities.continueFlag) {
    const warnings =
      input.launchMode === 'resumeSpecific'
        ? ['Specific resume is unavailable; using continue-most-recent instead.']
        : [];

    return {
      executable: input.executable,
      args: [...baseArgs, input.capabilities.continueFlag],
      strategy: 'continueMostRecent',
      warnings,
    };
  }

  return {
    executable: input.executable,
    args: baseArgs,
    strategy: 'freshFallback',
    warnings: ['Continuation is unsupported by the discovered Claude CLI; using a fresh launch.'],
  };
}
