import { existsSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import {
  MAX_SESSION_COUNT,
  type ManagedProcessSnapshot,
  type SessionId,
} from '../../shared/domain/types';
import type { CommandResult, StartShellRequest } from '../../shared/ipc/contracts';
import type { SafeLogger } from '../logging/SafeLogger';
import { resolveCommand } from './CommandResolution';
import { resolveShell } from './ShellDiscovery';
import { PtyProcess } from './PtyProcess';

interface ProcessManagerEvents {
  onOutput: (sessionId: SessionId, processId: string, data: string) => void;
  onExit: (
    sessionId: SessionId,
    processId: string,
    exitCode: number | null,
    signal: string | null,
    crashed: boolean,
  ) => void;
  onState: (sessionId: SessionId, snapshot: ManagedProcessSnapshot) => void;
}

interface ResolvedClaudeStartRequest {
  sessionId: SessionId;
  workingDirectory: string;
  executable: string;
  args: string[];
  cols: number;
  rows: number;
}

type ManagedProcessStartResult = { ok: true; processId: string } | { ok: false; error: string };

export class ProcessManager {
  private readonly processes = new Map<SessionId, PtyProcess>();
  private readonly processEpochs = new Map<SessionId, number>();
  private readonly outputBuffers = new Map<SessionId, { processId: string; data: string }>();
  private readonly outputFlushTimers = new Map<SessionId, NodeJS.Timeout>();

  constructor(
    private readonly logger: SafeLogger,
    private readonly events: ProcessManagerEvents,
  ) {}

  startShell(request: StartShellRequest): CommandResult {
    const resolution = resolveShell(request.shellKind);
    if (!resolution.ok) {
      return resolution;
    }
    const { shell } = resolution;
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

  startClaude(request: ResolvedClaudeStartRequest): ManagedProcessStartResult {
    const executable = resolveExecutable(request.executable);
    if (!executable) {
      return { ok: false, error: `Claude executable "${request.executable}" was not found.` };
    }

    const result = this.startManagedProcess({
      type: 'claudeSession',
      sessionId: request.sessionId,
      workingDirectory: request.workingDirectory,
      executable,
      args: request.args,
      cols: request.cols,
      rows: request.rows,
      logLabel: 'Claude session started',
    });
    if (!result.ok) {
      return result;
    }

    const processId = this.processes.get(request.sessionId)?.snapshot().id;
    return processId
      ? { ok: true, processId }
      : { ok: false, error: 'Claude started without a managed process identity.' };
  }

  write(sessionId: SessionId, data: string): CommandResult {
    const process = this.processes.get(sessionId);
    if (!process?.write(data)) {
      return { ok: false, error: 'No running process is attached to this session bay.' };
    }

    return { ok: true };
  }

  resize(sessionId: SessionId, cols: number, rows: number): CommandResult {
    const process = this.processes.get(sessionId);
    if (!process?.resize(cols, rows)) {
      return { ok: false, error: 'No running process is attached to this session bay.' };
    }

    return { ok: true };
  }

  stop(sessionId: SessionId): CommandResult {
    const process = this.processes.get(sessionId);
    if (!process) {
      return { ok: false, error: 'No process is attached to this session bay.' };
    }

    return process.stop()
      ? { ok: true }
      : { ok: false, error: 'The attached process could not be stopped.' };
  }

  snapshots(): ManagedProcessSnapshot[] {
    return [...this.processes.values()].map((process) => process.snapshot());
  }

  hasActiveProcess(sessionId: SessionId): boolean {
    return this.processes.get(sessionId)?.isAttached() ?? false;
  }

  processEpoch(sessionId: SessionId): number {
    return this.processEpochs.get(sessionId) ?? 0;
  }

  stopAll(): void {
    [...this.processes.values()].forEach((process) => {
      process.stop();
    });
  }

  private enqueueOutput(sessionId: SessionId, processId: string, data: string): void {
    const current = this.outputBuffers.get(sessionId);
    if (current && current.processId !== processId) {
      this.flushOutput(sessionId);
    }
    this.outputBuffers.set(sessionId, {
      processId,
      data: (current?.processId === processId ? current.data : '') + data,
    });

    if ((this.outputBuffers.get(sessionId)?.data.length ?? 0) > 64 * 1024) {
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

    const buffered = this.outputBuffers.get(sessionId);
    if (!buffered) {
      return;
    }

    this.outputBuffers.delete(sessionId);
    try {
      this.events.onOutput(sessionId, buffered.processId, buffered.data);
    } catch (error) {
      this.logger.error('Process output observer failed', {
        sessionId,
        processId: buffered.processId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
    if (existing?.isAttached()) {
      return { ok: false, error: 'A process is already active for this session bay.' };
    }
    if (!existing && this.processes.size >= MAX_SESSION_COUNT) {
      return {
        ok: false,
        error: `At most ${MAX_SESSION_COUNT} terminal processes can be active.`,
      };
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
      onData: (activeSessionId, data) =>
        this.enqueueOutput(activeSessionId, process.snapshot().id, data),
      onExit: (activeSessionId, exitCode, signal) => {
        if (this.processes.get(activeSessionId) !== process) {
          return;
        }
        const crashed = process.snapshot().state === 'crashed';
        this.processes.delete(activeSessionId);
        this.flushOutput(activeSessionId);
        try {
          this.events.onExit(activeSessionId, process.snapshot().id, exitCode, signal, crashed);
        } catch (error) {
          this.logger.error('Process exit observer failed', {
            sessionId: activeSessionId,
            processId: process.snapshot().id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      onState: (activeSessionId, snapshot) => {
        if (this.processes.get(activeSessionId) === process) {
          try {
            this.events.onState(activeSessionId, snapshot);
          } catch (error) {
            this.logger.error('Process state observer failed', {
              sessionId: activeSessionId,
              processId: snapshot.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      },
    });

    this.processes.set(sessionId, process);

    try {
      process.start();
      this.processEpochs.set(sessionId, this.processEpoch(sessionId) + 1);
      this.logger.info(logLabel, {
        sessionId,
        executable,
        workingDirectory: directory,
        ...logMetadata,
      });
      return { ok: true };
    } catch (error) {
      if (this.processes.get(sessionId) === process) {
        this.processes.delete(sessionId);
      }
      process.abortStart();
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

  try {
    if (!existsSync(directory)) {
      return { ok: false, error: 'The configured working directory does not exist.' };
    }

    if (!statSync(directory).isDirectory()) {
      return { ok: false, error: 'The configured working directory is not a directory.' };
    }
  } catch {
    return { ok: false, error: 'The configured working directory could not be accessed.' };
  }

  return { ok: true };
}

function resolveExecutable(executable: string): string | null {
  if (isAbsolute(executable) && existsSync(executable)) {
    return executable;
  }

  return resolveCommand(executable);
}
