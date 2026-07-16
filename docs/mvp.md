# Claude Command Deck MVP

## Product Scope

Claude Command Deck is a local Windows-first desktop app for supervising up to four real Claude Code sessions from one command-deck window. It is not a hosted service, remote-control tool, autonomous coding platform, or replacement for the Claude CLI.

## Core Workflows

- Configure up to four session bays with names, working directories, commands, and audio preferences.
- Launch a real interactive PowerShell or Claude Code PTY in each bay.
- See truthful process state, conservative activity state, and same-project ambiguity at a glance.
- Reload one session or all sessions so startup-loaded Claude configuration can be reread.
- Continue the prior conversation only when the installed CLI exposes a supported strategy.
- Run a safe authentication check and use a dedicated interactive credential-refresh console.
- Receive subtle, configurable sound and native notification cues without repeated noise.

## Acceptance Criteria

- Secure Electron shell launches without a blank renderer.
- Four session bays render in a responsive 2x2 layout on desktop widths.
- PTY input, ANSI output, scrollback, resize, copy, paste, process exit, and cleanup work.
- Shell discovery prefers PowerShell 7 on Windows and falls back safely.
- Claude command discovery reports executable, version, and continuation support honestly.
- Reload & Continue and Fresh Restart preserve bay configuration and report the actual launch strategy.
- Reload All sequences eligible sessions and summarizes results.
- Authentication status never claims connected without a successful check.
- Credential refresh console is interactive and triggers a new check after successful exit.
- Settings persistence restores configured but stopped bays by default.
- Terminal input, full transcripts, raw authentication output, and secrets are not persisted or logged by default.
- Tests cover command building, state transitions, authentication, persistence, redaction, activity, audio decisions, and cleanup.

## Explicit Exclusions

- Remote access, team collaboration, telemetry, cloud sync, user accounts, automatic Git actions, worktree orchestration, more than four bays, Codex/Gemini integration, agent-to-agent delegation, plugin marketplace, full terminal recording, and automatic approval of Claude prompts.

## Known Phase 0 Limitations

- The first implementation will include macOS/Linux shell fallbacks only for local validation. Windows PowerShell discovery remains the production priority.
- Packaged Windows smoke testing may be limited by the current macOS workspace.
- Exact Claude continuation support depends on the locally installed Claude CLI and is discovered at runtime rather than assumed.
