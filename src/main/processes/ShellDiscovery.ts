import { existsSync } from 'node:fs';
import { resolveCommand } from './CommandResolution';

export interface ShellDiscoveryResult {
  executable: string;
  args: string[];
  source: 'pwsh' | 'windowsPowerShell' | 'posixShell';
}

export function discoverDefaultShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ShellDiscoveryResult {
  if (platform === 'win32') {
    const pwsh = resolveCommand('pwsh.exe', platform);
    if (pwsh) {
      return { executable: pwsh, args: ['-NoLogo'], source: 'pwsh' };
    }

    const powershell = resolveCommand('powershell.exe', platform);
    if (powershell) {
      return { executable: powershell, args: ['-NoLogo'], source: 'windowsPowerShell' };
    }

    return { executable: 'powershell.exe', args: ['-NoLogo'], source: 'windowsPowerShell' };
  }

  const pwsh = resolveCommand('pwsh', platform);
  if (pwsh) {
    return { executable: pwsh, args: ['-NoLogo'], source: 'pwsh' };
  }

  const envShell = env.SHELL;
  if (envShell && existsSync(envShell)) {
    return { executable: envShell, args: [], source: 'posixShell' };
  }

  if (existsSync('/bin/zsh')) {
    return { executable: '/bin/zsh', args: [], source: 'posixShell' };
  }

  return { executable: '/bin/bash', args: [], source: 'posixShell' };
}
