import { vi } from 'vitest';
import {
  handleTerminalCopyShortcut,
  isMacTerminalPlatform,
  resolveTerminalCopyShortcut,
  type TerminalSelectionController,
} from '../src/renderer/services/terminal/TerminalKeyboardShortcuts';

describe('terminal keyboard shortcuts', () => {
  it('copies a non-Mac Ctrl+C selection and consumes the terminal input', () => {
    const event = createKeyboardEvent({ ctrlKey: true });
    const terminal = createTerminalSelection('selected output');
    const clipboard = { writeText: vi.fn(() => Promise.resolve()) };

    expect(handleTerminalCopyShortcut(event, false, terminal, clipboard)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith('selected output');
  });

  it('passes non-Mac Ctrl+C through as an interrupt when nothing is selected', () => {
    const event = createKeyboardEvent({ ctrlKey: true });
    const terminal = createTerminalSelection();
    const clipboard = { writeText: vi.fn(() => Promise.resolve()) };

    expect(handleTerminalCopyShortcut(event, false, terminal, clipboard)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it('uses Command+C on Mac while preserving Mac Ctrl+C as an interrupt', () => {
    const terminal = createTerminalSelection('selected output');
    const clipboard = { writeText: vi.fn(() => Promise.resolve()) };
    const commandCopy = createKeyboardEvent({ metaKey: true });
    const controlInterrupt = createKeyboardEvent({ ctrlKey: true });

    expect(handleTerminalCopyShortcut(commandCopy, true, terminal, clipboard)).toBe(false);
    expect(clipboard.writeText).toHaveBeenCalledWith('selected output');
    expect(handleTerminalCopyShortcut(controlInterrupt, true, terminal, clipboard)).toBe(true);
  });

  it('consumes explicit copy shortcuts without a selection instead of sending an interrupt', () => {
    const terminal = createTerminalSelection();
    const clipboard = { writeText: vi.fn(() => Promise.resolve()) };

    expect(
      handleTerminalCopyShortcut(
        createKeyboardEvent({ ctrlKey: true, shiftKey: true }),
        false,
        terminal,
        clipboard,
      ),
    ).toBe(false);
    expect(
      handleTerminalCopyShortcut(createKeyboardEvent({ metaKey: true }), true, terminal, clipboard),
    ).toBe(false);
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it('supports localized C keys by physical code and ignores AltGraph chords', () => {
    const localizedCopy = createKeyboardEvent({
      key: 'ç',
      code: 'KeyC',
      ctrlKey: true,
      shiftKey: true,
    });
    const altGraphCopy = createKeyboardEvent({ ctrlKey: true, altKey: true });
    vi.spyOn(altGraphCopy, 'getModifierState').mockImplementation(
      (modifier) => modifier === 'AltGraph',
    );

    expect(resolveTerminalCopyShortcut(localizedCopy, false, true)).toBe('copy');
    expect(resolveTerminalCopyShortcut(altGraphCopy, false, true)).toBe('passthrough');
  });

  it('ignores matching keyup events to avoid duplicate clipboard writes', () => {
    const event = createKeyboardEvent({ ctrlKey: true }, 'keyup');
    const terminal = createTerminalSelection('selected output');
    const clipboard = { writeText: vi.fn(() => Promise.resolve()) };

    expect(handleTerminalCopyShortcut(event, false, terminal, clipboard)).toBe(true);
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it('keeps a rejected clipboard write consumed', async () => {
    const event = createKeyboardEvent({ ctrlKey: true });
    const terminal = createTerminalSelection('selected output');
    const clipboard = { writeText: vi.fn(() => Promise.reject(new Error('Clipboard denied'))) };

    expect(handleTerminalCopyShortcut(event, false, terminal, clipboard)).toBe(false);
    await Promise.resolve();
    expect(terminal.getSelection).toHaveBeenCalledOnce();
    expect(terminal.hasSelection()).toBe(true);
  });

  it('recognizes Mac platform identifiers', () => {
    expect(isMacTerminalPlatform('MacIntel')).toBe(true);
    expect(isMacTerminalPlatform('Win32')).toBe(false);
    expect(isMacTerminalPlatform('Linux x86_64')).toBe(false);
  });
});

function createKeyboardEvent(
  overrides: Partial<KeyboardEventInit> & Pick<KeyboardEventInit, 'ctrlKey' | 'metaKey'> = {},
  type = 'keydown',
): KeyboardEvent {
  return new KeyboardEvent(type, {
    key: 'c',
    code: 'KeyC',
    bubbles: true,
    cancelable: true,
    ...overrides,
  });
}

function createTerminalSelection(selection = ''): TerminalSelectionController {
  return {
    hasSelection: vi.fn(() => selection.length > 0),
    getSelection: vi.fn(() => selection),
  };
}
