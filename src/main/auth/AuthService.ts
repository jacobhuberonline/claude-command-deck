import { spawn } from 'node:child_process';
import * as pty from 'node-pty';
import type { AuthCheckResult, AuthConfiguration } from '../../shared/domain/types';
import type {
  AuthResizeRequest,
  AuthWriteRequest,
  CommandResult,
} from '../../shared/ipc/contracts';
import type { SafeLogger } from '../logging/SafeLogger';
import type { SettingsStore } from '../persistence/SettingsStore';
import { parseAwsCallerIdentity } from './AuthParsers';

interface AuthServiceEvents {
  onOutput: (data: string) => void;
  onExit: (exitCode: number | null, signal: string | null) => void;
}

interface AuthCheckFlight {
  configurationKey: string;
  promise: Promise<AuthCheckResult>;
}

export class AuthService {
  private checkInFlight: AuthCheckFlight | null = null;
  private refreshProcess: pty.IPty | null = null;
  private freshCheckRequired = false;

  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly logger: SafeLogger,
    private readonly events: AuthServiceEvents,
  ) {}

  check(): Promise<AuthCheckResult> {
    const auth = this.settingsStore.load().auth;
    const configurationKey = authCheckConfigurationKey(auth);
    if (this.refreshProcess) {
      return Promise.resolve({
        status: 'refreshing',
        checkedAt: new Date().toISOString(),
        error: 'Credential login is still running.',
      });
    }
    if (this.freshCheckRequired) {
      this.freshCheckRequired = false;
      return this.queueFreshCheck(auth, configurationKey);
    }
    if (this.checkInFlight?.configurationKey === configurationKey) {
      return this.checkInFlight.promise;
    }

    return this.queueFreshCheck(auth, configurationKey);
  }

  startRefresh(): CommandResult {
    const settings = this.settingsStore.load();
    const auth = settings.auth;

    if (this.refreshProcess) {
      return { ok: false, error: 'Credential refresh is already running.' };
    }

    if (!auth.refreshExecutable.trim()) {
      return { ok: false, error: 'Credential refresh command is not configured.' };
    }

    try {
      const command = buildShellCommand(auth.refreshExecutable, auth.refreshArgs, auth.shellMode);
      this.refreshProcess = pty.spawn(command.executable, command.args, {
        name: 'xterm-256color',
        cols: 100,
        rows: 24,
        cwd: auth.workingDirectory || process.cwd(),
        env: process.env,
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to start credential refresh.',
      };
    }

    this.logger.info('Authentication refresh PTY started', {
      executable: auth.refreshExecutable,
      shellMode: auth.shellMode,
      workingDirectory: auth.workingDirectory || process.cwd(),
    });
    this.refreshProcess.onData((data) => this.events.onOutput(data));
    this.refreshProcess.onExit((event) => {
      const signal = event.signal === undefined ? null : String(event.signal);
      this.logger.info('Authentication refresh PTY exited', {
        exitCode: event.exitCode,
        signal,
      });
      this.refreshProcess = null;
      // The next check must run after any pre-login probe. The renderer owns presentation and
      // requests this authoritative check after receiving the exit event.
      this.freshCheckRequired = true;
      this.events.onExit(event.exitCode, signal);
    });

    return { ok: true };
  }

  write(request: AuthWriteRequest): CommandResult {
    if (!this.refreshProcess) {
      return { ok: false, error: 'Credential refresh is not running.' };
    }

    this.refreshProcess.write(request.data);
    return { ok: true };
  }

  resize(request: AuthResizeRequest): CommandResult {
    if (!this.refreshProcess) {
      return { ok: false, error: 'Credential refresh is not running.' };
    }

    this.refreshProcess.resize(request.cols, request.rows);
    return { ok: true };
  }

  stopRefresh(): CommandResult {
    if (!this.refreshProcess) {
      return { ok: false, error: 'Credential refresh is not running.' };
    }

    this.refreshProcess.kill();
    return { ok: true };
  }

  private queueFreshCheck(
    auth: AuthConfiguration,
    configurationKey: string,
  ): Promise<AuthCheckResult> {
    const previous = this.checkInFlight?.promise;
    const waitForPrevious = previous
      ? previous.then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
    const promise = waitForPrevious.then(() => this.runCheck(auth));
    const flight: AuthCheckFlight = { configurationKey, promise };
    this.checkInFlight = flight;
    void promise.then(
      () => {
        if (this.checkInFlight === flight) {
          this.checkInFlight = null;
        }
      },
      () => {
        if (this.checkInFlight === flight) {
          this.checkInFlight = null;
        }
      },
    );
    return promise;
  }

  private async runCheck(auth: AuthConfiguration): Promise<AuthCheckResult> {
    const checkedAt = new Date().toISOString();

    if (auth.provider === 'disabled') {
      return {
        status: 'notConfigured',
        checkedAt,
        error: 'Authentication monitoring is disabled.',
      };
    }

    if (!auth.checkExecutable.trim()) {
      return {
        status: 'notConfigured',
        checkedAt,
        error: 'Credential check command is not configured.',
      };
    }

    this.logger.info('Authentication check started', {
      provider: auth.provider,
      executable: auth.checkExecutable,
    });

    return new Promise<AuthCheckResult>((resolve) => {
      const startedAtMs = Date.now();
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      let timeout: NodeJS.Timeout | undefined = undefined;
      let terminateFallback: NodeJS.Timeout | undefined;
      let killFallback: NodeJS.Timeout | undefined;
      const finish = (result: AuthCheckResult, exitCode?: number | null) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        if (terminateFallback) {
          clearTimeout(terminateFallback);
        }
        if (killFallback) {
          clearTimeout(killFallback);
        }
        this.logger.info('Authentication check completed', {
          provider: auth.provider,
          status: result.status,
          durationMs: Date.now() - startedAtMs,
          ...(exitCode === undefined ? {} : { exitCode }),
        });
        resolve(result);
      };

      const command = buildShellCommand(auth.checkExecutable, auth.checkArgs, auth.shellMode);
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(command.executable, command.args, {
          cwd: auth.workingDirectory || process.cwd(),
          shell: false,
          windowsHide: true,
        });
      } catch (error) {
        finish({
          status: 'error',
          checkedAt,
          error: error instanceof Error ? error.message : 'Credential check could not start.',
        });
        return;
      }

      timeout = windowlessTimeout(() => {
        if (settled) {
          return;
        }
        timedOut = true;
        try {
          child.kill();
        } catch {
          finish({ status: 'error', checkedAt, error: 'Credential check timed out.' });
          return;
        }
        terminateFallback = windowlessTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            finish({ status: 'error', checkedAt, error: 'Credential check timed out.' });
            return;
          }
          killFallback = windowlessTimeout(() => {
            finish({ status: 'error', checkedAt, error: 'Credential check timed out.' });
          }, 1000);
        }, 1000);
      }, auth.checkTimeoutSeconds * 1000);

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        if (timedOut) {
          this.logger.warn('Authentication check process error during timeout cleanup', {
            provider: auth.provider,
            error: error.message,
          });
          return;
        }
        finish({ status: 'error', checkedAt, error: error.message });
      });
      child.on('close', (code, signal) => {
        if (settled) {
          return;
        }

        if (timedOut) {
          finish({ status: 'error', checkedAt, error: 'Credential check timed out.' }, code);
          return;
        }

        if (code === null || signal) {
          finish(
            {
              status: 'error',
              checkedAt,
              error: `Credential check terminated by signal ${signal ?? 'unknown'}.`,
            },
            code,
          );
          return;
        }

        if (code !== 0) {
          finish(
            {
              status: 'disconnected',
              checkedAt,
              error: stderr.trim() || `Credential check exited with code ${code ?? 'unknown'}.`,
            },
            code,
          );
          return;
        }

        const safeIdentity = auth.provider === 'aws' ? parseAwsCallerIdentity(stdout) : undefined;
        if (auth.provider === 'aws' && !safeIdentity) {
          finish(
            {
              status: 'error',
              checkedAt,
              error: 'AWS credential check returned an invalid identity response.',
            },
            code,
          );
          return;
        }

        finish(
          {
            status: 'connected',
            checkedAt,
            safeIdentity: safeIdentity ?? undefined,
          },
          code,
        );
      });
    });
  }
}

function authCheckConfigurationKey(auth: AuthConfiguration): string {
  return JSON.stringify({
    provider: auth.provider,
    checkExecutable: auth.checkExecutable,
    checkArgs: auth.checkArgs,
    workingDirectory: auth.workingDirectory,
    shellMode: auth.shellMode,
    checkTimeoutSeconds: auth.checkTimeoutSeconds,
  });
}

function buildShellCommand(executable: string, args: string[], shellMode: boolean) {
  if (!shellMode) {
    return { executable, args };
  }

  const commandLine = [executable, ...args].map(quoteShellArgument).join(' ');

  if (process.platform === 'win32') {
    return {
      executable: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', commandLine],
    };
  }

  return {
    executable: process.env.SHELL || '/bin/sh',
    args: ['-lc', commandLine],
  };
}

function quoteShellArgument(value: string) {
  if (!value) {
    return '""';
  }

  if (!/[\s"&|<>^]/.test(value)) {
    return value;
  }

  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function windowlessTimeout(callback: () => void, ms: number) {
  return setTimeout(callback, ms);
}
