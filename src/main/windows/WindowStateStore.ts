import Store from 'electron-store';
import type { BrowserWindow } from 'electron';
import { normalizeBounds, normalizeWindowState } from './WindowState';
import type { PersistedWindowState, WindowDisplay } from './WindowState';

interface StoredWindowShape {
  windowState?: PersistedWindowState;
}

export class WindowStateStore {
  private readonly store = new Store<StoredWindowShape>({
    name: 'window-state',
    clearInvalidConfig: false,
  });

  load(displays: WindowDisplay[]): PersistedWindowState {
    return normalizeWindowState(this.store.get('windowState'), displays);
  }

  save(window: BrowserWindow): void {
    if (window.isDestroyed()) {
      return;
    }

    this.store.set('windowState', {
      bounds: normalizeBounds(window.getNormalBounds()),
      isMaximized: window.isMaximized(),
      isFullScreen: window.isFullScreen(),
      isMinimized: window.isMinimized(),
    });
  }
}
