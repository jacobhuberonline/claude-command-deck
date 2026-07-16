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

    this.state = 'running';
    this.options.logger.info('PTY started', {
      sessionId: this.options.sessionId,
      type: this.options.type,
      pid: this.process.pid,
      executable: this.options.executable,
      workingDirectory: this.options.workingDirectory,
    });
    this.emitState();

    this.process.onData((data) => {
      this.lastOutputAt = new Date().toISOString();
      this.options.onData(this.options.sessionId, data);
    });

    this.process.onExit((event) => {
      this.exitCode = event.exitCode;
      this.signal = event.signal === undefined ? null : String(event.signal);
      this.state = event.exitCode === 0 ? 'stopped' : 'crashed';
      this.options.logger.info('PTY exited', {
        sessionId: this.options.sessionId,
        pid: this.process?.pid,
        exitCode: this.exitCode,
        signal: this.signal,
      });
      this.options.onExit(this.options.sessionId, this.exitCode, this.signal);
      this.emitState();
      this.process = null;
    });
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

  stop(): void {
    if (!this.process) {
      return;
    }

    this.state = 'stopping';
    this.emitState();
    this.options.logger.info('PTY stop requested', {
      sessionId: this.options.sessionId,
      pid: this.process.pid,
    });
    this.process.kill();
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
    this.options.onState(this.options.sessionId, this.snapshot());
  }
}
