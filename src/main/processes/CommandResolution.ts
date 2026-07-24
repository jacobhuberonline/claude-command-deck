import { execFile, spawnSync } from 'node:child_process';

export function resolveCommand(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const resolver = platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(resolver, [command], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    return null;
  }

  return result.stdout.split(/\r?\n/).find(Boolean)?.trim() ?? null;
}

export function resolveCommandAsync(
  command: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const resolver = platform === 'win32' ? 'where.exe' : 'which';
  return new Promise((resolve) => {
    execFile(
      resolver,
      [command],
      {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(null);
          return;
        }

        resolve(stdout.split(/\r?\n/).find(Boolean)?.trim() ?? null);
      },
    );
  });
}
