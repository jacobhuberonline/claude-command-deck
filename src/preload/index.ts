import electron from 'electron';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import type {
  AuthExitEvent,
  AuthOutputEvent,
  CommandDeckBridge,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalStateEvent,
} from '../shared/ipc/contracts';
const bridge: CommandDeckBridge = {
  getAppState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.appGetState) as Promise<
      Awaited<ReturnType<CommandDeckBridge['getAppState']>>
    >,
  openDirectory: (request) => {
    return ipcRenderer.invoke(IPC_CHANNELS.appOpenExternalDirectory, request) as Promise<
      Awaited<ReturnType<CommandDeckBridge['openDirectory']>>
    >;
  },
  openLogDirectory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.appOpenLogDirectory) as Promise<
      Awaited<ReturnType<CommandDeckBridge['openLogDirectory']>>
    >,
  selectDirectory: (request) => {
    return ipcRenderer.invoke(IPC_CHANNELS.appSelectDirectory, request) as Promise<
      Awaited<ReturnType<CommandDeckBridge['selectDirectory']>>
    >;
  },
  updateAudioPreferences: (request) => {
    return ipcRenderer.invoke(IPC_CHANNELS.appUpdateAudioPreferences, request) as Promise<
      Awaited<ReturnType<CommandDeckBridge['updateAudioPreferences']>>
    >;
  },
  updateAuthConfiguration: (request) => {
    return ipcRenderer.invoke(IPC_CHANNELS.appUpdateAuthConfiguration, request) as Promise<
      Awaited<ReturnType<CommandDeckBridge['updateAuthConfiguration']>>
    >;
  },
  updateNotificationPreferences: (request) => {
    return ipcRenderer.invoke(IPC_CHANNELS.appUpdateNotificationPreferences, request) as Promise<
      Awaited<ReturnType<CommandDeckBridge['updateNotificationPreferences']>>
    >;
  },
  updateSessionAudioPreferences: (request) => {
    return ipcRenderer.invoke(IPC_CHANNELS.appUpdateSessionAudioPreferences, request) as Promise<
      Awaited<ReturnType<CommandDeckBridge['updateSessionAudioPreferences']>>
    >;
  },
  claude: {
    discover: (executable) => {
      return ipcRenderer.invoke(IPC_CHANNELS.claudeDiscover, { executable }) as Promise<
        Awaited<ReturnType<CommandDeckBridge['claude']['discover']>>
      >;
    },
  },
  auth: {
    check: () =>
      ipcRenderer.invoke(IPC_CHANNELS.authCheck) as Promise<
        Awaited<ReturnType<CommandDeckBridge['auth']['check']>>
      >,
    startRefresh: () =>
      ipcRenderer.invoke(IPC_CHANNELS.authStartRefresh) as Promise<
        Awaited<ReturnType<CommandDeckBridge['auth']['startRefresh']>>
      >,
    write: (request) => {
      return ipcRenderer.invoke(IPC_CHANNELS.authWrite, request) as Promise<
        Awaited<ReturnType<CommandDeckBridge['auth']['write']>>
      >;
    },
    resize: (request) => {
      return ipcRenderer.invoke(IPC_CHANNELS.authResize, request) as Promise<
        Awaited<ReturnType<CommandDeckBridge['auth']['resize']>>
      >;
    },
    stopRefresh: () =>
      ipcRenderer.invoke(IPC_CHANNELS.authStopRefresh) as Promise<
        Awaited<ReturnType<CommandDeckBridge['auth']['stopRefresh']>>
      >,
    onOutput: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AuthOutputEvent) =>
        listener(payload);
      ipcRenderer.on(IPC_CHANNELS.authOutput, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.authOutput, handler);
    },
    onExit: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AuthExitEvent) =>
        listener(payload);
      ipcRenderer.on(IPC_CHANNELS.authExit, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.authExit, handler);
    },
  },
  terminal: {
    startShell: (request) => {
      return ipcRenderer.invoke(IPC_CHANNELS.terminalStartShell, request) as Promise<
        Awaited<ReturnType<CommandDeckBridge['terminal']['startShell']>>
      >;
    },
    startClaude: (request) => {
      return ipcRenderer.invoke(IPC_CHANNELS.terminalStartClaude, request) as Promise<
        Awaited<ReturnType<CommandDeckBridge['terminal']['startClaude']>>
      >;
    },
    write: (request) => {
      return ipcRenderer.invoke(IPC_CHANNELS.terminalWrite, request) as Promise<
        Awaited<ReturnType<CommandDeckBridge['terminal']['write']>>
      >;
    },
    resize: (request) => {
      return ipcRenderer.invoke(IPC_CHANNELS.terminalResize, request) as Promise<
        Awaited<ReturnType<CommandDeckBridge['terminal']['resize']>>
      >;
    },
    stop: (request) => {
      return ipcRenderer.invoke(IPC_CHANNELS.terminalStop, request) as Promise<
        Awaited<ReturnType<CommandDeckBridge['terminal']['stop']>>
      >;
    },
    getSnapshots: () =>
      ipcRenderer.invoke(IPC_CHANNELS.terminalGetSnapshots) as Promise<
        Awaited<ReturnType<CommandDeckBridge['terminal']['getSnapshots']>>
      >,
    onOutput: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TerminalOutputEvent) =>
        listener(payload);
      ipcRenderer.on(IPC_CHANNELS.terminalOutput, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.terminalOutput, handler);
    },
    onExit: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent) =>
        listener(payload);
      ipcRenderer.on(IPC_CHANNELS.terminalExit, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.terminalExit, handler);
    },
    onState: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TerminalStateEvent) =>
        listener(payload);
      ipcRenderer.on(IPC_CHANNELS.terminalState, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.terminalState, handler);
    },
  },
};

const { contextBridge, ipcRenderer } = electron;

contextBridge.exposeInMainWorld('commandDeck', bridge);
