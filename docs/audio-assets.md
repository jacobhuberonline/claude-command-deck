# Audio Assets

The MVP sound set is original project-generated audio. No operating-system, game, movie, commercial notification, or third-party sample assets are used.

## Generation

Run:

```bash
npm run generate:sounds
```

The script `scripts/generate-sounds.ts` deterministically synthesizes short mono 16-bit WAV files with simple sine tones and envelopes, then writes them to `public/sounds`. Runtime sound generation is not used; the renderer only plays committed local files.

## Files

- `session-ready.wav`
- `estimated-completion.wav`
- `attention.wav`
- `auth-connected.wav`
- `auth-disconnected.wav`
- `error.wav`
- `reload-all-complete.wav`
- `reload-all-warning.wav`

## License

These generated assets are project-owned and intended to be distributed under the same terms as this repository or internal project. There are no external attribution requirements.
