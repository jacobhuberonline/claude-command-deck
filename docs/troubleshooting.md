# Troubleshooting

## Blank Renderer

Run `npm run build` first. The Electron entrypoint expects built files under `out/`. During development, use `npm run dev`.

## Electron Uninstall Error On Windows

If `npm run dev` prints `Error: Electron uninstall`, the Electron package installed but its downloaded Windows executable is missing. Run `node node_modules\electron\install.js`, then run `npm run dev` again. If that still fails, run `rmdir /s /q node_modules`, `npm cache verify`, and `npm ci`.

## PTY Fails To Start

Run `npm install` again so the `postinstall` guard can repair the `node-pty` helper permissions. On Windows, verify PowerShell 7 (`pwsh.exe`) is installed or let the app fall back to Windows PowerShell.

## Claude Is Missing

The app discovers the configured Claude executable at runtime. If diagnostics report it missing, install Claude Code or set the executable name/path in Settings. Reload & Continue only uses continuation flags that the local CLI reports in `--help`.

## Credential Monitor Reports A Failure

The monitor reports only its configured provider check and does not directly inspect running Claude sessions, so a session may remain usable when an AWS or custom check fails. For the AWS preset, confirm that `aws sts get-caller-identity --output json` succeeds in a normal terminal. Configure a login command before using the interactive credential console.

## Sounds Do Not Play

Open Settings, Audio and check master mute, Do Not Disturb, quiet hours, per-session audio toggles, and focused-session suppression. Regenerate assets with `npm run generate:sounds` if diagnostics report missing sound files.

## Notifications Do Not Appear

Native notifications are optional and require renderer notification support plus granted OS/browser permission. The app never uses notification clicks to type into terminals, approve prompts, restart processes, or run commands.

## Windows Build

`npm run package:win` attempts a Windows development directory build. Cross-building may be limited on non-Windows hosts by native modules, host tooling, or downloaded Electron Builder components.
