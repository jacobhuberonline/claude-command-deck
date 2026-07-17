import type { SessionId, SessionLaunchMode, SessionSnapshot } from '../../../shared/domain/types';
import type { TerminalBridge } from '../../../shared/ipc/contracts';
import { SessionBay } from './SessionBay';

interface SessionGridProps {
  sessions: SessionSnapshot[];
  focusedSessionId: SessionId;
  focusMode: boolean;
  onFocusSession: (sessionId: SessionId) => void;
  onToggleFocusMode: () => void;
  onOpenSettings: () => void;
  onStartShell: (sessionId: SessionId) => void;
  onLaunchClaude: (sessionId: SessionId, launchMode: SessionLaunchMode) => void;
  onSelectDirectory: (sessionId: SessionId) => void;
  onOpenDirectory: (sessionId: SessionId) => void;
  onStopSession: (sessionId: SessionId) => void;
  terminalBridge: TerminalBridge;
}

export function SessionGrid({
  sessions,
  focusedSessionId,
  focusMode,
  onFocusSession,
  onToggleFocusMode,
  onOpenSettings,
  onStartShell,
  onLaunchClaude,
  onSelectDirectory,
  onOpenDirectory,
  onStopSession,
  terminalBridge,
}: SessionGridProps) {
  const focused = sessions.find((session) => session.configuration.id === focusedSessionId);
  const sideSessions = sessions.filter((session) => session.configuration.id !== focusedSessionId);

  if (focusMode && focused) {
    return (
      <section className="session-focus-layout" aria-label="Focused session layout">
        <SessionBay
          session={focused}
          isFocused
          isLarge
          onFocus={() => onFocusSession(focused.configuration.id)}
          onToggleFocusMode={onToggleFocusMode}
          onOpenSettings={onOpenSettings}
          onStartShell={onStartShell}
          onLaunchClaude={onLaunchClaude}
          onSelectDirectory={onSelectDirectory}
          onOpenDirectory={onOpenDirectory}
          onStopSession={onStopSession}
          terminalBridge={terminalBridge}
        />
        <aside className="session-side-strip" aria-label="Other session bays">
          {sideSessions.map((session) => (
            <SessionBay
              key={session.configuration.id}
              session={session}
              isCompact
              isFocused={false}
              onFocus={() => onFocusSession(session.configuration.id)}
              onToggleFocusMode={onToggleFocusMode}
              onOpenSettings={onOpenSettings}
              onStartShell={onStartShell}
              onLaunchClaude={onLaunchClaude}
              onSelectDirectory={onSelectDirectory}
              onOpenDirectory={onOpenDirectory}
              onStopSession={onStopSession}
              terminalBridge={terminalBridge}
            />
          ))}
        </aside>
      </section>
    );
  }

  return (
    <section className="session-grid" aria-label="Four session bays">
      {sessions.map((session) => (
        <SessionBay
          key={session.configuration.id}
          session={session}
          isFocused={session.configuration.id === focusedSessionId}
          onFocus={() => onFocusSession(session.configuration.id)}
          onToggleFocusMode={onToggleFocusMode}
          onOpenSettings={onOpenSettings}
          onStartShell={onStartShell}
          onLaunchClaude={onLaunchClaude}
          onSelectDirectory={onSelectDirectory}
          onOpenDirectory={onOpenDirectory}
          onStopSession={onStopSession}
          terminalBridge={terminalBridge}
        />
      ))}
    </section>
  );
}
