import type { SessionId } from '../../../shared/domain/types';

interface TerminalSize {
  cols: number;
  rows: number;
}

const fallbackSize: TerminalSize = { cols: 80, rows: 16 };
const sizes = new Map<SessionId, TerminalSize>();

export function recordTerminalSize(sessionId: SessionId, cols: number, rows: number): void {
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 2) {
    return;
  }

  sizes.set(sessionId, {
    cols: Math.floor(cols),
    rows: Math.floor(rows),
  });
}

export function getTerminalSize(sessionId: SessionId): TerminalSize {
  return sizes.get(sessionId) ?? fallbackSize;
}
