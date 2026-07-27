# Claude Command Deck MVP

## Product Scope

Claude Command Deck is a local Windows-first desktop app for supervising many real Claude Code sessions from one command-deck window. It is not a hosted service, remote-control tool, autonomous coding platform, or replacement for the Claude CLI.

## Core Workflows

- Configure up to 32 saved session profiles with names, working directories, commands, models, and audio preferences.
- Find sessions by name or path and keep one large interactive shell or Claude Code PTY in focus.
- See truthful process state, conservative activity state, and same-project ambiguity at a glance.
- Reload one session or all sessions so startup-loaded Claude configuration can be reread.
- Name fresh Claude conversations and resume the exact name when the installed CLI exposes supported flags.
- Run a safe authentication check and use a dedicated interactive credential-refresh console.
- Receive subtle, configurable sound and native notification cues without repeated noise.

## Acceptance Criteria

- Secure Electron shell launches without a blank renderer.
- A searchable session navigator and primary terminal render across desktop widths.
- PTY input, ANSI output, scrollback, resize, copy, paste, process exit, and cleanup work.
- Shell discovery offers platform-appropriate choices, remembers the preference, and falls back safely only in Automatic mode.
- Claude command discovery reports executable, version, and continuation support honestly.
- Continue and Fresh Start preserve session configuration and report the actual launch strategy.
- Restart Active sequences only live Claude sessions and summarizes results.
- Authentication status never claims connected without a successful check.
- Credential refresh console is interactive and triggers a new check after successful exit.
- Settings persistence restores configured but stopped bays by default.
- Terminal input, full transcripts, raw authentication output, and secrets are not persisted or logged by default.
- Tests cover command building, state transitions, authentication, persistence, redaction, activity, audio decisions, and cleanup.

## Explicit Exclusions

- Remote access, team collaboration, telemetry, cloud sync, user accounts, automatic Git actions, worktree orchestration, Codex/Gemini integration, agent-to-agent delegation, plugin marketplace, full terminal recording, and automatic approval of Claude prompts.

## Current Release Constraints

- CI validates source, real PTY behavior, production builds, and an unpacked Windows package. Interactive Windows installer and terminal smoke testing remain release-checklist items.
- The Windows installer is not code-signed until a publisher certificate and protected CI signing configuration are supplied.
- Exact Claude continuation support depends on the locally installed Claude CLI and is discovered at runtime rather than assumed.
