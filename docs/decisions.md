# Implementation Decisions And Phase Notes

## Phase 0

- Created a new project folder because `/Users/cobmin/Code` is a multi-project directory, not an application root.
- Chose `electron-vite` to keep Electron main, preload, and renderer build targets explicit while preserving standard Vite behavior for React.
- Enabled TypeScript strict mode, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` to make IPC and state-machine code safer.
- Generated a visual reference mockup at `docs/design/command-deck-concept.png`; implementation should follow its restrained mission-control density without treating the image as a static asset.
- `vite@7.3.6` and `@vitejs/plugin-react@5.2.0` were selected because `electron-vite@5.0.0` rejects Vite 8. This avoids forcing an incompatible dependency tree.
- `typescript@6.0.3` was selected because `typescript-eslint@8.64.0` supports TypeScript versions below 6.1.
- Local Node is `v23.11.0`, an odd-numbered release. Some latest dev tools warn because their `engines` fields list LTS ranges (`20`, `22`) and future `>=24`. The install succeeded and validation commands determine practical compatibility in this workspace.

## Resolved Package Set

- Electron: `electron@43.1.1`, `electron-vite@5.0.0`, `electron-builder@26.15.3`, `@electron-toolkit/utils@4.0.0`
- Renderer: `react@19.2.7`, `react-dom@19.2.7`, `lucide-react@1.24.0`
- Terminal: `@xterm/xterm@6.0.0`, `@xterm/addon-fit@0.11.0`, `@xterm/addon-search@0.16.0`, `@xterm/addon-web-links@0.12.0`, `node-pty@1.1.0`
- Persistence and validation: `electron-store@11.0.2`, `zod@4.4.3`, `uuid@14.0.1`
- Build and test: `vite@7.3.6`, `@vitejs/plugin-react@5.2.0`, `typescript@6.0.3`, `vitest@4.1.10`, `@testing-library/react@16.3.2`, `@testing-library/jest-dom@6.9.1`, `jsdom@26.1.0`
- Quality tooling: `eslint@10.7.0`, `@eslint/js@10.0.1`, `typescript-eslint@8.64.0`, `eslint-plugin-react-hooks@7.1.1`, `eslint-plugin-react-refresh@0.5.3`, `prettier@3.9.5`

## Phase 1

- Implemented secure Electron defaults with `contextIsolation: true`, `nodeIntegration: false`, and a sandboxed renderer.
- Added a narrow preload bridge with typed `getAppState` and `openDirectory` operations only.
- Built the command bar, connection rail, four session bays, focus mode layout, settings drawer, and responsive single-column fallback.
- Kept terminal content explicitly labeled as local system placeholder text until Phase 2 replaces it with xterm.js and `node-pty`.
- Runtime validation launched Electron after manually completing the Electron binary download. The local renderer also passed browser checks at 1280x720 and 820x900.

## Phase 2

- Added a main-process `ProcessManager` and `PtyProcess` wrapper around `node-pty` with session-scoped start, write, resize, stop, output, exit, and state events.
- Added shell discovery that prefers `pwsh.exe` and then `powershell.exe` on Windows, with `pwsh`, `$SHELL`, `/bin/zsh`, and `/bin/bash` fallbacks for local validation outside Windows.
- Added renderer-side xterm.js panes with input forwarding, output rendering, resize propagation, search, copy-selection, clear-display, and paste forwarding.
- Terminal display lifecycle remains separate from PTY lifecycle; renderer reload can recover active process snapshots without spawning duplicate processes.
- Added safe lifecycle logging that avoids terminal input/output content.
- Local macOS validation found `node-pty`'s `spawn-helper` without execute permission. Added `scripts/ensure-node-pty-helper.mjs` as a postinstall guard and repaired the local helper before running the real PTY test.
- Validated the PTY path with a Vitest integration test that starts a real shell, writes a harmless marker command, receives output, and stops the process.

## Phase 3

- Added native directory selection through a session-scoped IPC method; the renderer still receives only the selected path, not general filesystem access.
- Added Claude CLI discovery using command resolution plus `--version`; this workspace does not currently have `claude` installed, so validation covers truthful missing-executable behavior.
- Added `startClaude` to the process manager so configured Claude commands launch as managed PTYs with the same lifecycle, resize, output, and cleanup behavior as shell sessions.
- Same-project badges are now recalculated from configured working directories rather than hardcoded sample state.
- Added tests for missing Claude discovery and refusing to start a Claude PTY when the executable cannot be resolved.

## Phase 4

- Added `ClaudeCommandBuilder` so launch arguments are constructed from discovered CLI capabilities instead of hardcoded assumptions.
- Claude discovery now inspects `--help` for supported `--continue` and `--resume` flags.
- Reload & Continue warns when same-directory continuation may be ambiguous and falls back honestly to a fresh launch when continuation is unsupported.
- Fresh Restart launches Claude without continuation flags.
- Reload All sequences configured sessions with a short delay instead of restarting everything at once.
- The current workspace does not have Claude installed, so runtime validation covers missing-executable behavior and command-builder tests cover continuation strategies.

## Phase 5

- Added Zod schemas for application settings, session configuration, authentication settings, audio preferences, quiet hours, and notifications.
- Added Electron Store persistence behind `SettingsStore`; invalid persisted settings are rejected and defaults are used.
- Directory selection updates safe session metadata in the store. Terminal transcripts, input history, raw authentication output, and environment data are not stored.
- Startup app state is now created from validated settings and restores configured bays as stopped by default.
- Added tests for settings schema validation and restore-on-launch defaulting to false.

## Phase 6

- Added AWS and custom authentication settings to persisted application state.
- Implemented safe background credential checks with command timeouts and non-overlap protection.
- Parsed AWS `sts get-caller-identity` JSON into safe metadata only.
- Added an interactive authentication console backed by a dedicated refresh PTY.
- Credential refresh rechecks authentication after a successful refresh process exit.

## Phase 7

- Added an isolated renderer activity classifier with a small rolling text window.
- Centralized conservative permission, awaiting-input, and authentication warning patterns.
- Completion is emitted only after sustained activity exceeds the configured minimum duration.
- The classifier clears local rolling state when a session exits and never sends terminal text to a remote service.

## Phase 8

- Generated original local WAV assets with `scripts/generate-sounds.ts`; runtime generation is not used.
- Added renderer audio and notification services that consume semantic events and apply master mute, Do Not Disturb, quiet hours, cooldowns, focus suppression, and per-session preferences.
- Added Settings controls for global audio, quiet hours, test sounds, notification preferences, and per-session audio toggles.
- Reload All now emits one aggregate success or warning event instead of one completion cue per bay.

## Phase 9

- Added sanitized diagnostics report generation, copy/report controls, rerun diagnostics, and log-directory opening through narrow IPC.
- Added `README.md`, `docs/audio-assets.md`, and `docs/troubleshooting.md`.
- Packaged build validation is host-dependent; this macOS workspace can build and smoke-test local output, while Windows directory packaging may be limited by cross-platform native module constraints.

## Multi-Session Command Deck

- Replaced the fixed 2x2 bay layout with a searchable navigator and one primary terminal, supporting up to 32 saved profiles with opaque IDs.
- Added session creation and removal through validated IPC, selected-session persistence, visible directory identity, status filters, and terminal-safe keyboard navigation.
- Retired the reserved Global Assistant. Every profile is an ordinary project session; a blank model adds no per-session override, while default launch arguments and Claude configuration still apply.
- Added stable Claude conversation names. Fresh sessions use `--name` when discovered, and later continuation uses exact `--resume <name>` instead of ambiguous directory-most-recent behavior.
- Kept recent terminal output in a bounded UTF-8-aware chunk replay so switching profiles restores context without persisting transcripts; clearing a terminal clears its replay too.
- Replaced the unused shell-executable display with a typed, persisted selector. Shell availability and executable resolution remain in the main process; explicit selections never silently fall back.
- Pinned jsdom to 26.1.0 so the Vitest DOM environment remains stable on the repository's supported Node baseline.

## Reliability And Release Hardening

- Text settings now commit on blur or Enter instead of writing on every keystroke. Renderer updates catch IPC failures and restore the last acknowledged value without overwriting a newer edit.
- Renderer process state retains the main-process UUID so late output, binding, and exit events from a replaced PTY are ignored.
- New installations start with one session and credential monitoring disabled. Choosing the AWS provider fills the safe identity-check preset when no custom check is present.
- Added Node-version pinning, coverage floors, cross-platform CI, a Windows unpacked-package check, and an NSIS installer target.
- Pinned app-builder-lib's hashing dependency to its CommonJS-compatible 1.8 release because the current CommonJS packager loads that module with `require`; remove the override after the packager adopts the dependency's ESM-only API.
