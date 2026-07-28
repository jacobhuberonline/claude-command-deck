import { useCallback, useEffect, useRef, useState } from 'react';
import { Clipboard, Eraser, Search, X } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { SessionSnapshot } from '../../../shared/domain/types';
import type { TerminalBridge } from '../../../shared/ipc/contracts';
import { recordTerminalSize } from '../../services/terminal/TerminalSizeRegistry';
import { recoverTerminalFocusAfterFullscreenExit } from '../../services/terminal/TerminalInputFocusRecovery';
import {
  handleTerminalCopyShortcut,
  isMacTerminalPlatform,
} from '../../services/terminal/TerminalKeyboardShortcuts';
import type { TerminalReplayStore } from '../../services/terminal/TerminalReplayStore';

interface TerminalPaneProps {
  session: SessionSnapshot;
  active?: boolean;
  focusRequest: number;
  terminalBridge: TerminalBridge;
  terminalReplayStore: TerminalReplayStore;
}

const isTestRuntime = import.meta.env.MODE === 'test';
const DEFAULT_TERMINAL_FONT_SIZE = 12;
const MIN_TERMINAL_FONT_SIZE = 9;
const MAX_TERMINAL_FONT_SIZE = 22;
const KEYBOARD_PASTE_SUPPRESSION_MS = 750;

function clampTerminalFontSize(value: number) {
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, value));
}

