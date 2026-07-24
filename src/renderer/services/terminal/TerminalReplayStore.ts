import type { SessionId } from '../../../shared/domain/types';

export type TerminalReplayEvent = { type: 'data'; data: string } | { type: 'clear' };

interface ReplayChunk {
  data: string;
  bytes: number;
}

interface ReplayState {
  chunks: ReplayChunk[];
  bytes: number;
  truncated: boolean;
  listeners: Set<(event: TerminalReplayEvent) => void>;
}

const terminalReset = '\x1bc';

export class TerminalReplayStore {
  private readonly states = new Map<SessionId, ReplayState>();
  private readonly encoder = new TextEncoder();

  constructor(private readonly maximumBytes: number) {}

  append(sessionId: SessionId, data: string): void {
    if (!data) {
      return;
    }

    const state = this.getState(sessionId);
    let chunk = data;
    let bytes = this.encoder.encode(chunk).byteLength;
    if (bytes > this.maximumBytes) {
      chunk = this.tailWithinLimit(chunk);
      bytes = this.encoder.encode(chunk).byteLength;
      state.chunks = [];
      state.bytes = 0;
      state.truncated = true;
    }

    state.chunks.push({ data: chunk, bytes });
    state.bytes += bytes;
    while (state.bytes > this.maximumBytes && state.chunks.length > 1) {
      const removed = state.chunks.shift();
      state.bytes -= removed?.bytes ?? 0;
      state.truncated = true;
    }

    state.listeners.forEach((listener) => listener({ type: 'data', data }));
  }

  snapshot(sessionId: SessionId): string {
    const state = this.states.get(sessionId);
    if (!state || state.chunks.length === 0) {
      return '';
    }
    return `${state.truncated ? terminalReset : ''}${state.chunks
      .map((chunk) => chunk.data)
      .join('')}`;
  }

  clear(sessionId: SessionId): void {
    const state = this.states.get(sessionId);
    if (!state) {
      return;
    }
    state.chunks = [];
    state.bytes = 0;
    state.truncated = false;
    state.listeners.forEach((listener) => listener({ type: 'clear' }));
  }

  subscribe(sessionId: SessionId, listener: (event: TerminalReplayEvent) => void): () => void {
    const state = this.getState(sessionId);
    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
      if (state.listeners.size === 0 && state.chunks.length === 0) {
        this.states.delete(sessionId);
      }
    };
  }

  private getState(sessionId: SessionId): ReplayState {
    const existing = this.states.get(sessionId);
    if (existing) {
      return existing;
    }

    const state: ReplayState = {
      chunks: [],
      bytes: 0,
      truncated: false,
      listeners: new Set(),
    };
    this.states.set(sessionId, state);
    return state;
  }

  private tailWithinLimit(value: string): string {
    const codePoints = Array.from(value);
    const tail: string[] = [];
    let bytes = 0;
    for (let index = codePoints.length - 1; index >= 0; index -= 1) {
      const codePoint = codePoints[index];
      if (!codePoint) {
        continue;
      }
      const codePointBytes = this.encoder.encode(codePoint).byteLength;
      if (bytes + codePointBytes > this.maximumBytes) {
        break;
      }
      tail.push(codePoint);
      bytes += codePointBytes;
    }
    return tail.reverse().join('');
  }
}
