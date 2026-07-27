import { accessSync, constants, statSync } from 'node:fs';
import { win32 } from 'node:path';
import type { ShellKind, ShellOption } from '../../shared/domain/types';
import { resolveCommand, resolveCommandAsync } from './CommandResolution';

export interface ShellDiscoveryResult {
  executable: string;
  args: string[];
  source: ShellKind;
}

export type ShellResolution =
  { ok: true; shell: ShellDiscoveryResult } | { ok: false; error: string };

export interface ShellDiscoveryDependencies {
  commandResolver?: (command: string, platform: NodeJS.Platform) => string | null;
  pathExists?: (path: string) => boolean;
}

const shellLabels: Record<ShellKind, string> = {
  auto: 'Automatic (recommended)',
  powershell7: 'PowerShell 7',
  windowsPowerShell: 'Windows PowerShell',
  commandPrompt: 'Command Prompt',
  bash: 'Bash',
  zsh: 'Zsh',
};

export function resolveShell(
  kind: ShellKind,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: ShellDiscoveryDependencies = {},
): ShellResolution {
  const commandResolver = dependencies.commandResolver ?? resolveCommand;
  const pathExists =
    dependencies.pathExists ?? ((path: string) => isExecutableFile(path, platform));

  if (kind === 'auto') {
    if (platform === 'win32') {
      for (const candidate of ['powershell7', 'windowsPowerShell', 'commandPrompt'] as const) {
        const resolution = resolveKnownShell(candidate, platform, env, commandResolver, pathExists);
        if (resolution.ok) {
          return resolution;
        }
      }
    } else {
      const environmentShell = env.SHELL?.trim();
      if (environmentShell && pathExists(environmentShell)) {
        return {
          ok: true,
          shell: {
            executable: environmentShell,
            args: [],
            source: sourceForEnvironmentShell(environmentShell),
          },
        };
      }

      for (const candidate of ['zsh', 'bash', 'powershell7'] as const) {
        const resolution = resolveKnownShell(candidate, platform, env, commandResolver, pathExists);
        if (resolution.ok) {
          return resolution;
        }
      }
    }

    return {
      ok: false,
      error:
        'No supported shell was found. Install a shell or choose an available shell in Settings.',
    };
  }

  return resolveKnownShell(kind, platform, env, commandResolver, pathExists);
}

export function listShellOptions(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: ShellDiscoveryDependencies = {},
): ShellOption[] {
  const kinds: ShellKind[] =
    platform === 'win32'
      ? ['auto', 'powershell7', 'windowsPowerShell', 'commandPrompt']
      : ['auto', 'zsh', 'bash', 'powershell7'];
  const commandResolver = dependencies.commandResolver ?? resolveCommand;
  const resolutionCache = new Map<string, string | null>();
  const cachedDependencies: ShellDiscoveryDependencies = {
    ...dependencies,
    commandResolver: (command, targetPlatform) => {
      const key = `${targetPlatform}:${command}`;
      if (!resolutionCache.has(key)) {
        resolutionCache.set(key, commandResolver(command, targetPlatform));
      }
      return resolutionCache.get(key) ?? null;
    },
  };

  return kinds.map((kind) => ({
    kind,
    label: shellLabels[kind],
    available: resolveShell(kind, platform, env, cachedDependencies).ok,
  }));
}

