import { spawnSync } from 'node:child_process';
import type {
  ClaudeContinuationCapabilities,
  ClaudeDiscoverySnapshot,
} from '../../shared/domain/types';
import { resolveCommand } from '../processes/CommandResolution';

export function discoverClaude(executable: string): ClaudeDiscoverySnapshot {
  const checkedAt = new Date().toISOString();
  const resolvedPath = resolveCommand(executable);

  if (!resolvedPath) {
    return {
      executable,
      resolvedPath: null,
      found: false,
      version: null,
      capabilities: emptyCapabilities(),
      error: `Claude executable "${executable}" was not found on PATH.`,
      checkedAt,
    };
  }

  const versionResult = spawnSync(resolvedPath, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
  });
  const output = `${versionResult.stdout.trim()} ${versionResult.stderr.trim()}`.trim();
  const helpResult = spawnSync(resolvedPath, ['--help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
  });
  const helpOutput = `${helpResult.stdout} ${helpResult.stderr}`;

  return {
    executable,
    resolvedPath,
    found: versionResult.status === 0,
    version: versionResult.status === 0 ? output || 'Version output was empty.' : null,
    capabilities: parseClaudeHelp(helpOutput, helpResult.status === 0),
    error:
      versionResult.status === 0
        ? null
        : output || `Claude version check exited with code ${versionResult.status ?? 'unknown'}.`,
    checkedAt,
  };
}

export function parseClaudeHelp(
  helpOutput: string,
  helpAvailable = true,
): ClaudeContinuationCapabilities {
  const hasContinueLong = /(?:^|\s)--continue(?:\s|,|$)/.test(helpOutput);
  const hasResumeLong = /(?:^|\s)--resume(?:\s|,|$)/.test(helpOutput);

  return {
    helpAvailable,
    continueMostRecent: hasContinueLong,
    continueFlag: hasContinueLong ? '--continue' : null,
    resumeSpecific: hasResumeLong,
    resumeFlag: hasResumeLong ? '--resume' : null,
  };
}

function emptyCapabilities(): ClaudeContinuationCapabilities {
  return {
    helpAvailable: false,
    continueMostRecent: false,
    continueFlag: null,
    resumeSpecific: false,
    resumeFlag: null,
  };
}
