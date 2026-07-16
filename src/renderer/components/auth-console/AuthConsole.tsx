import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { AuthBridge } from '../../../shared/ipc/contracts';

const isTestRuntime = import.meta.env.MODE === 'test';

interface AuthConsoleProps {
  open: boolean;
  authBridge: AuthBridge;
  onClose: () => void;
}

export function AuthConsole({ open, authBridge, onClose }: AuthConsoleProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!open || isTestRuntime || !hostRef.current) {
      return undefined;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontSize: 12,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      theme: {
        background: '#06080b',
        foreground: '#d8e5ea',
        cursor: '#69c9d8',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    terminal.writeln('\x1b[36mAUTHENTICATION CONSOLE\x1b[0m');
    terminalRef.current = terminal;

    const dataDisposable = terminal.onData((data) => {
      void authBridge.write({ data });
    });
    const offOutput = authBridge.onOutput((event) => terminal.write(event.data));
    const offExit = authBridge.onExit((event) => {
      terminal.writeln('');
      terminal.writeln(
        `\x1b[33mLOCAL SYSTEM\x1b[0m Refresh exited with code ${event.exitCode ?? 'unknown'}.`,
      );
    });
    const resize = () => {
      try {
        fitAddon.fit();
        void authBridge.resize({ cols: terminal.cols, rows: terminal.rows });
      } catch {
        // Ignore hidden-layout fit races.
      }
    };
    const resizeObserver = new ResizeObserver(() => window.requestAnimationFrame(resize));
    resizeObserver.observe(hostRef.current);
    window.requestAnimationFrame(resize);

    return () => {
      resizeObserver.disconnect();
      offOutput();
      offExit();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [authBridge, open]);

  if (!open) {
    return null;
  }

  return (
    <section className="auth-console" aria-label="Authentication console">
      <header className="auth-console-header">
        <strong>Authentication console</strong>
        <div>
          <button
            className="control-button"
            type="button"
            onClick={() => {
              void authBridge.startRefresh();
            }}
          >
            Start refresh
          </button>
          <button
            className="control-button"
            type="button"
            onClick={() => {
              void authBridge.stopRefresh();
            }}
          >
            Cancel
          </button>
          <button className="control-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </header>
      <div ref={hostRef} className="auth-console-terminal">
        {isTestRuntime ? 'Authentication console test adapter' : null}
      </div>
    </section>
  );
}
