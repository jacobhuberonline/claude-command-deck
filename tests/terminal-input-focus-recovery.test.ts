import { vi } from 'vitest';
import { recoverTerminalFocusAfterFullscreenExit } from '../src/renderer/services/terminal/TerminalInputFocusRecovery';

describe('terminal input focus recovery', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('resets and restores terminal focus after a full-screen terminal exits', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.focus();

    let scheduledCallback: FrameRequestCallback | undefined;
    const scheduleFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduledCallback = callback;
      return 17;
    });
    const terminal = {
      textarea,
      blur: vi.fn(() => textarea.blur()),
      focus: vi.fn(() => textarea.focus()),
    };

    expect(recoverTerminalFocusAfterFullscreenExit(terminal, document, scheduleFrame)).toBe(17);
    expect(terminal.blur).toHaveBeenCalledOnce();
    expect(scheduleFrame).toHaveBeenCalledOnce();

    scheduledCallback?.(0);

    expect(terminal.focus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(textarea);
  });

  it('does nothing when the terminal does not own focus', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const textarea = document.createElement('textarea');
    const button = document.createElement('button');
    document.body.append(textarea, button);
    button.focus();
    const scheduleFrame = vi.fn();
    const terminal = {
      textarea,
      blur: vi.fn(),
      focus: vi.fn(),
    };

    expect(recoverTerminalFocusAfterFullscreenExit(terminal, document, scheduleFrame)).toBeNull();
    expect(terminal.blur).not.toHaveBeenCalled();
    expect(scheduleFrame).not.toHaveBeenCalled();
  });

  it('does not steal focus when another control is focused before recovery', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const textarea = document.createElement('textarea');
    const button = document.createElement('button');
    document.body.append(textarea, button);
    textarea.focus();

    let scheduledCallback: FrameRequestCallback | undefined;
    const terminal = {
      textarea,
      blur: vi.fn(() => textarea.blur()),
      focus: vi.fn(() => textarea.focus()),
    };

    recoverTerminalFocusAfterFullscreenExit(terminal, document, (callback) => {
      scheduledCallback = callback;
      return 18;
    });
    button.focus();
    scheduledCallback?.(0);

    expect(terminal.focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });

  it('does not refocus a background window', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.focus();
    const scheduleFrame = vi.fn();
    const terminal = {
      textarea,
      blur: vi.fn(),
      focus: vi.fn(),
    };

    expect(recoverTerminalFocusAfterFullscreenExit(terminal, document, scheduleFrame)).toBeNull();
    expect(terminal.blur).not.toHaveBeenCalled();
    expect(scheduleFrame).not.toHaveBeenCalled();
  });
});
