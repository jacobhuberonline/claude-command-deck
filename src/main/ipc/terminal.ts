import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { BrowserWindow, ipcMain } from 'electron';
import { buildClaudeCommand } from '../../shared/claude/ClaudeCommandBuilder';
import { createClaudeSessionName } from '../../shared/domain/defaults';
import type {
  ApplicationSettings,
  SessionConfiguration,
  SessionId,
  SessionLaunchMode,
} from '../../shared/domain/types';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import type {
  ClaudeLaunchStrategy,
  CommandResult,
  PrepareClaudeLaunchResult,
  StartClaudeResult,
  TerminalConversationBindingEvent,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalStateEvent,
} from '../../shared/ipc/contracts';
import {
  prepareClaudeLaunchRequestSchema,
  startShellRequestSchema,
  startClaudeRequestSchema,
  terminalResizeRequestSchema,
  terminalStopRequestSchema,
  terminalWriteRequestSchema,
} from '../../shared/schemas/ipc';
import { discoverClaude } from '../claude/ClaudeDiscovery';
import type { ProcessManager } from '../processes/ProcessManager';
import { listShellOptionsAsync } from '../processes/ShellDiscovery';
import type { SettingsStore } from '../persistence/SettingsStore';

const launchPlanLifetimeMs = 5 * 60 * 1000;
const conversationBindingReadyDelayMs = 750;

type ConversationBindingDisposition =
  { kind: 'preserve' } | { kind: 'replace'; name: string } | { kind: 'clear' };

interface PendingConversationBinding {
  processId: string;
  disposition: Exclude<ConversationBindingDisposition, { kind: 'preserve' }>;
  timer: NodeJS.Timeout | null;
}

let conversationBindingContext:
  | {
      settingsStore: SettingsStore;
      pending: Map<SessionId, PendingConversationBinding>;
    }
  | undefined;

interface ClaudeLaunchPlan {
  id: string;
  sessionId: SessionId;
  launchMode: Exclude<SessionLaunchMode, 'custom'>;
  strategy: ClaudeLaunchStrategy;
  profileFingerprint: string;
  expiresAt: number;
  workingDirectory: string;
  executable: string;
  args: string[];
  newConversationBinding: string | null;
  warnings: string[];
  requiresFreshFallbackConsent: boolean;
  requiresAmbiguousContinueConsent: boolean;
  incumbentProcessId: string | null;
  processEpoch: number;
  stopAuthorized: boolean;
  bindingDisposition: ConversationBindingDisposition;
}