export function TerminalPane({
  session,
  active = false,
  focusRequest,
  terminalBridge,
  terminalReplayStore,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const initialStatusMessageRef = useRef(session.runtime.statusMessage);
  const resizeTerminalRef = useRef<() => void>(() => undefined);
  const fontSizeRef = useRef(DEFAULT_TERMINAL_FONT_SIZE);
  const lastWriteErrorRef = useRef<string | null>(null);
  const suppressNativePasteUntilRef = useRef(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const setTerminalFontSize = useCallback((nextFontSize: number) => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    const fontSize = clampTerminalFontSize(nextFontSize);
    fontSizeRef.current = fontSize;
    terminal.options.fontSize = fontSize;
    window.requestAnimationFrame(() => resizeTerminalRef.current());
  }, []);

  const zoomTerminal = useCallback(
    (delta: number) => {
      setTerminalFontSize(fontSizeRef.current + delta);
    },
    [setTerminalFontSize],
  );

  const resetTerminalZoom = useCallback(() => {
    setTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE);
  }, [setTerminalFontSize]);

  const focusTerminal = useCallback(() => {
    if (terminalRef.current) {
      terminalRef.current.focus();
      return;
    }

    if (isTestRuntime) {
      containerRef.current?.focus();
    }
  }, []);

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
      fontSize: fontSizeRef.current,
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
    let focusRecoveryFrame: number | null = null;
    const bufferDisposable = terminal.buffer.onBufferChange((buffer) => {
      if (focusRecoveryFrame !== null) {
        window.cancelAnimationFrame(focusRecoveryFrame);
        focusRecoveryFrame = null;
      }

      if (buffer.type === 'normal') {
        focusRecoveryFrame = recoverTerminalFocusAfterFullscreenExit(terminal);
      }
    });
    terminal.writeln('\x1b[36mLOCAL SYSTEM\x1b[0m');
    terminal.writeln(initialStatusMessageRef.current);
    const offReplay = terminalReplayStore.subscribe(session.configuration.id, (event) => {
      if (event.type === 'clear') {
        terminal.clear();
      } else {
        terminal.write(event.data);
      }
    });
    const replay = terminalReplayStore.snapshot(session.configuration.id);
    if (replay) {
      terminal.write(replay);
    }
    const isMacPlatform = isMacTerminalPlatform(navigator.platform);
    terminal.attachCustomKeyEventHandler((event) => {
      if (!handleTerminalCopyShortcut(event, isMacPlatform, terminal, navigator.clipboard)) {
        return false;
      }

      if (event.type !== 'keydown' || (!event.ctrlKey && !event.metaKey)) {
        return true;
      }

      const key = event.key.toLowerCase();
      if (key === 'v') {
        if (!navigator.clipboard?.readText) {
          return true;
        }

        event.preventDefault();
        event.stopPropagation();
        suppressNativePasteUntilRef.current = Date.now() + KEYBOARD_PASTE_SUPPRESSION_MS;
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (text) {
              terminal.paste(text);
            }
          })
          .catch(() => undefined);
        return false;
      }

      if (key === '+' || key === '=') {
        zoomTerminal(1);
        return false;
      }

      if (key === '-' || key === '_') {
        zoomTerminal(-1);
        return false;
      }

      if (key === '0') {
        resetTerminalZoom();
        return false;
      }

      return true;
    });

    const dataDisposable = terminal.onData((data) => {
      void terminalBridge
        .write({ sessionId: session.configuration.id, data })
        .then((result) => {
          if (!result.ok) {
            if (lastWriteErrorRef.current !== result.error) {
              lastWriteErrorRef.current = result.error;
              terminal.writeln('');
              terminal.writeln(`\x1b[31mLOCAL SYSTEM\x1b[0m ${result.error}`);
            }
            return;
          }

          lastWriteErrorRef.current = null;
        })
        .catch(() => undefined);
    });

    const resize = () => {
      try {
        fitAddon.fit();
        recordTerminalSize(session.configuration.id, terminal.cols, terminal.rows);
        void terminalBridge.resize({
          sessionId: session.configuration.id,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      } catch {
        // xterm fit can fail while an element is hidden during layout transitions.
      }
    };
    resizeTerminalRef.current = resize;

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            window.requestAnimationFrame(resize);
          });
    resizeObserver?.observe(container);
    window.requestAnimationFrame(resize);

    const onNativePaste = (event: ClipboardEvent) => {
      if (Date.now() > suppressNativePasteUntilRef.current) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };
    container.addEventListener('paste', onNativePaste, true);

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      zoomTerminal(event.deltaY < 0 ? 1 : -1);
    };
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('paste', onNativePaste, true);
      container.removeEventListener('wheel', onWheel);
      if (focusRecoveryFrame !== null) {
        window.cancelAnimationFrame(focusRecoveryFrame);
      }
      resizeObserver?.disconnect();
      bufferDisposable.dispose();
      offReplay();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
      resizeTerminalRef.current = () => undefined;
    };
  }, [
    resetTerminalZoom,
    session.configuration.id,
    session.configuration.scrollback,
    terminalBridge,
    terminalReplayStore,
    zoomTerminal,
  ]);

  useEffect(() => {
    if (session.runtime.processState !== 'starting' && session.runtime.processState !== 'running') {
      return undefined;
    }

    let retryTimer: number | undefined;
    const animationFrame = window.requestAnimationFrame(() => {
      resizeTerminalRef.current();
      if (active) {
        focusTerminal();
      }
      retryTimer = window.setTimeout(() => resizeTerminalRef.current(), 80);
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [active, focusTerminal, session.runtime.processState]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      resizeTerminalRef.current();
      focusTerminal();
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [active, focusRequest, focusTerminal]);

  const copySelection = () => {
    const selection = terminalRef.current?.getSelection();
    if (selection) {
      void navigator.clipboard?.writeText(selection);
    }
  };

  const clearDisplay = () => {
    terminalReplayStore.clear(session.configuration.id);
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
        <span>Terminal</span>
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
            title="Clear terminal display"
            aria-label="Clear terminal display"
            onClick={clearDisplay}
          >
            <Eraser size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div ref={containerRef} className="terminal-host" tabIndex={isTestRuntime ? -1 : undefined}>
        {isTestRuntime ? (
          <span className="terminal-test-adapter">Terminal test adapter</span>
        ) : null}
      </div>
    </div>
  );
}
