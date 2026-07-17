import type { Rectangle } from 'electron';

const minimumWindowWidth = 1040;
const minimumWindowHeight = 720;
export const defaultWindowBounds: Rectangle = {
  x: 80,
  y: 60,
  width: 1440,
  height: 980,
};

export interface WindowDisplay {
  bounds: Rectangle;
}

export interface PersistedWindowState {
  bounds?: Rectangle | undefined;
  isMaximized?: boolean | undefined;
  isFullScreen?: boolean | undefined;
  isMinimized?: boolean | undefined;
}

export function normalizeWindowState(
  state: PersistedWindowState | undefined,
  displays: WindowDisplay[],
): PersistedWindowState {
  const bounds = normalizeBounds(state?.bounds);
  const visibleBounds = isVisibleOnAnyDisplay(bounds, displays) ? bounds : defaultWindowBounds;

  return {
    bounds: visibleBounds,
    isMaximized: state?.isMaximized === true,
    isFullScreen: state?.isFullScreen === true,
    isMinimized: state?.isMinimized === true,
  };
}

export function normalizeBounds(bounds: Rectangle | undefined): Rectangle {
  if (!bounds || !isFiniteRectangle(bounds)) {
    return defaultWindowBounds;
  }

  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(minimumWindowWidth, Math.round(bounds.width)),
    height: Math.max(minimumWindowHeight, Math.round(bounds.height)),
  };
}

function isFiniteRectangle(bounds: Rectangle) {
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite);
}

function isVisibleOnAnyDisplay(bounds: Rectangle, displays: WindowDisplay[]) {
  if (displays.length === 0) {
    return true;
  }

  return displays.some((display) => intersectionArea(bounds, display.bounds) > 0);
}

function intersectionArea(a: Rectangle, b: Rectangle) {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);

  return Math.max(0, right - left) * Math.max(0, bottom - top);
}
