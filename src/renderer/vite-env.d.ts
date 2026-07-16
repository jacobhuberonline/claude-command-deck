/// <reference types="vite/client" />

import type { CommandDeckBridge } from '../shared/ipc/contracts';

declare global {
  interface Window {
    commandDeck: CommandDeckBridge;
  }
}
