import * as pty from 'node-pty';
import type {
  ManagedProcessSnapshot,
  ManagedProcessType,
  ProcessState,
  SessionId,
} from '../../shared/domain/types';
import type { SafeLogger } from '../logging/SafeLogger';

export interface PtyProcessOptions {
  id: string;
  type: ManagedProcessType;
  sessionId: SessionId;
  workingDirectory: string;
  executable: string;
  args: string[];
  cols: number;
  rows: number;
  logger: SafeLogger;
  onData: (sessionId: SessionId, data: string) => void;
  onExit: (sessionId: SessionId, exitCode: number | null, signal: string | null) => void;
  onState: (sessionId: SessionId, snapshot: ManagedProcessSnapshot) => void;
}

export class PtyProcess {
  private readonly options: PtyProcessOptions;
  private process: pty.IPty | null = null;
  private state: ProcessState = 'starting';
  private startedAt = new Date().toISOString();
  private lastOutputAt: string | undefined;
  private exitCode: number | null | undefined;
  private signal: string | null | undefined;
  private restartGeneration = 0;

  constructor(options: PtyProcessOptions) {
    this.options = options;
  }

  start(): void {
    this.state = 'starting';
    this.emitState();

    try {
      this.process = pty.spawn(this.options.executable, this.options.args, {
        name: 'xterm-256color',
        cols: this.options.cols,
        rows: this.options.rows,
        cwd: this.options.workingDirectory,
        env: process.env,
      });
    } catch (error) {
      this.state = 'error';
      this.options.logger.error('PTY spawn failed', {
        sessionId: this.options.sessionId,
        executable: this.options.executable,
        workingDirectory: this.options.workingDirectory,
        error: error instanceof Error ? error.message : String(error),
      });
      this.emitState();
      throw error;
    }

    const activeProcess = this.process;
    activeProcess.onData((data) => {
      if (this.process !== activeProcess) {
        return;
      }
      this.lastOutputAt = new Date().toISOString();
      this.emitData(data);
    });

    activeProcess.onExit((event) => {
      this.exitCode = event.exitCode;
      this.signal = event.signal === undefined ? null : String(event.signal);
      this.state = this.state === 'stopping' || event.exitCode === 0 ? 'stopped' : 'crashed';
      this.process = null;
      this.options.logger.info('PTY exited', {
        sessionId: this.options.sessionId,
        pid: activeProcess.pid,
        exitCode: this.exitCode,
        signal: this.signal,
      });
      this.emitState();
      this.emitExit(this.exitCode, this.signal);
    });

    this.state = 'running';
    this.options.logger.info('PTY started', {
      sessionId: this.options.sessionId,
      type: this.options.type,
      pid: activeProcess.pid,
      executable: this.options.executable,
      workingDirectory: this.options.workingDirectory,
    });
    this.emitState();
  }

  write(data: string): boolean {
    if (!this.process || this.state !== 'running') {
      return false;
    }

    this.process.write(data);
    return true;
  }

  resize(cols: number, rows: number): boolean {
    if (!this.process || this.state !== 'running') {
      return false;
    }

    this.process.resize(cols, rows);
    return true;
  }

  isAttached(): boolean {
    return this.process !== null;
  }

  stop(): boolean {
    if (!this.process) {
      return false;
    }

    const activeProcess = this.process;
    this.state = 'stopping';
    this.emitState();
    this.options.logger.info('PTY stop requested', {
      sessionId: this.options.sessionId,
      pid: activeProcess.pid,
    });
    try {
      activeProcess.kill();
      return true;
    } catch (error) {
      this.state = 'error';
      this.options.logger.error('PTY stop failed', {
        sessionId: this.options.sessionId,
        pid: activeProcess.pid,
        error: error instanceof Error ? error.message : String(error),
      });
      this.emitState();
      return false;
    }
  }

  abortStart(): void {
    const activeProcess = this.process;
    this.process = null;
    this.state = 'stopped';
    if (!activeProcess) {
      return;
    }

    try {
      activeProcess.kill();
    } catch {
      // Best-effort cleanup for a PTY that failed after spawn but before ownership was established.
    }
  }

  snapshot(): ManagedProcessSnapshot {
    const snapshot: ManagedProcessSnapshot = {
      id: this.options.id,
      type: this.options.type,
      sessionId: this.options.sessionId,
      workingDirectory: this.options.workingDirectory,
      executable: this.options.executable,
      args: this.options.args,
      startedAt: this.startedAt,
      state: this.state,
      restartGeneration: this.restartGeneration,
    };

    if (this.process?.pid !== undefined) {
      snapshot.pid = this.process.pid;
    }

    if (this.lastOutputAt !== undefined) {
      snapshot.lastOutputAt = this.lastOutputAt;
    }

    if (this.exitCode !== undefined) {
      snapshot.exitCode = this.exitCode;
    }

    if (this.signal !== undefined) {
      snapshot.signal = this.signal;
    }

    return snapshot;
  }

  private emitState(): void {
    try {
      this.options.onState(this.options.sessionId, this.snapshot());
    } catch (error) {
      this.options.logger.error('PTY state observer failed', {
        sessionId: this.options.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private emitData(data: string): void {
    try {
      this.options.onData(this.options.sessionId, data);
    } catch (error) {
      this.options.logger.error('PTY output observer failed', {
        sessionId: this.options.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private emitExit(exitCode: number | null, signal: string | null): void {
    try {
      this.options.onExit(this.options.sessionId, exitCode, signal);
    } catch (error) {
      this.options.logger.error('PTY exit observer failed', {
        sessionId: this.options.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
