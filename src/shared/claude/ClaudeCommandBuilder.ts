import type { ClaudeContinuationCapabilities, SessionLaunchMode } from '../domain/types';

export interface ClaudeCommandBuildInput {
  executable: string;
  baseArgs: string[];
  model?: string;
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
  const baseArgs = applyModelOverride(input.baseArgs, input.model);

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

function applyModelOverride(baseArgs: string[], model: string | undefined) {
  const trimmed = model?.trim();
  if (!trimmed) {
    return [...baseArgs];
  }

  return ['--model', trimmed, ...stripModelArgs(baseArgs)];
}

function stripModelArgs(args: string[]) {
  const stripped: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--model') {
      index += 1;
      continue;
    }

    if (arg.startsWith('--model=')) {
      continue;
    }

    stripped.push(arg);
  }

  return stripped;
}
