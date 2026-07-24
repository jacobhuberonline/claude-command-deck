import { execFile } from 'node:child_process';
import type {
  ClaudeContinuationCapabilities,
  ClaudeDiscoverySnapshot,
} from '../../shared/domain/types';
import { resolveCommandAsync } from '../processes/CommandResolution';

const discoveryCacheTtlMs = 15_000;
const commandTimeoutMs = 5_000;
const discoveryCache = new Map<string, { expiresAt: number; snapshot: ClaudeDiscoverySnapshot }>();
const discoveryInFlight = new Map<string, Promise<ClaudeDiscoverySnapshot>>();

export function discoverClaude(executable: string): Promise<ClaudeDiscoverySnapshot> {
  const cacheKey = executable.trim();
  const cached = discoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.snapshot);
  }

  const pending = discoveryInFlight.get(cacheKey);
  if (pending) {
    return pending;
  }

  const discovery = discoverClaudeUncached(cacheKey).then((snapshot) => {
    discoveryCache.set(cacheKey, {
      expiresAt: Date.now() + discoveryCacheTtlMs,
      snapshot,
    });
    return snapshot;
  });
  discoveryInFlight.set(cacheKey, discovery);
  const clearInFlight = () => {
    if (discoveryInFlight.get(cacheKey) === discovery) {
      discoveryInFlight.delete(cacheKey);
    }
  };
  void discovery.then(clearInFlight, clearInFlight);
  return discovery;
}

async function discoverClaudeUncached(executable: string): Promise<ClaudeDiscoverySnapshot> {
  const checkedAt = new Date().toISOString();
  const resolvedPath = await resolveCommandAsync(executable);

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

  const [versionResult, helpResult] = await Promise.all([
    runCommand(resolvedPath, ['--version']),
    runCommand(resolvedPath, ['--help']),
  ]);
  const output = `${versionResult.stdout.trim()} ${versionResult.stderr.trim()}`.trim();
  const helpOutput = `${helpResult.stdout} ${helpResult.stderr}`;

  return {
    executable,
    resolvedPath,
    found: versionResult.exitCode === 0,
    version: versionResult.exitCode === 0 ? output || 'Version output was empty.' : null,
    capabilities: parseClaudeHelp(helpOutput, helpResult.exitCode === 0),
    error:
      versionResult.exitCode === 0
        ? null
        : versionResult.timedOut
          ? `Claude version check timed out after ${commandTimeoutMs / 1000} seconds.`
          : output ||
            `Claude version check exited with code ${versionResult.exitCode ?? 'unknown'}.`,
    checkedAt,
  };
}

function runCommand(
  executable: string,
  args: string[],
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    execFile(
      executable,
      args,
      {
        encoding: 'utf8',
        timeout: commandTimeoutMs,
        maxBuffer: 256 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error ? (typeof error.code === 'number' ? error.code : null) : 0,
          stdout,
          stderr,
          timedOut: Boolean(error?.killed),
        });
      },
    );
  });
}

export function parseClaudeHelp(
  helpOutput: string,
  helpAvailable = true,
): ClaudeContinuationCapabilities {
  const hasContinueLong = /(?:^|\s)--continue(?:\s|,|$)/.test(helpOutput);
  const hasResumeLong = /(?:^|\s)--resume(?:\s|,|$)/.test(helpOutput);
  const hasNameLong = /(?:^|\s)--name(?:\s|,|$)/.test(helpOutput);

  return {
    helpAvailable,
    continueMostRecent: hasContinueLong,
    continueFlag: hasContinueLong ? '--continue' : null,
    resumeSpecific: hasResumeLong,
    resumeFlag: hasResumeLong ? '--resume' : null,
    nameSession: hasNameLong,
    nameFlag: hasNameLong ? '--name' : null,
  };
}

function emptyCapabilities(): ClaudeContinuationCapabilities {
  return {
    helpAvailable: false,
    continueMostRecent: false,
    continueFlag: null,
    resumeSpecific: false,
    resumeFlag: null,
    nameSession: false,
    nameFlag: null,
  };
}