export function registerTerminalHandlers(
  processManager: ProcessManager,
  settingsStore: SettingsStore,
): void {
  conversationBindingContext?.pending.forEach((binding) => {
    if (binding.timer) {
      clearTimeout(binding.timer);
    }
  });
  conversationBindingContext = {
    settingsStore,
    pending: new Map(),
  };
  const claudeLaunchPlans = new Map<SessionId, ClaudeLaunchPlan>();
  const claudePrepareGenerations = new Map<SessionId, number>();

  ipcMain.handle(IPC_CHANNELS.terminalGetShellOptions, () => listShellOptionsAsync());

  ipcMain.handle(IPC_CHANNELS.terminalStartShell, (_event, rawPayload): CommandResult => {
    const payload = startShellRequestSchema.safeParse(rawPayload);
    if (!payload.success) {
      return { ok: false, error: 'Invalid shell start request.' };
    }

    const session = settingsStore
      .load()
      .sessions.find((candidate) => candidate.id === payload.data.sessionId);
    return session
      ? processManager.startShell({
          ...payload.data,
          workingDirectory: session.workingDirectory,
        })
      : { ok: false, error: 'The selected session no longer exists.' };
  });

  ipcMain.handle(
    IPC_CHANNELS.terminalPrepareClaude,
    async (_event, rawPayload): Promise<PrepareClaudeLaunchResult> => {
      const payload = prepareClaudeLaunchRequestSchema.safeParse(rawPayload);
      if (!payload.success) {
        return { ok: false, error: 'Invalid Claude launch preparation request.' };
      }

      const generation = (claudePrepareGenerations.get(payload.data.sessionId) ?? 0) + 1;
      claudePrepareGenerations.set(payload.data.sessionId, generation);
      claudeLaunchPlans.delete(payload.data.sessionId);
      const settings = settingsStore.load();
      pruneClaudeLaunchPlans(claudeLaunchPlans, settings);
      const session = settings.sessions.find(
        (candidate) => candidate.id === payload.data.sessionId,
      );
      if (!session) {
        return { ok: false, error: 'The selected session no longer exists.' };
      }

      const incumbentProcessId =
        processManager.snapshots().find((snapshot) => snapshot.sessionId === session.id)?.id ??
        null;
      const processEpoch = processManager.processEpoch(session.id);
      const plan = await createClaudeLaunchPlan(
        settings,
        session,
        payload.data.launchMode,
        incumbentProcessId,
        processEpoch,
      );
      if (!plan.ok) {
        return plan;
      }
      if (claudePrepareGenerations.get(session.id) !== generation) {
        return { ok: false, error: 'A newer Claude launch preparation replaced this one.' };
      }

      const currentSettings = settingsStore.load();
      const currentSession = currentSettings.sessions.find(
        (candidate) => candidate.id === session.id,
      );
      if (
        !currentSession ||
        plan.value.profileFingerprint !==
          createLaunchProfileFingerprint(currentSettings, currentSession)
      ) {
        return { ok: false, error: 'The session profile changed. Prepare this launch again.' };
      }
      const currentIncumbentProcessId =
        processManager.snapshots().find((snapshot) => snapshot.sessionId === session.id)?.id ??
        null;
      if (currentIncumbentProcessId !== plan.value.incumbentProcessId) {
        return {
          ok: false,
          error: 'The session process changed while preparing Claude. Prepare this launch again.',
        };
      }
      if (processManager.processEpoch(session.id) !== plan.value.processEpoch) {
        return {
          ok: false,
          error: 'The session process changed while preparing Claude. Prepare this launch again.',
        };
      }

      claudeLaunchPlans.set(session.id, plan.value);
      return {
        ok: true,
        planId: plan.value.id,
        strategy: plan.value.strategy,
        requiresFreshFallbackConsent: plan.value.requiresFreshFallbackConsent,
        requiresAmbiguousContinueConsent: plan.value.requiresAmbiguousContinueConsent,
        hasActiveProcess: plan.value.incumbentProcessId !== null,
        warnings: plan.value.warnings,
      };
    },
  );

  ipcMain.handle(IPC_CHANNELS.terminalStartClaude, (_event, rawPayload): StartClaudeResult => {
    const payload = startClaudeRequestSchema.safeParse(rawPayload);
    if (!payload.success) {
      return { ok: false, error: 'Invalid Claude start request.' };
    }

    const settings = settingsStore.load();
    const session = settings.sessions.find((candidate) => candidate.id === payload.data.sessionId);
    if (!session) {
      return { ok: false, error: 'The selected session no longer exists.' };
    }

    const plan = claudeLaunchPlans.get(session.id);
    if (!plan || plan.id !== payload.data.planId) {
      return { ok: false, error: 'Prepare this Claude launch again before starting it.' };
    }
    claudeLaunchPlans.delete(session.id);

    if (plan.expiresAt < Date.now()) {
      return { ok: false, error: 'The prepared Claude launch expired. Prepare it again.' };
    }
    if (plan.profileFingerprint !== createLaunchProfileFingerprint(settings, session)) {
      return { ok: false, error: 'The session profile changed. Prepare this launch again.' };
    }
    if (processManager.processEpoch(session.id) !== plan.processEpoch) {
      return {
        ok: false,
        error: 'Another process used this session after preparation. Prepare this launch again.',
      };
    }
    if (plan.requiresFreshFallbackConsent && !payload.data.allowFreshFallback) {
      return { ok: false, error: 'Claude continuation is unsupported by this executable.' };
    }
    if (plan.requiresAmbiguousContinueConsent && !payload.data.allowAmbiguousContinue) {
      return {
        ok: false,
        error: 'Continuing the most recent conversation in this shared directory requires consent.',
      };
    }
    if (plan.incumbentProcessId !== null && !plan.stopAuthorized) {
      return { ok: false, error: 'The process reviewed for this launch was not stopped safely.' };
    }
    if (processManager.hasActiveProcess(session.id)) {
      return { ok: false, error: 'A different process became active. Prepare this launch again.' };
    }

    const result = processManager.startClaude({
      sessionId: payload.data.sessionId,
      workingDirectory: plan.workingDirectory,
      executable: plan.executable,
      args: plan.args,
      cols: payload.data.cols,
      rows: payload.data.rows,
    });
    if (result.ok && plan.bindingDisposition.kind !== 'preserve') {
      registerPendingConversationBinding(session.id, result.processId, plan.bindingDisposition);
    }
    return result.ok
      ? {
          ok: true,
          processId: result.processId,
          strategy: plan.strategy,
          newConversationBinding: plan.newConversationBinding,
          warnings: plan.warnings,
        }
      : result;
  });

  ipcMain.handle(IPC_CHANNELS.terminalWrite, (_event, rawPayload): CommandResult => {
    const payload = terminalWriteRequestSchema.safeParse(rawPayload);
    if (!payload.success) {
      return { ok: false, error: 'Invalid terminal input request.' };
    }
    return hasSession(settingsStore, payload.data.sessionId)
      ? processManager.write(payload.data.sessionId, payload.data.data)
      : { ok: false, error: 'The selected session no longer exists.' };
  });

  ipcMain.handle(IPC_CHANNELS.terminalResize, (_event, rawPayload): CommandResult => {
    const payload = terminalResizeRequestSchema.safeParse(rawPayload);
    if (!payload.success) {
      return { ok: false, error: 'Invalid terminal resize request.' };
    }
    return hasSession(settingsStore, payload.data.sessionId)
      ? processManager.resize(payload.data.sessionId, payload.data.cols, payload.data.rows)
      : { ok: false, error: 'The selected session no longer exists.' };
  });

  ipcMain.handle(IPC_CHANNELS.terminalStop, (_event, rawPayload): CommandResult => {
    const payload = terminalStopRequestSchema.safeParse(rawPayload);
    if (!payload.success) {
      return { ok: false, error: 'Invalid terminal stop request.' };
    }
    const settings = settingsStore.load();
    const session = settings.sessions.find((candidate) => candidate.id === payload.data.sessionId);
    if (!session) {
      return { ok: false, error: 'The selected session no longer exists.' };
    }
    if (payload.data.planId) {
      const plan = claudeLaunchPlans.get(payload.data.sessionId);
      if (!plan || plan.id !== payload.data.planId) {
        return { ok: false, error: 'The prepared Claude launch no longer matches this session.' };
      }
      if (plan.expiresAt < Date.now()) {
        claudeLaunchPlans.delete(payload.data.sessionId);
        return { ok: false, error: 'The prepared Claude launch expired. Prepare it again.' };
      }
      if (plan.profileFingerprint !== createLaunchProfileFingerprint(settings, session)) {
        claudeLaunchPlans.delete(payload.data.sessionId);
        return { ok: false, error: 'The session profile changed. Prepare this launch again.' };
      }
      if (processManager.processEpoch(session.id) !== plan.processEpoch) {
        claudeLaunchPlans.delete(payload.data.sessionId);
        return {
          ok: false,
          error: 'Another process used this session after preparation; nothing was stopped.',
        };
      }

      const activeSnapshot = processManager
        .snapshots()
        .find((snapshot) => snapshot.sessionId === payload.data.sessionId);
      if (activeSnapshot && activeSnapshot.id !== plan.incumbentProcessId) {
        claudeLaunchPlans.delete(payload.data.sessionId);
        return { ok: false, error: 'A different process became active; it was not stopped.' };
      }
      if (!activeSnapshot) {
        plan.stopAuthorized = true;
        return { ok: true };
      }

      const result = processManager.stop(payload.data.sessionId);
      if (result.ok) {
        plan.stopAuthorized = true;
      }
      return result;
    }

    return processManager.stop(payload.data.sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.terminalGetSnapshots, () => processManager.snapshots());
}

async function createClaudeLaunchPlan(
  settings: ApplicationSettings,
  session: SessionConfiguration,
  launchMode: Exclude<SessionLaunchMode, 'custom'>,
  incumbentProcessId: string | null,
  processEpoch: number,
): Promise<{ ok: true; value: ClaudeLaunchPlan } | { ok: false; error: string }> {
  const configuredExecutable = session.executable.trim() || settings.claudeExecutable.trim();
  const discovery = await discoverClaude(configuredExecutable);
  if (!discovery.found) {
    return {
      ok: false,
      error: discovery.error ?? `Claude executable "${configuredExecutable}" was not found.`,
    };
  }

  const knownSessionIdentifier =
    launchMode === 'continueMostRecent' && session.hasNamedConversation
      ? session.claudeSessionName
      : undefined;
  const newSessionName = launchMode === 'new' ? createFreshSessionName(session) : undefined;
  const command = buildClaudeCommand({
    executable: discovery.resolvedPath ?? configuredExecutable,
    baseArgs: session.args.length > 0 ? session.args : settings.claudeBaseArgs,
    model: session.model,
    launchMode,
    capabilities: discovery.capabilities,
    ...(knownSessionIdentifier ? { knownSessionIdentifier } : {}),
    ...(newSessionName ? { newSessionName } : {}),
  });

  if (
    (launchMode === 'continueMostRecent' &&
      session.hasNamedConversation &&
      command.strategy !== 'resumeSpecific') ||
    (launchMode === 'resumeSpecific' && command.strategy !== 'resumeSpecific')
  ) {
    return { ok: false, error: 'The requested Claude conversation cannot be resumed safely.' };
  }
  if (command.strategy === 'custom') {
    return { ok: false, error: 'Invalid Claude launch strategy.' };
  }

  const requiresFreshFallbackConsent = command.strategy === 'freshFallback' && launchMode !== 'new';
  const requiresAmbiguousContinueConsent =
    launchMode === 'continueMostRecent' &&
    !session.hasNamedConversation &&
    command.strategy === 'continueMostRecent' &&
    hasSharedWorkingDirectory(settings.sessions, session.id, session.workingDirectory);
  const bindingDisposition: ConversationBindingDisposition =
    launchMode === 'new'
      ? discovery.capabilities.nameSession && discovery.capabilities.nameFlag && newSessionName
        ? { kind: 'replace', name: newSessionName }
        : { kind: 'clear' }
      : launchMode === 'resumeSpecific'
        ? { kind: 'clear' }
        : { kind: 'preserve' };

  return {
    ok: true,
    value: {
      id: randomUUID(),
      sessionId: session.id,
      launchMode,
      strategy: command.strategy,
      profileFingerprint: createLaunchProfileFingerprint(settings, session),
      expiresAt: Date.now() + launchPlanLifetimeMs,
      workingDirectory: session.workingDirectory,
      executable: command.executable,
      args: command.args,
      newConversationBinding:
        launchMode === 'new' &&
        discovery.capabilities.nameSession &&
        discovery.capabilities.nameFlag
          ? (newSessionName ?? null)
          : null,
      warnings: command.warnings,
      requiresFreshFallbackConsent,
      requiresAmbiguousContinueConsent,
      incumbentProcessId,
      processEpoch,
      stopAuthorized: incumbentProcessId === null,
      bindingDisposition,
    },
  };
}

function createFreshSessionName(session: SessionConfiguration): string {
  const base = createClaudeSessionName(session.name, session.id);
  if (!session.hasNamedConversation) {
    return base;
  }

  let freshName: string;
  do {
    freshName = `${base}-${randomUUID().replace(/-/g, '').slice(0, 8)}`.slice(0, 80);
  } while (freshName === session.claudeSessionName);
  return freshName;
}

function hasSharedWorkingDirectory(
  sessions: SessionConfiguration[],
  sessionId: SessionId,
  workingDirectory: string,
): boolean {
  const target = normalizeDirectory(workingDirectory);
  return Boolean(
    target &&
    sessions.some(
      (session) =>
        session.id !== sessionId && normalizeDirectory(session.workingDirectory) === target,
    ),
  );
}

function createLaunchProfileFingerprint(
  settings: ApplicationSettings,
  session: SessionConfiguration,
): string {
  return JSON.stringify({
    session: {
      id: session.id,
      name: session.name,
      workingDirectory: session.workingDirectory,
      workingDirectoryIdentity: normalizeDirectory(session.workingDirectory),
      executable: session.executable,
      args: session.args,
      model: session.model,
      claudeSessionName: session.claudeSessionName,
      hasNamedConversation: session.hasNamedConversation,
    },
    claudeExecutable: settings.claudeExecutable,
    claudeBaseArgs: settings.claudeBaseArgs,
    directoryPeers: settings.sessions
      .map((candidate) => ({
        id: candidate.id,
        workingDirectory: candidate.workingDirectory,
        workingDirectoryIdentity: normalizeDirectory(candidate.workingDirectory),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

function pruneClaudeLaunchPlans(
  plans: Map<SessionId, ClaudeLaunchPlan>,
  settings: ApplicationSettings,
): void {
  const now = Date.now();
  const currentSessionIds = new Set(settings.sessions.map((session) => session.id));
  plans.forEach((plan, sessionId) => {
    if (plan.expiresAt < now || !currentSessionIds.has(sessionId)) {
      plans.delete(sessionId);
    }
  });
}

function normalizeDirectory(directory: string): string {
  const trimmed = directory.trim();
  if (!trimmed) {
    return '';
  }

  // Claude continuation is scoped to the physical cwd, so aliases must share the same consent check.
  let normalized: string;
  try {
    normalized = realpathSync.native(trimmed);
  } catch {
    normalized = resolve(trimmed);
  }

  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function hasSession(settingsStore: SettingsStore, sessionId: string): boolean {
  return settingsStore.load().sessions.some((session) => session.id === sessionId);
}

export function broadcastTerminalOutput(event: TerminalOutputEvent): void {
  observeConversationBindingOutput(event);
  broadcast(IPC_CHANNELS.terminalOutput, event);
}

export function broadcastTerminalExit(event: TerminalExitEvent): void {
  cancelPendingConversationBinding(event.sessionId, event.processId);
  broadcast(IPC_CHANNELS.terminalExit, event);
}

export function broadcastTerminalState(event: TerminalStateEvent): void {
  broadcast(IPC_CHANNELS.terminalState, event);
}

function registerPendingConversationBinding(
  sessionId: SessionId,
  processId: string,
  disposition: Exclude<ConversationBindingDisposition, { kind: 'preserve' }>,
): void {
  const context = conversationBindingContext;
  if (!context) {
    return;
  }

  const existing = context.pending.get(sessionId);
  if (existing?.timer) {
    clearTimeout(existing.timer);
  }
  context.pending.set(sessionId, {
    processId,
    disposition,
    timer: null,
  });
}

function observeConversationBindingOutput(event: TerminalOutputEvent): void {
  const context = conversationBindingContext;
  const pending = context?.pending.get(event.sessionId);
  if (!context || !pending || pending.processId !== event.processId || pending.timer) {
    return;
  }

  pending.timer = setTimeout(() => {
    if (context.pending.get(event.sessionId) !== pending) {
      return;
    }
    context.pending.delete(event.sessionId);
    const claudeSessionName =
      pending.disposition.kind === 'replace' ? pending.disposition.name : null;
    let updated: boolean;
    try {
      updated = context.settingsStore.updateSessionConversation(event.sessionId, claudeSessionName);
    } catch {
      return;
    }
    if (!updated) {
      return;
    }

    const bindingEvent: TerminalConversationBindingEvent = {
      sessionId: event.sessionId,
      processId: event.processId,
      claudeSessionName,
    };
    broadcast(IPC_CHANNELS.terminalConversationBinding, bindingEvent);
  }, conversationBindingReadyDelayMs);
}

function cancelPendingConversationBinding(sessionId: SessionId, processId: string): void {
  const pending = conversationBindingContext?.pending.get(sessionId);
  if (!pending || pending.processId !== processId) {
    return;
  }
  if (pending.timer) {
    clearTimeout(pending.timer);
  }
  conversationBindingContext?.pending.delete(sessionId);
}

function broadcast(channel: string, payload: unknown): void {
  let windows: BrowserWindow[];
  try {
    windows = BrowserWindow.getAllWindows();
  } catch {
    return;
  }

  windows.forEach((window) => {
    try {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(channel, payload);
      }
    } catch {
      // A renderer can disappear between the lifecycle checks and send.
    }
  });
}