export async function listShellOptionsAsync(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ShellOption[]> {
  const commands =
    platform === 'win32' ? ['pwsh.exe', 'powershell.exe', 'cmd.exe'] : ['zsh', 'bash', 'pwsh'];
  const resolvedCommands = new Map(
    await Promise.all(
      commands.map(
        async (command) => [command, await resolveCommandAsync(command, platform)] as const,
      ),
    ),
  );

  return listShellOptions(platform, env, {
    commandResolver: (command) => resolvedCommands.get(command) ?? null,
  });
}

export function discoverDefaultShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ShellDiscoveryResult {
  const resolution = resolveShell('auto', platform, env);
  if (!resolution.ok) {
    throw new Error(resolution.error);
  }
  return resolution.shell;
}

function resolveKnownShell(
  kind: Exclude<ShellKind, 'auto'>,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  commandResolver: (command: string, platform: NodeJS.Platform) => string | null,
  pathExists: (path: string) => boolean,
): ShellResolution {
  if (kind === 'windowsPowerShell') {
    if (platform !== 'win32') {
      return unavailable(kind, 'powershell.exe');
    }
    const systemRoot = windowsEnvironmentPath(env.SystemRoot ?? env.windir);
    const fallbackPaths = systemRoot
      ? [win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')]
      : [];
    return resolvedCommand(
      kind,
      'powershell.exe',
      ['-NoLogo'],
      platform,
      commandResolver,
      fallbackPaths,
      pathExists,
    );
  }

  if (kind === 'commandPrompt') {
    if (platform !== 'win32') {
      return unavailable(kind, 'cmd.exe');
    }

    const comSpec = windowsEnvironmentPath(env.ComSpec ?? env.COMSPEC);
    if (comSpec && pathExists(comSpec)) {
      return {
        ok: true,
        shell: {
          executable: comSpec,
          args: ['/d'],
          source: kind,
        },
      };
    }
    const systemRoot = windowsEnvironmentPath(env.SystemRoot ?? env.windir);
    const fallbackPaths = systemRoot ? [win32.join(systemRoot, 'System32', 'cmd.exe')] : [];
    return resolvedCommand(
      kind,
      'cmd.exe',
      ['/d'],
      platform,
      commandResolver,
      fallbackPaths,
      pathExists,
    );
  }

  if (kind === 'powershell7') {
    const command = platform === 'win32' ? 'pwsh.exe' : 'pwsh';
    const programFiles =
      platform === 'win32'
        ? windowsEnvironmentPath(env.ProgramW6432 ?? env.ProgramFiles)
        : undefined;
    const fallbackPaths = programFiles
      ? [win32.join(programFiles, 'PowerShell', '7', 'pwsh.exe')]
      : [];
    return resolvedCommand(
      kind,
      command,
      ['-NoLogo'],
      platform,
      commandResolver,
      fallbackPaths,
      pathExists,
    );
  }

  if (platform === 'win32') {
    return unavailable(kind, kind);
  }

  return resolvedCommand(kind, kind, [], platform, commandResolver);
}

function resolvedCommand(
  kind: Exclude<ShellKind, 'auto'>,
  command: string,
  args: string[],
  platform: NodeJS.Platform,
  commandResolver: (command: string, platform: NodeJS.Platform) => string | null,
  fallbackPaths: string[] = [],
  pathExists: (path: string) => boolean = () => false,
): ShellResolution {
  const executable =
    commandResolver(command, platform) ??
    fallbackPaths.find((candidate) => pathExists(candidate)) ??
    null;
  if (!executable) {
    return unavailable(kind, command);
  }

  return {
    ok: true,
    shell: {
      executable,
      args,
      source: kind,
    },
  };
}

function unavailable(kind: Exclude<ShellKind, 'auto'>, command: string): ShellResolution {
  return {
    ok: false,
    error: `${shellLabels[kind]} was selected, but "${command}" was not found by the app. Make sure it is installed and on PATH, restart after PATH changes, or choose another shell.`,
  };
}

function sourceForEnvironmentShell(executable: string): ShellKind {
  const normalized = executable.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase();
  if (normalized === 'zsh') {
    return 'zsh';
  }
  if (normalized === 'bash') {
    return 'bash';
  }
  if (normalized === 'pwsh' || normalized === 'pwsh.exe') {
    return 'powershell7';
  }
  return 'auto';
}

function windowsEnvironmentPath(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^"(.*)"$/, '$1');
  return normalized || undefined;
}

function isExecutableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    if (platform !== 'win32') {
      accessSync(path, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}
