import { useCallback, useEffect, useRef, useState } from 'react';
import { Clipboard, ClipboardPaste, Eraser, Search, X } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { SessionSnapshot } from '../../../shared/domain/types';
import type { TerminalBridge } from '../../../shared/ipc/contracts';

interface TerminalPaneProps {
  session: SessionSnapshot;
  terminalBridge: TerminalBridge;
}

const isTestRuntime = import.meta.env.MODE === 'test';

export function TerminalPane({ session, terminalBridge }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const initialStatusMessageRef = useRef(session.runtime.statusMessage);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const pasteClipboard = useCallback(() => {
    void navigator.clipboard
      ?.readText()
      .then((text) => {
        if (text) {
          return terminalBridge.write({ sessionId: session.configuration.id, data: text });
        }

        return undefined;
      })
      .catch(() => undefined);
  }, [session.configuration.id, terminalBridge]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    if (isTestRuntime) {
      return undefined;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: session.configuration.scrollback,
      theme: {
        background: '#06080b',
        foreground: '#d8e5ea',
        cursor: '#69c9d8',
        selectionBackground: '#244a57',
        black: '#111820',
        red: '#ed8181',
        green: '#79d29b',
        yellow: '#e6bf73',
        blue: '#8aa7ff',
        magenta: '#c99aff',
        cyan: '#69c9d8',
        white: '#e5edf2',
        brightBlack: '#5d7182',
        brightRed: '#ff9b9b',
        brightGreen: '#9de5b8',
        brightYellow: '#f0d493',
        brightBlue: '#adc0ff',
        brightMagenta: '#d8b7ff',
        brightCyan: '#91deea',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(container);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    terminal.writeln('\x1b[36mLOCAL SYSTEM\x1b[0m');
    terminal.writeln(initialStatusMessageRef.current);
    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === 'keydown' &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'v'
      ) {
        pasteClipboard();
        return false;
      }

      return true;
    });

    const dataDisposable = terminal.onData((data) => {
      void terminalBridge.write({ sessionId: session.configuration.id, data });
    });

    const offOutput = terminalBridge.onOutput((event) => {
      if (event.sessionId === session.configuration.id) {
        terminal.write(event.data);
      }
    });

    const offExit = terminalBridge.onExit((event) => {
      if (event.sessionId === session.configuration.id) {
        terminal.writeln('');
        terminal.writeln(
          `\x1b[33mLOCAL SYSTEM\x1b[0m Process exited with code ${event.exitCode ?? 'unknown'}.`,
        );
      }
    });

    const resize = () => {
      try {
        fitAddon.fit();
        void terminalBridge.resize({
          sessionId: session.configuration.id,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      } catch {
        // xterm fit can fail while an element is hidden during layout transitions.
      }
    };

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            window.requestAnimationFrame(resize);
          });
    resizeObserver?.observe(container);
    window.requestAnimationFrame(resize);

    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain');
      if (text) {
        event.preventDefault();
        void terminalBridge.write({ sessionId: session.configuration.id, data: text });
      }
    };
    container.addEventListener('paste', onPaste);

    return () => {
      container.removeEventListener('paste', onPaste);
      resizeObserver?.disconnect();
      offOutput();
      offExit();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [pasteClipboard, session.configuration.id, session.configuration.scrollback, terminalBridge]);

  const copySelection = () => {
    const selection = terminalRef.current?.getSelection();
    if (selection) {
      void navigator.clipboard?.writeText(selection);
    }
  };

  const clearDisplay = () => {
    terminalRef.current?.clear();
  };

  const runSearch = (value: string) => {
    setSearchTerm(value);
    if (value) {
      searchAddonRef.current?.findNext(value);
    }
  };

  return (
    <div
      className="terminal-frame"
      role="region"
      aria-label={`${session.configuration.name} terminal`}
    >
      <div className="terminal-toolbar">
        <span>PTY display</span>
        <div className="terminal-toolbar-actions">
          {searchOpen ? (
            <label className="terminal-search">
              <span>Search</span>
              <input value={searchTerm} onChange={(event) => runSearch(event.target.value)} />
            </label>
          ) : null}
          <button
            className="terminal-tool"
            type="button"
            title="Search terminal"
            aria-label="Search terminal"
            onClick={() => setSearchOpen((current) => !current)}
          >
            {searchOpen ? (
              <X size={14} aria-hidden="true" />
            ) : (
              <Search size={14} aria-hidden="true" />
            )}
          </button>
          <button
            className="terminal-tool"
            type="button"
            title="Copy selected output"
            aria-label="Copy selected output"
            onClick={copySelection}
          >
            <Clipboard size={14} aria-hidden="true" />
          </button>
          <button
            className="terminal-tool"
            type="button"
            title="Paste clipboard"
            aria-label="Paste clipboard"
            onClick={pasteClipboard}
          >
            <ClipboardPaste size={14} aria-hidden="true" />
          </button>
          <button
            className="terminal-tool"
            type="button"
            title="Clear terminal display"
            aria-label="Clear terminal display"
            onClick={clearDisplay}
          >
            <Eraser size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div ref={containerRef} className="terminal-host">
        {isTestRuntime ? (
          <span className="terminal-test-adapter">Terminal test adapter</span>
        ) : null}
      </div>
    </div>
  );
}
