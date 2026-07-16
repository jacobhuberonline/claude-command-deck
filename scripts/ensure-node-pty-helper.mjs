import { chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { platform, arch } from 'node:os';

if (platform() === 'darwin') {
  const helperPath = join(
    process.cwd(),
    'node_modules',
    'node-pty',
    'prebuilds',
    `darwin-${arch()}`,
    'spawn-helper',
  );

  if (existsSync(helperPath)) {
    chmodSync(helperPath, 0o755);
  }
}
