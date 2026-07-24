# Claude Command Deck

Local Electron desktop app for supervising many Claude Code sessions across different directories. It combines a searchable session navigator with one large real PTY, exact named-session resume when the installed CLI supports it, authentication checks, conservative activity labels, and configurable notifications.

## Session Workflow

- Add a directory with the **Session** button or `Alt+N`.
- Jump to the first nine saved sessions with `Alt+1` through `Alt+9`.
- Cycle sessions with `Ctrl+PageUp` and `Ctrl+PageDown`.
- Focus session search with `Ctrl+Shift+P`.
- Start a fresh named Claude conversation, continue that exact conversation later, open the native resume picker, or use a normal shell.
- Add an optional per-session Haiku, Sonnet, Opus, or custom model override; blank sessions keep the configured default launch arguments.

## Commands

- `npm run dev` starts the Electron development app.
- `npm run build` type-checks and builds main, preload, and renderer output.
- `npm run test` runs Vitest.
- `npm run lint` runs ESLint.
- `npm run format` checks Prettier formatting.
- `npm run package:dir` creates a local unpacked development build.
- `npm run package:win` attempts a Windows directory build when the host environment permits.
- `npm run generate:sounds` regenerates the original local WAV assets in `public/sounds`.

## Security Boundaries

The renderer runs with `contextIsolation`, sandboxing, and no Node integration. Desktop actions are exposed only through typed preload methods with Zod validation in the main process. Terminal transcripts, terminal input, raw authentication output, environment dumps, and secrets are not persisted by default.

## MVP Notes

The app is Windows-first but includes macOS/Linux fallbacks for local validation. Claude continuation and naming support are discovered from the selected executable; the same executable is then launched. Authentication checks never report connected unless a local check command succeeds.

Up to 32 saved session profiles are supported. Terminal output is bounded and buffered only in renderer memory so switching sessions can reconstruct recent scrollback without persisting transcripts.
