import { spawn } from 'node:child_process';
import * as pty from 'node-pty';
import type { AuthCheckResult } from '../../shared/domain/types';
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

export class AuthService {
  private checkInFlight: Promise<AuthCheckResult> | null = null;
  private refreshProcess: pty.IPty | null = null;

  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly logger: SafeLogger,
    private readonly events: AuthServiceEvents,
  ) {}

  check(): Promise<AuthCheckResult> {
    if (this.checkInFlight) {
      return this.checkInFlight;
    }

    this.checkInFlight = this.runCheck().finally(() => {
      this.checkInFlight = null;
    });
    return this.checkInFlight;
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
      this.events.onExit(event.exitCode, signal);
      this.refreshProcess = null;
      if (event.exitCode === 0) {
        void this.check();
      }
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

  private async runCheck(): Promise<AuthCheckResult> {
    const settings = this.settingsStore.load();
    const auth = settings.auth;
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
      let stdout = '';
      let stderr = '';
      let settled = false;
      const command = buildShellCommand(auth.checkExecutable, auth.checkArgs, auth.shellMode);
      const child = spawn(command.executable, command.args, {
        cwd: auth.workingDirectory || process.cwd(),
        shell: false,
        windowsHide: true,
      });

      const timeout = windowlessTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill();
        resolve({ status: 'error', checkedAt, error: 'Credential check timed out.' });
      }, auth.checkTimeoutSeconds * 1000);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve({ status: 'error', checkedAt, error: error.message });
      });
      child.on('close', (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);

        if (code !== 0) {
          resolve({
            status: 'disconnected',
            checkedAt,
            error: stderr.trim() || `Credential check exited with code ${code ?? 'unknown'}.`,
          });
          return;
        }

        const safeIdentity = auth.provider === 'aws' ? parseAwsCallerIdentity(stdout) : undefined;
        resolve({
          status: 'connected',
          checkedAt,
          safeIdentity: safeIdentity ?? undefined,
        });
      });
    });
  }
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
