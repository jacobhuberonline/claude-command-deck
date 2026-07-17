import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const electronRoot = join(root, 'node_modules', 'electron');
const executablePath =
  platform() === 'win32'
    ? join(electronRoot, 'dist', 'electron.exe')
    : platform() === 'darwin'
      ? join(electronRoot, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
      : join(electronRoot, 'dist', 'electron');

if (existsSync(executablePath)) {
  process.exit(0);
}

const installer = join(electronRoot, 'install.js');
if (!existsSync(installer)) {
  console.warn('Electron installer was not found; run npm ci again with dev dependencies enabled.');
  process.exit(0);
}

console.warn('Electron binary is missing; running Electron installer.');
const result = spawnSync(process.execPath, [installer], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!existsSync(executablePath)) {
  console.error('Electron installer completed, but the Electron executable is still missing.');
  process.exit(1);
}
