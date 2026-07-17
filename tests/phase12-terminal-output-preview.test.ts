import { appendTerminalOutputPreview } from '../src/renderer/services/terminal/TerminalOutputPreview';

describe('phase 12 terminal output preview parsing', () => {
  it('keeps styled log output previewable', () => {
    const result = appendTerminalOutputPreview('', '\u001b[32mReady\u001b[0m\n', 1000);

    expect(result).toEqual({
      preview: 'Ready\n',
      requiresConsole: false,
    });
  });

  it('applies carriage-return line updates to the preview', () => {
    const result = appendTerminalOutputPreview(
      '',
      'Loading 10%\rLoading 80%\rLoading done\n',
      1000,
    );

    expect(result.preview).toBe('Loading done\n');
    expect(result.requiresConsole).toBe(false);
  });

  it('flags cursor-controlled terminal UI for the console', () => {
    const result = appendTerminalOutputPreview(
      '',
      'Resume picker\n\u001b[2K\u001b[1A> Session one\n',
      1000,
    );

    expect(result.preview).toContain('Resume picker');
    expect(result.requiresConsole).toBe(true);
  });
});
