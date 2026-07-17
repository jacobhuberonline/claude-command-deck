export interface TerminalOutputPreviewResult {
  preview: string;
  requiresConsole: boolean;
}

const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
const oscEscapePattern = new RegExp(
  `${String.fromCharCode(27)}\\][^${String.fromCharCode(7)}]*(?:${String.fromCharCode(7)}|${String.fromCharCode(27)}\\\\)`,
  'g',
);
const terminalUiPattern = new RegExp(
  [
    `${String.fromCharCode(27)}\\[[0-?;]*[ABCDEFGHJKSTf]`,
    `${String.fromCharCode(27)}\\[\\?(?:25|1049)[hl]`,
    `${String.fromCharCode(27)}c`,
  ].join('|'),
);

export function appendTerminalOutputPreview(
  existing: string,
  data: string,
  maxLength: number,
): TerminalOutputPreviewResult {
  const cleaned = stripTerminalControlSequences(data);
  const preview = trimPreview(applyTerminalText(existing, cleaned), maxLength);

  return {
    preview,
    requiresConsole: terminalUiPattern.test(data),
  };
}

function stripTerminalControlSequences(value: string) {
  return value.replace(oscEscapePattern, '').replace(ansiEscapePattern, '');
}

function applyTerminalText(existing: string, data: string) {
  const lines = existing ? existing.split('\n') : [''];
  let lineIndex = Math.max(0, lines.length - 1);
  let column = lines[lineIndex]?.length ?? 0;

  for (const char of data) {
    if (char === '\r') {
      column = 0;
      continue;
    }

    if (char === '\n') {
      lineIndex += 1;
      lines[lineIndex] = '';
      column = 0;
      continue;
    }

    if (char === '\b') {
      column = Math.max(0, column - 1);
      continue;
    }

    if (isUnsupportedControlCharacter(char)) {
      continue;
    }

    const line = lines[lineIndex] ?? '';
    lines[lineIndex] =
      column < line.length
        ? `${line.slice(0, column)}${char}${line.slice(column + 1)}`
        : `${line.padEnd(column, ' ')}${char}`;
    column += 1;
  }

  return lines.join('\n');
}

function isUnsupportedControlCharacter(char: string) {
  return char < ' ' && char !== '\t';
}

function trimPreview(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(-maxLength) : value;
}
