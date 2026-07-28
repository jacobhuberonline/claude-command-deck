export interface TerminalFocusController {
  readonly textarea: HTMLTextAreaElement | undefined;
  blur: () => void;
  focus: () => void;
}

type ScheduleFrame = (callback: FrameRequestCallback) => number;

export function recoverTerminalFocusAfterFullscreenExit(
  terminal: TerminalFocusController,
  documentRef: Document = document,
  scheduleFrame: ScheduleFrame = (callback) => window.requestAnimationFrame(callback),
): number | null {
  const textarea = terminal.textarea;
  if (!textarea || documentRef.activeElement !== textarea || !documentRef.hasFocus()) {
    return null;
  }

  // Full-screen terminal apps can leave Chromium's hidden textarea in a stale
  // input/composition state. Reset only when the terminal already owns focus.
  terminal.blur();
  return scheduleFrame(() => {
    if (
      documentRef.hasFocus() &&
      (documentRef.activeElement === documentRef.body || documentRef.activeElement === textarea)
    ) {
      terminal.focus();
    }
  });
}
