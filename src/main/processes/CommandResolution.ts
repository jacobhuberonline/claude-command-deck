import { spawnSync } from 'node:child_process';

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
