# Release Checklist

## Automated

- Run `npm ci` with the Node version in `.nvmrc`.
- Run `npm run format`, `npm run lint`, `npm run typecheck`, and `npm run test:coverage`.
- Run `npm run build` and `npm audit --omit=dev --audit-level=high`.
- Confirm the Windows CI job completes `npm run package:win:dir`.

## Windows Smoke Test

- Install the NSIS artifact from `npm run package:win`.
- Confirm startup, window restore, navigation blocking, and external-link handling.
- Add two directories and verify search, keyboard switching, and removal confirmation.
- Start each available shell, send input, resize, copy, paste, stop, and restart.
- Start a fresh Claude conversation, continue its exact name, and open the resume picker.
- Switch sessions during output and confirm replay is bounded and not restored after an app restart.
- Enable the credential monitor, complete a login, cancel a login, and verify the follow-up check.
- Exercise sounds, quiet hours, native notifications, diagnostics copy, and log-directory opening.

## Distribution

- Update the package version and release notes.
- Add approved Windows and macOS application icons instead of shipping Electron's default icon.
- Configure a Windows publisher certificate in protected CI secrets.
- Sign the executable and installer, then verify the signature on a clean Windows machine.
- Archive the sanitized diagnostics report from the smoke test; never attach terminal or login output.
