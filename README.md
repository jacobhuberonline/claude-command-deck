# Claude Command Deck

Local Electron desktop app for supervising many Claude Code sessions across different directories. It combines a searchable session navigator with one large real PTY, exact named-session resume when the installed CLI supports it, authentication checks, conservative activity labels, and configurable notifications.

## Install

Trusted Windows signing is currently deferred. The
[GitHub Releases page](https://github.com/jacobhuberonline/claude-command-deck/releases) records
source-only preview versions; no Windows installer is attached to a release while signing is
unavailable.

Windows x64 test installers are shared with selected testers as short-lived GitHub Actions
artifacts. Every artifact ends in `-UNSIGNED` and includes a SHA-256 checksum plus an explicit
warning. Windows will identify these builds as coming from an unknown publisher. Install one only
when a maintainer has shared the exact Actions run and disclosed that warning. Because this
repository is public, a shared link is not an access-control boundary.

Claude Code must already be installed. Complete any required authentication through Claude Code or
the configured credential flow. The optional credential monitor may require a separately installed
provider CLI. Command Deck discovers and launches those existing tools; it does not bundle
credentials or provider configuration.

## Session Workflow

- Add a directory with the **Session** button or `Alt+N`.
- Drag navigator handles to arrange sessions, or focus a handle and use `Arrow Up`/`Arrow Down`; the order is saved.
- Jump to the first nine saved sessions with `Alt+1` through `Alt+9`.
- Cycle sessions with `Ctrl+PageUp` and `Ctrl+PageDown`.
- Focus session search with `Ctrl+Shift+P`.
- Start a fresh named Claude conversation, continue that exact conversation later, open the native resume picker, or choose a detected shell for a normal terminal session.
- Add an optional per-session Haiku, Sonnet, Opus, or custom model override; blank sessions keep the configured default launch arguments.
- Tune the completion quiet period, focus suppression, and per-session cues in **Settings → Audio**; waiting and permission cues remain audible while watched.

## Commands

- `npm run dev` starts the Electron development app.
- `npm run build` type-checks and builds main, preload, and renderer output.
- `npm run test` runs Vitest.
- `npm run test:coverage` runs Vitest with enforced baseline coverage.
- `npm run lint` runs ESLint.
- `npm run format` checks Prettier formatting.
- `npm run package:dir` creates a local unpacked development build.
- `npm run package:win` creates a Windows NSIS installer when the host environment permits.
- `npm run package:win:dir` creates an unpacked Windows build for smoke testing.
- `npm run generate:sounds` regenerates the original local WAV assets in `public/sounds`.

## Security Boundaries

The renderer runs with `contextIsolation`, sandboxing, and no Node integration. Desktop actions are exposed only through typed preload methods with Zod validation in the main process. Terminal transcripts, terminal input, raw authentication output, environment dumps, and secrets are not persisted by default.

## MVP Notes

The app is Windows-first but includes macOS/Linux fallbacks for local validation. Claude continuation and naming support are discovered from the selected executable; the same executable is then launched. New installations begin with one empty session and the optional credential monitor disabled. When enabled, the monitor reports only its configured AWS or custom check; it does not directly inspect running Claude sessions.

Up to 32 saved session profiles are supported. Terminal output is bounded and buffered only in renderer memory so switching sessions can reconstruct recent scrollback without persisting transcripts.
