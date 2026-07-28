export interface TerminalSelectionController {
  hasSelection: () => boolean;
  getSelection: () => string;
}

export type TerminalCopyShortcutAction = 'copy' | 'consume' | 'passthrough';

export function isMacTerminalPlatform(platform: string): boolean {
  return platform.toLowerCase().startsWith('mac');
}

export function resolveTerminalCopyShortcut(
  event: KeyboardEvent,
  isMacPlatform: boolean,
  hasSelection: boolean,
): TerminalCopyShortcutAction {
  const copyKey = event.key.toLowerCase() === 'c' || event.code === 'KeyC';
  if (event.type !== 'keydown' || !copyKey || event.altKey || event.getModifierState('AltGraph')) {
    return 'passthrough';
  }

  const terminalCopyShortcut = event.ctrlKey && event.shiftKey && !event.metaKey;
  const macCopyShortcut = isMacPlatform && event.metaKey && !event.ctrlKey && !event.shiftKey;
  if (terminalCopyShortcut || macCopyShortcut) {
    return hasSelection ? 'copy' : 'consume';
  }

  const selectionAwareControlCopy =
    !isMacPlatform && event.ctrlKey && !event.metaKey && !event.shiftKey;
  return selectionAwareControlCopy && hasSelection ? 'copy' : 'passthrough';
}

export function handleTerminalCopyShortcut(
  event: KeyboardEvent,
  isMacPlatform: boolean,
  terminal: TerminalSelectionController,
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
): boolean {
  const action = resolveTerminalCopyShortcut(event, isMacPlatform, terminal.hasSelection());
  if (action === 'passthrough') {
    return true;
  }

  event.preventDefault();
  event.stopPropagation();
  if (action === 'copy' && clipboard) {
    const write = clipboard.writeText(terminal.getSelection());
    void write.catch(() => undefined);
  }

  return false;
}
