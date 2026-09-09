import { normalizeWindowState } from '../src/main/windows/WindowState';

describe('phase 11 window state persistence', () => {
  it('restores valid visible bounds and window flags', () => {
    const state = normalizeWindowState(
      {
        bounds: { x: 120, y: 90, width: 1280, height: 860 },
        isMaximized: true,
        isFullScreen: false,
        isMinimized: true,
      },
      [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
    );

    expect(state).toEqual({
      bounds: { x: 120, y: 90, width: 1280, height: 860 },
      isMaximized: true,
      isFullScreen: false,
      isMinimized: true,
    });
  });

  it('falls back when saved bounds are off screen', () => {
    const state = normalizeWindowState(
      {
        bounds: { x: 4000, y: 4000, width: 1200, height: 800 },
      },
      [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
    );

    expect(state.bounds).toEqual({ x: 80, y: 60, width: 1440, height: 980 });
  });

  it('enforces minimum restored size', () => {
    const state = normalizeWindowState(
      {
        bounds: { x: 12.4, y: 20.6, width: 500, height: 400 },
      },
      [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
    );

    expect(state.bounds).toEqual({ x: 12, y: 21, width: 1040, height: 720 });
  });

  it('keeps the window above the Dock and below the menu bar on a small display', () => {
    const state = normalizeWindowState(undefined, [
      {
        bounds: { x: 0, y: 0, width: 1280, height: 800 },
        workArea: { x: 0, y: 25, width: 1280, height: 680 },
      },
    ]);
    expect(state.bounds).toEqual({ x: 0, y: 25, width: 1280, height: 680 });
  });

  it('clamps a partially visible window to its secondary display work area', () => {
    const state = normalizeWindowState(
      {
        bounds: { x: -1500, y: -50, width: 1200, height: 900 },
      },
      [
        { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        {
          bounds: { x: -1440, y: 0, width: 1440, height: 900 },
          workArea: { x: -1440, y: 25, width: 1440, height: 800 },
        },
      ],
    );
    expect(state.bounds).toEqual({ x: -1440, y: 25, width: 1200, height: 800 });
  });

  it('reopens a saved full-screen window in desktop mode', () => {
    expect(normalizeWindowState({ isFullScreen: true }, []).isFullScreen).toBe(false);
  });
});
