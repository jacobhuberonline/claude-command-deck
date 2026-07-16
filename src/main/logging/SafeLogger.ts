import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { redactSecretText } from './redaction';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class SafeLogger {
  private readonly logFile: string;

  constructor(private readonly logDirectory = join(app.getPath('userData'), 'logs')) {
    mkdirSync(logDirectory, { recursive: true });
    this.logFile = join(logDirectory, 'claude-command-deck.log');
  }

  getLogDirectory(): string {
    return this.logDirectory;
  }

  debug(message: string, metadata: Record<string, unknown> = {}): void {
    this.write('debug', message, metadata);
  }

  info(message: string, metadata: Record<string, unknown> = {}): void {
    this.write('info', message, metadata);
  }

  warn(message: string, metadata: Record<string, unknown> = {}): void {
    this.write('warn', message, metadata);
  }

  error(message: string, metadata: Record<string, unknown> = {}): void {
    this.write('error', message, metadata);
  }

  private write(level: LogLevel, message: string, metadata: Record<string, unknown>): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message: redactSecretText(message),
      metadata: sanitizeMetadata(metadata),
    };

    appendFileSync(this.logFile, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, redactSecretText(value)];
      }

      return [key, value];
    }),
  );
}
