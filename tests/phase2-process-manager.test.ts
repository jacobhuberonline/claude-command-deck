import type { ManagedProcessSnapshot, SessionId } from '../src/shared/domain/types';
import { ProcessManager } from '../src/main/processes/ProcessManager';
import type { SafeLogger } from '../src/main/logging/SafeLogger';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as SafeLogger;

describe('phase 2 process manager PTY integration', () => {
  it('starts a real shell PTY, receives output, and stops cleanly', async () => {
    const sessionId: SessionId = 'session-2';
    let output = '';
    const states: ManagedProcessSnapshot[] = [];
    const manager = new ProcessManager(logger, {
      onOutput: (_sessionId, data) => {
        output += data;
      },
      onExit: vi.fn(),
      onState: (_sessionId, snapshot) => {
        states.push(snapshot);
      },
    });

    const startResult = manager.startShell({
      sessionId,
      workingDirectory: process.cwd(),
      cols: 80,
      rows: 24,
    });

    expect(startResult).toEqual({ ok: true });

    const marker = 'CCD_PTY_OK';
    const command =
      process.platform === 'win32' ? `Write-Output ${marker}\r` : `printf "${marker}\\n"\r`;
    const writeResult = manager.write(sessionId, command);
    expect(writeResult).toEqual({ ok: true });

    await waitFor(() => output.includes(marker));

    const stopResult = manager.stop(sessionId);
    expect(stopResult).toEqual({ ok: true });
    manager.stopAll();
    expect(states.some((state) => state.state === 'running')).toBe(true);
  }, 10000);
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error('Timed out waiting for PTY output marker.');
}
