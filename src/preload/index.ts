import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc/channels';
import type {
  AuthExitEvent,
  AuthOutputEvent,
  CommandDeckBridge,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalStateEvent,
} from '../shared/ipc/contracts';
import {
  authResizeRequestSchema,
  authWriteRequestSchema,
  openExternalDirectoryRequestSchema,
  selectDirectoryRequestSchema,
  discoverClaudeRequestSchema,
  startClaudeRequestSchema,
  startShellRequestSchema,
  terminalResizeRequestSchema,
  terminalStopRequestSchema,
  terminalWriteRequestSchema,
  updateAudioPreferencesRequestSchema,
  updateNotificationPreferencesRequestSchema,
  updateSessionAudioPreferencesRequestSchema,
} from '../shared/schemas/ipc';

const bridge: CommandDeckBridge = {
  getAppState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.appGetState) as Promise<
      Awaited<ReturnType<CommandDeckBridge['getAppState']>>
    >,
  openDirectory: (request) => {
    const payload = openExternalDirectoryRequestSchema.parse(request);
    return ipcRenderer.invoke(IPC_CHANNELS.appOpenExternalDirectory, payload) as Promise<
      Awaited<ReturnType<CommandDeckBridge['openDirectory']>>
    >;
  },
  openLogDirectory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.appOpenLogDirectory) as Promise<
      Awaited<ReturnType<CommandDeckBridge['openLogDirectory']>>
    >,
  selectDirectory: (request) => {
    const payload = selectDirectoryRequestSchema.parse(request);
    return ipcRenderer.invoke(IPC_CHANNELS.appSelectDirectory, payload) as Promise<
      Awaited<ReturnType<CommandDeckBridge['selectDirectory']>>
    >;
  },
  updateAudioPreferences: (request) => {
    const payload = updateAudioPreferencesRequestSchema.parse(request);
    return ipcRenderer.invoke(IPC_CHANNELS.appUpdateAudioPreferences, payload) as Promise<
      Awaited<ReturnType<CommandDeckBridge['updateAudioPreferences']>>
    >;
  },
  updateNotificationPreferences: (request) => {
    const payload = updateNotificationPreferencesRequestSchema.parse(request);
    return ipcRenderer.invoke(IPC_CHANNELS.appUpdateNotificationPreferences, payload) as Promise<
      Awaited<ReturnType<CommandDeckBridge['updateNotificationPreferences']>>
    >;
  },
  updateSessionAudioPreferences: (request) => {
    const payload = updateSessionAudioPreferencesRequestSchema.parse(request);
    return ipcRenderer.invoke(IPC_CHANNELS.appUpdateSessionAudioPreferences, payload) as Promise<
      Awaited<ReturnType<CommandDeckBridge['updateSessionAudioPreferences']>>
    >;
  },
  claude: {
    discover: (executable) => {
      const payload = discoverClaudeRequestSchema.parse({ executable });
      return ipcRenderer.invoke(IPC_CHANNELS.claudeDiscover, payload) as Promise<
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
      const payload = authWriteRequestSchema.parse(request);
      return ipcRenderer.invoke(IPC_CHANNELS.authWrite, payload) as Promise<
        Awaited<ReturnType<CommandDeckBridge['auth']['write']>>
      >;
    },
    resize: (request) => {
      const payload = authResizeRequestSchema.parse(request);
      return ipcRenderer.invoke(IPC_CHANNELS.authResize, payload) as Promise<
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
      const payload = startShellRequestSchema.parse(request);
      return ipcRenderer.invoke(IPC_CHANNELS.terminalStartShell, payload) as Promise<
        Awaited<ReturnType<CommandDeckBridge['terminal']['startShell']>>
      >;
    },
    startClaude: (request) => {
      const payload = startClaudeRequestSchema.parse(request);
      return ipcRenderer.invoke(IPC_CHANNELS.terminalStartClaude, payload) as Promise<
        Awaited<ReturnType<CommandDeckBridge['terminal']['startClaude']>>
      >;
    },
    write: (request) => {
      const payload = terminalWriteRequestSchema.parse(request);
      return ipcRenderer.invoke(IPC_CHANNELS.terminalWrite, payload) as Promise<
        Awaited<ReturnType<CommandDeckBridge['terminal']['write']>>
      >;
    },
    resize: (request) => {
      const payload = terminalResizeRequestSchema.parse(request);
      return ipcRenderer.invoke(IPC_CHANNELS.terminalResize, payload) as Promise<
        Awaited<ReturnType<CommandDeckBridge['terminal']['resize']>>
      >;
    },
    stop: (request) => {
      const payload = terminalStopRequestSchema.parse(request);
      return ipcRenderer.invoke(IPC_CHANNELS.terminalStop, payload) as Promise<
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

contextBridge.exposeInMainWorld('commandDeck', bridge);
