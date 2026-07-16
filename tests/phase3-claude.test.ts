import { discoverClaude } from '../src/main/claude/ClaudeDiscovery';
import type { SafeLogger } from '../src/main/logging/SafeLogger';
import { ProcessManager } from '../src/main/processes/ProcessManager';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as SafeLogger;

describe('phase 3 Claude discovery and launch', () => {
  it('reports a missing Claude executable truthfully', () => {
    const result = discoverClaude('definitely-not-claude-command-deck-test');

    expect(result.found).toBe(false);
    expect(result.resolvedPath).toBeNull();
    expect(result.error).toContain('was not found');
  });

  it('does not start a Claude PTY when the executable cannot be resolved', () => {
    const manager = new ProcessManager(logger, {
      onOutput: vi.fn(),
      onExit: vi.fn(),
      onState: vi.fn(),
    });

    const result = manager.startClaude({
      sessionId: 'session-2',
      workingDirectory: process.cwd(),
      executable: 'definitely-not-claude-command-deck-test',
      args: [],
      cols: 80,
      rows: 24,
    });

    expect(result).toEqual({
      ok: false,
      error: 'Claude executable "definitely-not-claude-command-deck-test" was not found.',
    });
    expect(manager.snapshots()).toHaveLength(0);
  });
});
