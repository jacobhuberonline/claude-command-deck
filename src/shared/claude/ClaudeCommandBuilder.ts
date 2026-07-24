import type { ClaudeContinuationCapabilities, SessionLaunchMode } from '../domain/types';

export interface ClaudeCommandBuildInput {
  executable: string;
  baseArgs: string[];
  model?: string;
  launchMode: SessionLaunchMode;
  capabilities: ClaudeContinuationCapabilities;
  knownSessionIdentifier?: string;
  newSessionName?: string;
}

export interface ClaudeCommandBuildResult {
  executable: string;
  args: string[];
  strategy: 'new' | 'continueMostRecent' | 'resumeSpecific' | 'custom' | 'freshFallback';
  warnings: string[];
}

export function buildClaudeCommand(input: ClaudeCommandBuildInput): ClaudeCommandBuildResult {
  const configuredArgs = applyModelOverride(input.baseArgs, input.model);

  if (input.launchMode === 'custom') {
    return {
      executable: input.executable,
      args: configuredArgs,
      strategy: 'custom',
      warnings: [],
    };
  }

  const baseArgs = stripLaunchControlArgs(configuredArgs);

  if (input.launchMode === 'new') {
    const namedLaunch = applySessionName(baseArgs, input.newSessionName, input.capabilities);
    return {
      executable: input.executable,
      args: namedLaunch.args,
      strategy: 'new',
      warnings: namedLaunch.warnings,
    };
  }

  if (
    input.launchMode === 'continueMostRecent' &&
    input.knownSessionIdentifier &&
    input.capabilities.resumeSpecific &&
    input.capabilities.resumeFlag
  ) {
    return {
      executable: input.executable,
      args: [...baseArgs, input.capabilities.resumeFlag, input.knownSessionIdentifier],
      strategy: 'resumeSpecific',
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
    const warnings = input.knownSessionIdentifier
      ? [
          'Exact named resume is unavailable; continuing the directory’s most recent conversation would be unsafe.',
        ]
      : input.launchMode === 'resumeSpecific'
        ? ['The resume picker is unavailable; continue-most-recent is the only supported fallback.']
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

function stripLaunchControlArgs(args: string[]): string[] {
  const stripped: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--continue' || arg === '-c') {
      continue;
    }

    if (arg === '--resume' || arg === '-r' || arg === '--name' || arg === '-n') {
      index += 1;
      continue;
    }

    if (arg.startsWith('--resume=') || arg.startsWith('--name=')) {
      continue;
    }

    stripped.push(arg);
  }

  return stripped;
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

function applySessionName(
  baseArgs: string[],
  sessionName: string | undefined,
  capabilities: ClaudeContinuationCapabilities,
) {
  const trimmed = sessionName?.trim();
  if (!trimmed) {
    return { args: baseArgs, warnings: [] };
  }

  if (!capabilities.nameSession || !capabilities.nameFlag) {
    return {
      args: baseArgs,
      warnings: [
        'This Claude CLI does not report named-session support; later continuation may use the directory’s most recent conversation.',
      ],
    };
  }

  return {
    args: [...stripSessionNameArgs(baseArgs), capabilities.nameFlag, trimmed],
    warnings: [],
  };
}

function stripSessionNameArgs(args: string[]) {
  const stripped: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--name' || arg === '-n') {
      index += 1;
      continue;
    }

    if (arg.startsWith('--name=')) {
      continue;
    }

    stripped.push(arg);
  }
  return stripped;
}
