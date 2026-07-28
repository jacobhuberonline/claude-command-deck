import { useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';
import { GripVertical, Plus, Search, Trash2 } from 'lucide-react';
import type {
  SessionConfiguration,
  SessionId,
  SessionLaunchMode,
  SessionSnapshot,
  ShellKind,
  ShellOption,
} from '../../../shared/domain/types';
import type { TerminalBridge } from '../../../shared/ipc/contracts';
import type { TerminalReplayStore } from '../../services/terminal/TerminalReplayStore';
import { SessionBay } from './SessionBay';

type SessionFilter = 'all' | 'running' | 'attention';
type DropPosition = 'before' | 'after';

interface SessionGridProps {
  sessions: SessionSnapshot[];
  focusedSessionId: SessionId;
  focusMode: boolean;
  onFocusSession: (sessionId: SessionId) => void;
  onRequestTerminalFocus: () => void;
  onAddSession: () => void;
  onRemoveSession: (sessionId: SessionId) => void;
  shellKind: ShellKind;
  shellOptions: ShellOption[];
  onUpdateShellKind: (shellKind: ShellKind) => void;
  onStartShell: (sessionId: SessionId, shellKind: ShellKind) => void;
  onLaunchClaude: (sessionId: SessionId, launchMode: SessionLaunchMode) => void;
  onSelectDirectory: (sessionId: SessionId) => void;
  onOpenDirectory: (sessionId: SessionId) => void;
  onStopSession: (sessionId: SessionId) => void;
  onUpdateSessionConfiguration: (configuration: SessionConfiguration) => void;
  onReorderSessions: (sessionIds: SessionId[]) => void;
  terminalBridge: TerminalBridge;
  terminalFocusRequest: number;
  terminalReplayStore: TerminalReplayStore;
}

export function SessionGrid({
  sessions,
  focusedSessionId,
  focusMode,
  onFocusSession,
  onRequestTerminalFocus,
  onAddSession,
  onRemoveSession,
  shellKind,
  shellOptions,
  onUpdateShellKind,
  onStartShell,
  onLaunchClaude,
  onSelectDirectory,
  onOpenDirectory,
  onStopSession,
  onUpdateSessionConfiguration,
  onReorderSessions,
  terminalBridge,
  terminalFocusRequest,
  terminalReplayStore,
}: SessionGridProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SessionFilter>('all');
  const [highlightedSessionId, setHighlightedSessionId] = useState<SessionId | null>(null);
  const [draggingSessionId, setDraggingSessionId] = useState<SessionId | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    sessionId: SessionId;
    position: DropPosition;
  } | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const focused = sessions.find((session) => session.configuration.id === focusedSessionId);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSessions = useMemo(
    () =>
      sessions.filter((session) => {
        const matchesQuery =
          !normalizedQuery ||
          session.configuration.name.toLowerCase().includes(normalizedQuery) ||
          session.configuration.workingDirectory.toLowerCase().includes(normalizedQuery);
        const matchesFilter =
          filter === 'all' ||
          (filter === 'running' && session.runtime.processState === 'running') ||
          (filter === 'attention' && session.runtime.attention);
        return matchesQuery && matchesFilter;
      }),
    [filter, normalizedQuery, sessions],
  );

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setQuery('');
      setFilter('all');
      setHighlightedSessionId(null);
      event.currentTarget.blur();
      onRequestTerminalFocus();
      return;
    }

    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key) || filteredSessions.length === 0) {
      return;
    }

    event.preventDefault();
    if (event.key === 'Enter') {
      const highlighted = filteredSessions.find(
        (session) => session.configuration.id === highlightedSessionId,
      );
      const selected =
        highlighted ??
        filteredSessions.find((session) => session.configuration.id === focusedSessionId) ??
        filteredSessions[0];
      if (selected) {
        onFocusSession(selected.configuration.id);
        onRequestTerminalFocus();
        event.currentTarget.blur();
      }
      return;
    }

    const currentIndex = filteredSessions.findIndex(
      (session) => session.configuration.id === highlightedSessionId,
    );
    const nextIndex =
      currentIndex < 0
        ? event.key === 'ArrowUp'
          ? filteredSessions.length - 1
          : 0
        : event.key === 'ArrowUp'
          ? (currentIndex - 1 + filteredSessions.length) % filteredSessions.length
          : (currentIndex + 1) % filteredSessions.length;
    const nextSession = filteredSessions[nextIndex] ?? filteredSessions[0];
    if (nextSession) {
      setHighlightedSessionId(nextSession.configuration.id);
    }
  };

  const commitSessionOrder = (sessionIds: SessionId[], movedSessionId: SessionId) => {
    const currentSessionIds = sessions.map((session) => session.configuration.id);
    if (
      sessionIds.length !== currentSessionIds.length ||
      sessionIds.every((sessionId, index) => sessionId === currentSessionIds[index])
    ) {
      return;
    }

    onReorderSessions(sessionIds);
    const movedSession = sessions.find((session) => session.configuration.id === movedSessionId);
    setReorderAnnouncement(
      `${movedSession?.configuration.name ?? 'Session'} moved to position ${
        sessionIds.indexOf(movedSessionId) + 1
      } of ${sessionIds.length}.`,
    );
  };

  const moveSessionWithKeyboard = (sessionId: SessionId, direction: -1 | 1) => {
    const sessionIds = sessions.map((session) => session.configuration.id);
    const currentIndex = sessionIds.indexOf(sessionId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= sessionIds.length) {
      return;
    }

    sessionIds.splice(currentIndex, 1);
    sessionIds.splice(nextIndex, 0, sessionId);
    commitSessionOrder(sessionIds, sessionId);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetSessionId: SessionId) => {
    event.preventDefault();
    const sourceSessionId = draggingSessionId || event.dataTransfer.getData('text/plain');
    const position = getDropPosition(event);
    const sessionIds = moveSessionId(
      sessions.map((session) => session.configuration.id),
      sourceSessionId,
      targetSessionId,
      position,
    );
    if (sessionIds) {
      commitSessionOrder(sessionIds, sourceSessionId);
    }
    setDraggingSessionId(null);
    setDropTarget(null);
  };

  return (
    <section
      className={focusMode ? 'session-manager navigator-collapsed' : 'session-manager'}
      aria-label="Claude session manager"
    >
      {focusMode ? null : (
        <aside className="session-navigator" aria-label="Session navigator">
          <header className="navigator-header">
            <div>
              <strong>Sessions</strong>
              <span>{sessions.length} configured</span>
            </div>
            <button
              className="icon-button"
              type="button"
              title="Add a session directory (Alt+N)"
              aria-label="Add session"
              onClick={onAddSession}
            >
              <Plus size={16} aria-hidden="true" />
            </button>
          </header>

          <label className="session-search">
            <Search size={14} aria-hidden="true" />
            <span className="sr-only">Find a session</span>
            <input
              type="search"
              aria-label="Find a session"
              placeholder="Find name or directory…"
              value={query}
              aria-activedescendant={
                highlightedSessionId ? `session-result-${highlightedSessionId}` : undefined
              }
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setHighlightedSessionId(null);
              }}
              onKeyDown={handleSearchKeyDown}
            />
            <kbd>Ctrl⇧P</kbd>
          </label>

          <div className="session-filters" aria-label="Filter sessions">
            {(['all', 'running', 'attention'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={filter === option ? 'selected' : ''}
                aria-pressed={filter === option}
                onClick={() => {
                  setFilter(option);
                  setHighlightedSessionId(null);
                }}
              >
                {option === 'all'
                  ? 'All'
                  : option === 'running'
                    ? `Running ${countRunning(sessions)}`
                    : `Attention ${countAttention(sessions)}`}
              </button>
            ))}
          </div>

          <div className="session-list" role="list">
            {filteredSessions.map((session) => {
              const { configuration, runtime } = session;
              const shortcutIndex = sessions.findIndex(
                (candidate) => candidate.configuration.id === configuration.id,
              );
              const selected = configuration.id === focusedSessionId;
              const highlighted = configuration.id === highlightedSessionId;
              const removable =
                sessions.length > 1 &&
                !['starting', 'running', 'restarting', 'stopping'].includes(runtime.processState) &&
                !(runtime.processState === 'error' && runtime.processType !== undefined);
              return (
                <div
                  className={[
                    'session-list-row',
                    selected ? 'selected' : '',
                    highlighted ? 'highlighted' : '',
                    draggingSessionId === configuration.id ? 'dragging' : '',
                    dropTarget?.sessionId === configuration.id ? `drop-${dropTarget.position}` : '',
                  ].join(' ')}
                  role="listitem"
                  key={configuration.id}
                  onDragOver={(event) => {
                    if (!draggingSessionId || draggingSessionId === configuration.id) {
                      return;
                    }
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropTarget({
                      sessionId: configuration.id,
                      position: getDropPosition(event),
                    });
                  }}
                  onDrop={(event) => handleDrop(event, configuration.id)}
                >
                  <button
                    className="session-drag-handle"
                    type="button"
                    draggable={sessions.length > 1}
                    disabled={sessions.length <= 1}
                    aria-label={`Move ${configuration.name}, position ${shortcutIndex + 1} of ${sessions.length}`}
                    aria-keyshortcuts="ArrowUp ArrowDown"
                    title="Drag to reorder. Use Arrow Up or Arrow Down for keyboard reordering."
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', configuration.id);
                      setDraggingSessionId(configuration.id);
                      setDropTarget(null);
                    }}
                    onDragEnd={() => {
                      setDraggingSessionId(null);
                      setDropTarget(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                        event.preventDefault();
                        moveSessionWithKeyboard(configuration.id, event.key === 'ArrowUp' ? -1 : 1);
                      }
                    }}
                  >
                    <GripVertical size={14} aria-hidden="true" />
                  </button>
                  <button
                    className="session-list-main"
                    id={`session-result-${configuration.id}`}
                    type="button"
                    aria-current={selected ? 'true' : undefined}
                    aria-label={`${shortcutIndex >= 0 && shortcutIndex < 9 ? `${shortcutIndex + 1} ` : ''}${configuration.name}, ${humanizeState(runtime.processState)}, ${humanizeState(runtime.activityState)}${runtime.attention ? ', needs attention' : ''}`}
                    onClick={() => {
                      setHighlightedSessionId(configuration.id);
                      onFocusSession(configuration.id);
                      onRequestTerminalFocus();
                    }}
                    title={configuration.workingDirectory || 'No directory selected'}
                  >
                    <span className={`navigator-status state-${runtime.processState}`} />
                    <span className="session-list-copy">
                      <strong>
                        {shortcutIndex >= 0 && shortcutIndex < 9 ? (
                          <kbd>{shortcutIndex + 1}</kbd>
                        ) : null}
                        {configuration.name}
                      </strong>
                      <span>{configuration.workingDirectory || 'Choose a working directory'}</span>
                    </span>
                    {runtime.attention ? (
                      <span className="attention-count" aria-hidden="true">
                        !
                      </span>
                    ) : null}
                  </button>
                  <button
                    className="session-remove"
                    type="button"
                    disabled={!removable}
                    title={
                      removable
                        ? `Remove ${configuration.name}`
                        : 'Stop the process before removing this session'
                    }
                    aria-label={`Remove ${configuration.name}`}
                    onClick={() => onRemoveSession(configuration.id)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
            {filteredSessions.length === 0 ? (
              <p className="session-list-empty">No sessions match this view.</p>
            ) : null}
          </div>

          <p className="sr-only" aria-live="polite">
            {reorderAnnouncement}
          </p>

          <footer className="navigator-footer">
            <span>Drag handles · Alt+1…9</span>
            <span>Ctrl+PgUp/PgDn cycle</span>
          </footer>
        </aside>
      )}

      <div className="session-stage">
        {focused ? (
          <SessionBay
            key={focused.configuration.id}
            session={focused}
            terminalFocusRequest={terminalFocusRequest}
            isFocused
            isLarge
            shellKind={shellKind}
            shellOptions={shellOptions}
            onUpdateShellKind={onUpdateShellKind}
            onStartShell={onStartShell}
            onLaunchClaude={onLaunchClaude}
            onSelectDirectory={onSelectDirectory}
            onOpenDirectory={onOpenDirectory}
            onStopSession={onStopSession}
            onUpdateSessionConfiguration={onUpdateSessionConfiguration}
            terminalBridge={terminalBridge}
            terminalReplayStore={terminalReplayStore}
          />
        ) : (
          <div className="empty-session-stage">
            <strong>No session selected</strong>
            <button className="control-button primary" type="button" onClick={onAddSession}>
              <Plus size={15} aria-hidden="true" />
              Add session
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function countRunning(sessions: SessionSnapshot[]) {
  return sessions.filter((session) => session.runtime.processState === 'running').length;
}

function countAttention(sessions: SessionSnapshot[]) {
  return sessions.filter((session) => session.runtime.attention).length;
}

function humanizeState(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function getDropPosition(event: DragEvent<HTMLDivElement>): DropPosition {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
}

function moveSessionId(
  sessionIds: SessionId[],
  sourceSessionId: SessionId,
  targetSessionId: SessionId,
  position: DropPosition,
): SessionId[] | null {
  if (
    !sourceSessionId ||
    sourceSessionId === targetSessionId ||
    !sessionIds.includes(sourceSessionId) ||
    !sessionIds.includes(targetSessionId)
  ) {
    return null;
  }

  const nextSessionIds = sessionIds.filter((sessionId) => sessionId !== sourceSessionId);
  const targetIndex = nextSessionIds.indexOf(targetSessionId);
  nextSessionIds.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, sourceSessionId);
  return nextSessionIds;
}
