import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import { AuthService } from '../src/main/auth/AuthService';
import type { SafeLogger } from '../src/main/logging/SafeLogger';
import type { SettingsStore } from '../src/main/persistence/SettingsStore';
import type { AuthConfiguration } from '../src/shared/domain/types';

const processMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  ptySpawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  default: {
    spawn: processMocks.spawn,
  },
  spawn: processMocks.spawn,
}));

vi.mock('node-pty', () => ({
  default: {
    spawn: processMocks.ptySpawn,
  },
  spawn: processMocks.ptySpawn,
}));

class FakeOutput extends EventEmitter {
  setEncoding() {}
}

class FakeCheckProcess extends EventEmitter {
  readonly stdout = new FakeOutput();
  readonly stderr = new FakeOutput();
  readonly kill = vi.fn();
}

class FakeRefreshProcess {
  private exitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined;

  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly kill = vi.fn();

  onData() {}

  onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
    this.exitListener = listener;
  }

  exit(exitCode: number, signal?: number) {
    this.exitListener?.(signal === undefined ? { exitCode } : { exitCode, signal });
  }
}

describe('authentication service check freshness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats a signal-terminated probe as indeterminate instead of disconnected', async () => {
    const auth = createAuthConfiguration('probe');
    const settingsStore = {
      load: vi.fn(() => ({ auth })),
    } as unknown as SettingsStore;
    const process = new FakeCheckProcess();
    processMocks.spawn.mockReturnValue(process);
    const service = new AuthService(settingsStore, createLogger(), {
      onOutput: vi.fn(),
      onExit: vi.fn(),
    });

    const check = service.check();
    await vi.waitFor(() => expect(processMocks.spawn).toHaveBeenCalledTimes(1));
    process.emit('close', null, 'SIGTERM');

    await expect(check).resolves.toMatchObject({
      status: 'error',
      error: 'Credential check terminated by signal SIGTERM.',
    });
  });

  it('escalates a timed-out probe and keeps the check pending until process close', async () => {
    vi.useFakeTimers();
    const auth = createAuthConfiguration('probe');
    auth.checkTimeoutSeconds = 0.001;
    const settingsStore = {
      load: vi.fn(() => ({ auth })),
    } as unknown as SettingsStore;
    const process = new FakeCheckProcess();
    process.kill.mockImplementationOnce(() => {
      process.emit('error', new Error('Unable to deliver termination signal.'));
    });
    processMocks.spawn.mockReturnValue(process);
    const service = new AuthService(settingsStore, createLogger(), {
      onOutput: vi.fn(),
      onExit: vi.fn(),
    });

    const check = service.check();
    let checkSettled = false;
    void check.then(() => {
      checkSettled = true;
    });
    await Promise.resolve();
    expect(processMocks.spawn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(process.kill).toHaveBeenNthCalledWith(1);
    expect(checkSettled).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(process.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
    expect(checkSettled).toBe(false);
    process.emit('close', null, 'SIGKILL');

    await expect(check).resolves.toMatchObject({
      status: 'error',
      error: 'Credential check timed out.',
    });
  });

  it('queues a fresh check when credential-check configuration changes', async () => {
    let auth = createAuthConfiguration('probe-a');
    const settingsStore = {
      load: vi.fn(() => ({ auth })),
    } as unknown as SettingsStore;
    const firstProcess = new FakeCheckProcess();
    const secondProcess = new FakeCheckProcess();
    processMocks.spawn.mockReturnValueOnce(firstProcess).mockReturnValueOnce(secondProcess);
    const service = new AuthService(settingsStore, createLogger(), {
      onOutput: vi.fn(),
      onExit: vi.fn(),
    });

    const firstCheck = service.check();
    await vi.waitFor(() => expect(processMocks.spawn).toHaveBeenCalledTimes(1));
    auth = createAuthConfiguration('probe-b');
    const secondCheck = service.check();

    expect(processMocks.spawn).toHaveBeenCalledTimes(1);
    firstProcess.stderr.emit('data', 'first check failed');
    firstProcess.emit('close', 1);
    await vi.waitFor(() => expect(processMocks.spawn).toHaveBeenCalledTimes(2));
    secondProcess.emit('close', 0);

    await expect(firstCheck).resolves.toMatchObject({ status: 'disconnected' });
    await expect(secondCheck).resolves.toMatchObject({ status: 'connected' });
    expect(processMocks.spawn.mock.calls[0]?.[0]).toBe('probe-a');
    expect(processMocks.spawn.mock.calls[1]?.[0]).toBe('probe-b');
  });

  it('does not reuse a pre-login check for post-login verification', async () => {
    const auth = createAuthConfiguration('probe');
    auth.refreshExecutable = 'login';
    const settingsStore = {
      load: vi.fn(() => ({ auth })),
    } as unknown as SettingsStore;
    const firstProcess = new FakeCheckProcess();
    const postLoginProcess = new FakeCheckProcess();
    const refreshProcess = new FakeRefreshProcess();
    processMocks.spawn.mockReturnValueOnce(firstProcess).mockReturnValueOnce(postLoginProcess);
    processMocks.ptySpawn.mockReturnValue(refreshProcess);
    let postExitCheck: Promise<unknown> | undefined;
    const service = new AuthService(settingsStore, createLogger(), {
      onOutput: vi.fn(),
      onExit: vi.fn(() => {
        postExitCheck = service.check();
      }),
    });

    const preLoginCheck = service.check();
    await vi.waitFor(() => expect(processMocks.spawn).toHaveBeenCalledTimes(1));
    expect(service.startRefresh()).toEqual({ ok: true });
    refreshProcess.exit(0);

    firstProcess.stderr.emit('data', 'stale check failed');
    firstProcess.emit('close', 1);
    await vi.waitFor(() => expect(processMocks.spawn).toHaveBeenCalledTimes(2));
    postLoginProcess.emit('close', 0);

    await expect(preLoginCheck).resolves.toMatchObject({ status: 'disconnected' });
    await expect(postExitCheck).resolves.toMatchObject({ status: 'connected' });
    expect(processMocks.spawn).toHaveBeenCalledTimes(2);
  });

  it('reports login in progress instead of running a competing check', async () => {
    const auth = createAuthConfiguration('probe');
    auth.refreshExecutable = 'login';
    const settingsStore = {
      load: vi.fn(() => ({ auth })),
    } as unknown as SettingsStore;
    const refreshProcess = new FakeRefreshProcess();
    processMocks.ptySpawn.mockReturnValue(refreshProcess);
    const service = new AuthService(settingsStore, createLogger(), {
      onOutput: vi.fn(),
      onExit: vi.fn(),
    });

    expect(service.startRefresh()).toEqual({ ok: true });

    await expect(service.check()).resolves.toMatchObject({ status: 'refreshing' });
    expect(processMocks.spawn).not.toHaveBeenCalled();
  });

  it('does not report an invalid AWS identity response as connected', async () => {
    const auth = createAuthConfiguration('aws');
    auth.provider = 'aws';
    const settingsStore = {
      load: vi.fn(() => ({ auth })),
    } as unknown as SettingsStore;
    const process = new FakeCheckProcess();
    processMocks.spawn.mockReturnValue(process);
    const service = new AuthService(settingsStore, createLogger(), {
      onOutput: vi.fn(),
      onExit: vi.fn(),
    });

    const check = service.check();
    await vi.waitFor(() => expect(processMocks.spawn).toHaveBeenCalledTimes(1));
    process.stdout.emit('data', '{}');
    process.emit('close', 0);

    await expect(check).resolves.toMatchObject({
      status: 'error',
      error: 'AWS credential check returned an invalid identity response.',
    });
  });
});

function createAuthConfiguration(checkExecutable: string): AuthConfiguration {
  return {
    provider: 'custom',
    checkExecutable,
    checkArgs: [],
    refreshExecutable: '',
    refreshArgs: [],
    workingDirectory: '',
    shellMode: false,
    checkIntervalSeconds: 3600,
    checkTimeoutSeconds: 15,
    expirationWarningMinutes: 15,
    startupChecksEnabled: true,
    nativeNotificationsEnabled: true,
  };
}

function createLogger(): SafeLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as SafeLogger;
}
