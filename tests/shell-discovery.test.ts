import {
  listShellOptions,
  resolveShell,
  type ShellDiscoveryDependencies,
} from '../src/main/processes/ShellDiscovery';

describe('shell discovery', () => {
  it('prefers PowerShell 7 and then Windows PowerShell in automatic Windows mode', () => {
    const commandResolver = vi.fn((command: string) =>
      command === 'powershell.exe'
        ? 'C:\\Windows\\System32\\WindowsPowerShell\\powershell.exe'
        : null,
    );

    const result = resolveShell('auto', 'win32', {}, { commandResolver });

    expect(result).toEqual({
      ok: true,
      shell: {
        executable: 'C:\\Windows\\System32\\WindowsPowerShell\\powershell.exe',
        args: ['-NoLogo'],
        source: 'windowsPowerShell',
      },
    });
    expect(commandResolver.mock.calls.map(([command]) => command)).toEqual([
      'pwsh.exe',
      'powershell.exe',
    ]);
  });

  it('uses ComSpec for an explicit Command Prompt selection', () => {
    const commandResolver = vi.fn(() => null);
    const pathExists = vi.fn(() => true);

    const result = resolveShell(
      'commandPrompt',
      'win32',
      { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      { commandResolver, pathExists },
    );

    expect(result).toEqual({
      ok: true,
      shell: {
        executable: 'C:\\Windows\\System32\\cmd.exe',
        args: ['/d'],
        source: 'commandPrompt',
      },
    });
    expect(commandResolver).not.toHaveBeenCalled();
  });

  it('falls back to Command Prompt in automatic Windows mode', () => {
    const commandResolver = vi.fn<(command: string, platform: NodeJS.Platform) => string | null>();
    commandResolver.mockReturnValue(null);
    const commandPrompt = 'C:\\Windows\\System32\\cmd.exe';

    const result = resolveShell(
      'auto',
      'win32',
      { COMSPEC: commandPrompt },
      {
        commandResolver,
        pathExists: (path) => path === commandPrompt,
      },
    );

    expect(result).toEqual({
      ok: true,
      shell: {
        executable: commandPrompt,
        args: ['/d'],
        source: 'commandPrompt',
      },
    });
    expect(commandResolver.mock.calls.map(([command]) => command)).toEqual([
      'pwsh.exe',
      'powershell.exe',
    ]);
  });

  it('does not silently fall back when an explicit shell is missing', () => {
    const commandResolver = vi.fn(() => null);

    const result = resolveShell('powershell7', 'win32', {}, { commandResolver });

    expect(result).toEqual({
      ok: false,
      error:
        'PowerShell 7 was selected, but "pwsh.exe" was not found by the app. Make sure it is installed and on PATH, restart after PATH changes, or choose another shell.',
    });
    expect(commandResolver).toHaveBeenCalledOnce();
  });

  it('finds PowerShell 7 in its standard Windows install directory when PATH is stale', () => {
    const executable = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';

    const result = resolveShell(
      'powershell7',
      'win32',
      { ProgramFiles: 'C:\\Program Files' },
      {
        commandResolver: () => null,
        pathExists: (path) => path === executable,
      },
    );

    expect(result).toEqual({
      ok: true,
      shell: {
        executable,
        args: ['-NoLogo'],
        source: 'powershell7',
      },
    });
  });

  it('prefers the configured POSIX environment shell', () => {
    const commandResolver = vi.fn(() => null);

    const result = resolveShell(
      'auto',
      'darwin',
      { SHELL: '/bin/zsh' },
      {
        commandResolver,
        pathExists: (path) => path === '/bin/zsh',
      },
    );

    expect(result).toEqual({
      ok: true,
      shell: {
        executable: '/bin/zsh',
        args: [],
        source: 'zsh',
      },
    });
    expect(commandResolver).not.toHaveBeenCalled();
  });

  it('returns platform-appropriate options with truthful availability', () => {
    const commands = new Map([
      ['pwsh.exe', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'],
      ['cmd.exe', 'C:\\Windows\\System32\\cmd.exe'],
    ]);
    const dependencies: ShellDiscoveryDependencies = {
      commandResolver: (command) => commands.get(command) ?? null,
      pathExists: () => false,
    };

    const options = listShellOptions('win32', {}, dependencies);

    expect(options).toEqual([
      { kind: 'auto', label: 'Automatic (recommended)', available: true },
      { kind: 'powershell7', label: 'PowerShell 7', available: true },
      { kind: 'windowsPowerShell', label: 'Windows PowerShell', available: false },
      { kind: 'commandPrompt', label: 'Command Prompt', available: true },
    ]);
  });
});
