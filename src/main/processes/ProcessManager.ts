import { existsSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { ManagedProcessSnapshot, SessionId } from '../../shared/domain/types';
import type {
  CommandResult,
  StartClaudeRequest,
  StartShellRequest,
} from '../../shared/ipc/contracts';
import type { SafeLogger } from '../logging/SafeLogger';
import { resolveCommand } from './CommandResolution';
import { discoverDefaultShell } from './ShellDiscovery';
import { PtyProcess } from './PtyProcess';

interface ProcessManagerEvents {
  onOutput: (sessionId: SessionId, data: string) => void;
  onExit: (sessionId: SessionId, exitCode: number | null, signal: string | null) => void;
  onState: (sessionId: SessionId, snapshot: ManagedProcessSnapshot) => void;
}

export class ProcessManager {
  private readonly processes = new Map<SessionId, PtyProcess>();
  private readonly outputBuffers = new Map<SessionId, string>();
  private readonly outputFlushTimers = new Map<SessionId, NodeJS.Timeout>();

  constructor(
    private readonly logger: SafeLogger,
    private readonly events: ProcessManagerEvents,
  ) {}

  startShell(request: StartShellRequest): CommandResult {
    const shell = discoverDefaultShell();
    return this.startManagedProcess({
      type: 'shellSession',
      sessionId: request.sessionId,
      workingDirectory: request.workingDirectory,
      executable: shell.executable,
      args: shell.args,
      cols: request.cols,
      rows: request.rows,
      logLabel: 'Shell session started',
      logMetadata: { shellSource: shell.source },
    });
  }

  startClaude(request: StartClaudeRequest): CommandResult {
    const executable = resolveExecutable(request.executable);
    if (!executable) {
      return { ok: false, error: `Claude executable "${request.executable}" was not found.` };
    }

    return this.startManagedProcess({
      type: 'claudeSession',
      sessionId: request.sessionId,
      workingDirectory: request.workingDirectory,
      executable,
      args: request.args,
      cols: request.cols,
      rows: request.rows,
      logLabel: 'Claude session started',
    });
  }

  write(sessionId: SessionId, data: string): CommandResult {
    const process = this.processes.get(sessionId);
    if (!process?.write(data)) {
      return { ok: false, error: 'No running PTY is attached to this session bay.' };
    }

    return { ok: true };
  }

  resize(sessionId: SessionId, cols: number, rows: number): CommandResult {
    const process = this.processes.get(sessionId);
    if (!process?.resize(cols, rows)) {
      return { ok: false, error: 'No running PTY is attached to this session bay.' };
    }

    return { ok: true };
  }

  stop(sessionId: SessionId): CommandResult {
    const process = this.processes.get(sessionId);
    if (!process) {
      return { ok: false, error: 'No PTY is attached to this session bay.' };
    }

    process.stop();
    return { ok: true };
  }

  snapshots(): ManagedProcessSnapshot[] {
    return [...this.processes.values()].map((process) => process.snapshot());
  }

  stopAll(): void {
    [...this.processes.values()].forEach((process) => process.stop());
  }

  private enqueueOutput(sessionId: SessionId, data: string): void {
    const current = this.outputBuffers.get(sessionId) ?? '';
    this.outputBuffers.set(sessionId, current + data);

    if ((this.outputBuffers.get(sessionId)?.length ?? 0) > 64 * 1024) {
      this.flushOutput(sessionId);
      return;
    }

    if (!this.outputFlushTimers.has(sessionId)) {
      const timer = setTimeout(() => this.flushOutput(sessionId), 16);
      this.outputFlushTimers.set(sessionId, timer);
    }
  }

  private flushOutput(sessionId: SessionId): void {
    const timer = this.outputFlushTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.outputFlushTimers.delete(sessionId);
    }

    const output = this.outputBuffers.get(sessionId);
    if (!output) {
      return;
    }

    this.outputBuffers.delete(sessionId);
    this.events.onOutput(sessionId, output);
  }

  private startManagedProcess({
    type,
    sessionId,
    workingDirectory,
    executable,
    args,
    cols,
    rows,
    logLabel,
    logMetadata = {},
  }: {
    type: 'claudeSession' | 'shellSession';
    sessionId: SessionId;
    workingDirectory: string;
    executable: string;
    args: string[];
    cols: number;
    rows: number;
    logLabel: string;
    logMetadata?: Record<string, unknown>;
  }): CommandResult {
    const existing = this.processes.get(sessionId);
    if (existing && ['starting', 'running', 'stopping'].includes(existing.snapshot().state)) {
      return { ok: false, error: 'A process is already active for this session bay.' };
    }

    const directory = workingDirectory.trim();
    const directoryValidation = validateWorkingDirectory(directory);
    if (!directoryValidation.ok) {
      return directoryValidation;
    }

    const process = new PtyProcess({
      id: randomUUID(),
      type,
      sessionId,
      workingDirectory: directory,
      executable,
      args,
      cols,
      rows,
      logger: this.logger,
      onData: (activeSessionId, data) => this.enqueueOutput(activeSessionId, data),
      onExit: (activeSessionId, exitCode, signal) => {
        this.flushOutput(activeSessionId);
        this.processes.delete(activeSessionId);
        this.events.onExit(activeSessionId, exitCode, signal);
      },
      onState: (activeSessionId, snapshot) => this.events.onState(activeSessionId, snapshot),
    });

    this.processes.set(sessionId, process);

    try {
      process.start();
      this.logger.info(logLabel, {
        sessionId,
        executable,
        workingDirectory: directory,
        ...logMetadata,
      });
      return { ok: true };
    } catch (error) {
      this.processes.delete(sessionId);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to start managed process.',
      };
    }
  }
}

function validateWorkingDirectory(directory: string): CommandResult {
  if (!directory) {
    return { ok: false, error: 'Select a working directory before opening a shell.' };
  }

  if (!existsSync(directory)) {
    return { ok: false, error: 'The configured working directory does not exist.' };
  }

  if (!statSync(directory).isDirectory()) {
    return { ok: false, error: 'The configured working directory is not a directory.' };
  }

  return { ok: true };
}

function resolveExecutable(executable: string): string | null {
  if (isAbsolute(executable) && existsSync(executable)) {
    return executable;
  }

  return resolveCommand(executable);
}
