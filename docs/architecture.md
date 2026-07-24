# Claude Command Deck Architecture

## Phase 0 Decisions

- Project root: `/Users/cobmin/Code/Claude-Command-Deck`. The parent directory contains unrelated projects, so this app is scoped to its own folder.
- Build stack: Electron, React, TypeScript strict mode, Vite via `electron-vite`, xterm.js, `node-pty`, Electron Store, Zod, ESLint, Prettier, Vitest, React Testing Library, and Electron Builder.
- Compatibility target: Windows-first desktop behavior with development fallbacks for macOS/Linux so the app can be validated in this workspace.
- Security default: the renderer has `contextIsolation: true`, `nodeIntegration: false`, no Electron remote usage, and communicates only through a narrow typed preload bridge.

## Process Boundaries

### Main Process

Owns desktop integration and trusted operations:

- window lifecycle and native notifications
- PTY process creation, resize, input, output, stop, and cleanup
- Claude executable discovery and launch strategy selection
- authentication checks and interactive credential refresh processes
- settings persistence and schema migrations
- diagnostics and safe logging
- IPC request validation

### Preload Process

Exposes a narrow `window.commandDeck` bridge. It does not expose Node.js primitives, raw filesystem access, or generic IPC passthrough. Session-scoped PTY start and input are intentionally command-capable because this is a local terminal application, so the bundled renderer is part of the trusted computing base. Main-frame navigation is restricted to the packaged app (or the configured development origin), and only HTTP(S) links may open externally.

### Renderer Process

Owns React UI, xterm.js terminal instances, focus awareness, activity presentation, settings forms, audio playback decisions, and keyboard navigation. Renderer services emit semantic events; they do not directly spawn commands.

## IPC Design

IPC contracts are defined in shared TypeScript types and Zod schemas. Main-process handlers validate every request and return typed responses. Terminal output is event-based and batched in the main process to avoid flooding the renderer during high-volume output.

## PTY Lifecycle

Each managed PTY has an internal UUID, process type, opaque session ID, working directory, executable, arguments, PID, lifecycle timestamps, exit metadata, and restart generation. Terminal display lifecycle is separate from PTY lifecycle so switching the selected profile does not create duplicate processes. The renderer keeps a bounded, non-persistent output replay per session so the primary xterm can reconstruct recent scrollback after a switch.

## Session State Model

Process state and activity state are separate:

- process state records actual lifecycle: empty, validating, starting, running, restarting, stopping, stopped, crashed, waiting for authentication, or error.
- activity state is heuristic: unknown, idle, active, likely awaiting input, possible permission prompt, or authentication may be required.

The UI uses uncertain language for heuristic states.

## Claude Discovery And Continuation

Claude discovery checks the effective executable that will actually be launched, captures safe version output, and inspects help text for supported continuation and session-naming options. `ClaudeCommandBuilder` selects the safest launch mode from `new`, `continueMostRecent`, `resumeSpecific`, or `custom`. The renderer sends launch intent and narrowly scoped consent only; the main process rebuilds the executable, arguments, model override, working directory, and fresh conversation name from persisted settings before starting a PTY.

Fresh conversations receive a unique `--name` when supported. Later continuation uses `--resume <name>` so parallel sessions can remain distinct even when they share a directory. The app refuses to degrade a known named conversation to directory-most-recent; legacy unnamed sessions require an explicit warning when directories overlap. Model selection is optional and per-session, with an empty value adding no override beyond the configured default launch arguments. One-shot main-process launch plans protect against stale UI state, changed profiles, and process-replacement races; they are integrity controls for the trusted local UI, not a sandbox against a compromised renderer.

## Credential Monitoring

Credential monitoring supports disabled, AWS preset, and custom command modes. It reports only the configured provider check and does not directly inspect running Claude sessions. Checks run with timeouts and do not overlap; configuration changes and login completion queue a fresh authoritative check instead of reusing an older result. AWS structured output parsing keeps only safe identity metadata. Login runs in a dedicated interactive PTY displayed in a credential console. Raw credential output is never persisted by default.

## Audio And Notifications

Renderer-side audio listens for semantic events and decides whether to play local sound assets based on global preferences, per-session preferences, focused session, application focus, cooldowns, Do Not Disturb, and quiet hours. Native notifications are optional and only focus UI when clicked.

## Persistence Boundaries

Electron Store persists non-secret metadata only: opaque session IDs, display names, Claude conversation names, model overrides, directories, preferred executable and arguments, launch preferences, selected session, navigator layout, authentication command configuration, audio preferences, quiet hours, and diagnostics preferences. It does not persist terminal transcripts, terminal input, raw authentication output, environment dumps, access keys, session tokens, device codes, cookies, or bearer tokens.

## Logging And Redaction

Logs capture lifecycle transitions, diagnostics, restart strategies, sanitized errors, and authentication check outcomes. Central redaction removes common secret patterns and avoids logging terminal content or raw authentication output.

## Package Versions

Resolved Phase 0 package versions are recorded in `docs/decisions.md`. Version selection favors maintained releases that work together across Electron, Vite, TypeScript strict mode, xterm.js, `node-pty`, Zod, Vitest, and Electron Builder. Vite is pinned to the latest compatible 7.x line because `electron-vite` 5 does not yet support Vite 8.
