# Claude Command Deck

Local Electron desktop app for supervising four Claude Code session bays with real PTYs, reload workflows, authentication checks, conservative activity labels, configurable sounds, and a low-model Global Assistant bay for generic questions.

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

The app is Windows-first but includes macOS/Linux fallbacks for local validation. Claude continuation support is discovered from the installed CLI; the app does not invent unsupported flags. Authentication checks never report connected unless a local check command succeeds.

Session 1 defaults to Global Assistant, uses the Claude Code `haiku` model alias through `--model`, and can be focused with `Alt+1` or the command-bar Global Assistant button. Its working directory is still chosen by the user through the normal directory picker.
