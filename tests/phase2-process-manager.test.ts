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
  it('cleans up a spawned PTY when post-spawn setup throws', () => {
    const failingLogger = {
      debug: vi.fn(),
      info: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('log write failed');
        })
        .mockImplementation(() => undefined),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as SafeLogger;
    const manager = new ProcessManager(failingLogger, {
      onOutput: vi.fn(),
      onExit: vi.fn(),
      onState: vi.fn(),
    });

    const result = manager.startShell({
      sessionId: 'session-post-spawn-failure',
      workingDirectory: process.cwd(),
      cols: 80,
      rows: 24,
    });

    expect(result).toEqual({ ok: false, error: 'log write failed' });
    expect(manager.snapshots()).toHaveLength(0);
  });

  it('finishes stop and exit cleanup when output and state observers throw', async () => {
    const sessionId: SessionId = 'session-observer-failure';
    let outputObserved = false;
    let exitObserved = false;
    const manager = new ProcessManager(logger, {
      onOutput: () => {
        outputObserved = true;
        throw new Error('renderer output observer failed');
      },
      onExit: () => {
        exitObserved = true;
        throw new Error('renderer exit observer failed');
      },
      onState: (_activeSessionId, snapshot) => {
        if (snapshot.state === 'stopping' || snapshot.state === 'stopped') {
          throw new Error('renderer state observer failed');
        }
      },
    });

    expect(
      manager.startShell({
        sessionId,
        workingDirectory: process.cwd(),
        cols: 80,
        rows: 24,
      }),
    ).toEqual({ ok: true });
    const command =
      process.platform === 'win32'
        ? 'Write-Output CCD_OBSERVER_OK\r'
        : 'printf "CCD_OBSERVER_OK\\n"\r';
    expect(manager.write(sessionId, command)).toEqual({ ok: true });
    await waitFor(() => outputObserved);

    expect(manager.stop(sessionId)).toEqual({ ok: true });
    await waitFor(() => exitObserved && manager.snapshots().length === 0);
    expect(manager.hasActiveProcess(sessionId)).toBe(false);
  }, 10000);

  it('rejects a duplicate start and emits the stopped state before exit', async () => {
    const sessionId: SessionId = 'session-2';
    let output = '';
    let exited = false;
    const events: string[] = [];
    const states: ManagedProcessSnapshot[] = [];
    const manager = new ProcessManager(logger, {
      onOutput: (_sessionId, _processId, data) => {
        output += data;
      },
      onExit: () => {
        events.push('exit');
        exited = true;
      },
      onState: (_sessionId, snapshot) => {
        states.push(snapshot);
        events.push(`state:${snapshot.state}`);
      },
    });

    const startRequest = {
      sessionId,
      workingDirectory: process.cwd(),
      cols: 80,
      rows: 24,
    };
    expect(manager.processEpoch(sessionId)).toBe(0);
    const startResult = manager.startShell(startRequest);

    expect(startResult).toEqual({ ok: true });
    expect(manager.processEpoch(sessionId)).toBe(1);
    expect(manager.startShell(startRequest)).toEqual({
      ok: false,
      error: 'A process is already active for this session bay.',
    });
    expect(manager.snapshots()).toHaveLength(1);

    const marker = 'CCD_PTY_OK';
    const command =
      process.platform === 'win32' ? `Write-Output ${marker}\r` : `printf "${marker}\\n"\r`;
    const writeResult = manager.write(sessionId, command);
    expect(writeResult).toEqual({ ok: true });

    await waitFor(() => output.includes(marker));

    const stopResult = manager.stop(sessionId);
    expect(stopResult).toEqual({ ok: true });
    await waitFor(() => exited);

    manager.stopAll();
    expect(states.some((state) => state.state === 'running')).toBe(true);
    const stoppedStateIndex = events.lastIndexOf('state:stopped');
    const exitIndex = events.lastIndexOf('exit');
    expect(stoppedStateIndex).toBeGreaterThanOrEqual(0);
    expect(exitIndex).toBeGreaterThan(stoppedStateIndex);
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

  throw new Error('Timed out waiting for PTY state.');
}
