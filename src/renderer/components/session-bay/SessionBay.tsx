import { useState } from 'react';
import {
  AlertTriangle,
  FolderOpen,
  FolderPen,
  Play,
  Square,
  TerminalSquare,
} from 'lucide-react';
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
import { SessionWorkbench } from './SessionWorkbench';

interface SessionBayProps {
  session: SessionSnapshot;
  terminalFocusRequest: number;
  isFocused: boolean;
  isCompact?: boolean;
  isLarge?: boolean;
  shellKind: ShellKind;
  shellOptions: ShellOption[];
  onUpdateShellKind: (shellKind: ShellKind) => void;
  onStartShell: (sessionId: SessionId, shellKind: ShellKind) => void;
  onLaunchClaude: (sessionId: SessionId, launchMode: SessionLaunchMode) => void;
  onSelectDirectory: (sessionId: SessionId) => void;
  onOpenDirectory: (sessionId: SessionId) => void;
  onStopSession: (sessionId: SessionId) => void;
  onUpdateSessionConfiguration: (configuration: SessionConfiguration) => void;
  terminalBridge: TerminalBridge;
  terminalReplayStore: TerminalReplayStore;
}

const processLabels: Record<SessionSnapshot['runtime']['processState'], string> = {
  empty: 'Empty',
  validating: 'Validating',
  starting: 'Starting',
  running: 'Running',
  restarting: 'Restarting',
  stopping: 'Stopping',
  stopped: 'Stopped',
  crashed: 'Crashed',
  waitingForAuthentication: 'Waiting for authentication',
  error: 'Error',
};

const activityLabels: Record<SessionSnapshot['runtime']['activityState'], string> = {
  unknown: 'Activity unknown',
  idle: 'Idle',
  active: 'Active',
  likelyAwaitingInput: 'Likely awaiting input',
  possiblePermissionPrompt: 'Possible permission prompt',
  authenticationMayBeRequired: 'Credential warning detected',
};

export function SessionBay({
  session,
  terminalFocusRequest,
  isFocused,
  isCompact = false,
  isLarge = false,
  shellKind,
  shellOptions,
  onUpdateShellKind,
  onStartShell,
  onLaunchClaude,
  onSelectDirectory,
  onOpenDirectory,
  onStopSession,
  onUpdateSessionConfiguration,
  terminalBridge,
  terminalReplayStore,
}: SessionBayProps) {
  const { configuration, runtime } = session;
  const modelLabel = configuration.model.trim() || 'Default';
  const isAttention =
    runtime.attention ||
    runtime.activityState === 'possiblePermissionPrompt' ||
    runtime.activityState === 'authenticationMayBeRequired';
  const showWorkbench = !isCompact;
  const directoryChangeDisabled =
    ['starting', 'running', 'restarting', 'stopping'].includes(runtime.processState) ||
    (runtime.processState === 'error' && runtime.processType !== undefined);
  const selectedShellAvailable =
    shellOptions.find((option) => option.kind === shellKind)?.available ?? shellKind === 'auto';
  const [selectedLaunchMode, setSelectedLaunchMode] = useState<SessionLaunchMode>(
    configuration.launchMode,
  );

  return (
    <article
      className={[
        'session-bay',
        `state-${runtime.processState}`,
        isFocused ? 'focused' : '',
        isCompact ? 'compact' : '',
        isLarge ? 'large' : '',
      ].join(' ')}
      aria-label={`${configuration.name} session bay. ${processLabels[runtime.processState]}. ${activityLabels[runtime.activityState]}.`}
    >
      <div className="bay-accent" aria-hidden="true" />
      <header className="bay-header">
        <div
          className="bay-title"
          title={configuration.workingDirectory || 'No directory selected'}
        >
          <span className="status-dot" aria-hidden="true" />
          <span>
            <strong>{configuration.name}</strong>
            <small>{configuration.workingDirectory || 'Choose a working directory'}</small>
          </span>
        </div>
        {configuration.workingDirectory && runtime.sameProject ? (
          <div className="bay-header-actions">
            <span className="same-project">Same project</span>
          </div>
        ) : null}
      </header>

      <div className="bay-meta">
        <StatusPair label="Process" value={processLabels[runtime.processState]} />
        <StatusPair
          label="Activity"
          value={activityLabels[runtime.activityState]}
          attention={isAttention}
        />
        {configuration.model.trim() ? <StatusPair label="Model" value={modelLabel} /> : null}
        {configuration.hasNamedConversation ? (
          <StatusPair label="Conversation" value={configuration.claudeSessionName} />
        ) : null}
        <StatusPair
          label="Started"
          value={runtime.startedAt ? formatShortTime(runtime.startedAt) : 'Not running'}
        />
        <StatusPair
          label="Last output"
          value={runtime.lastOutputAt ? formatShortTime(runtime.lastOutputAt) : 'No output'}
        />
      </div>

      {showWorkbench ? (
        <SessionWorkbench
          session={session}
          terminalFocusRequest={terminalFocusRequest}
          onLaunchClaude={onLaunchClaude}
          onSelectDirectory={onSelectDirectory}
          shellKind={shellKind}
          shellOptions={shellOptions}
          onUpdateShellKind={onUpdateShellKind}
          onStartShell={onStartShell}
          onStopSession={onStopSession}
          onUpdateSessionConfiguration={onUpdateSessionConfiguration}
          terminalBridge={terminalBridge}
          terminalReplayStore={terminalReplayStore}
        />
      ) : null}

      <footer className="bay-actions">
        {isCompact ? (
          <>
            <button
              className="control-button primary"
              type="button"
              onClick={() => {
                if (runtime.processState === 'empty' || !configuration.workingDirectory) {
                  void onSelectDirectory(configuration.id);
                } else {
                  void onLaunchClaude(configuration.id, selectedLaunchMode);
                }
              }}
            >
              <Play size={15} aria-hidden="true" />
              <span>{runtime.processState === 'empty' ? 'Select Directory' : 'Launch'}</span>
            </button>
            {configuration.workingDirectory ? (
              <select
                className="launch-mode-select"
                aria-label={`${configuration.name} launch mode`}
                value={selectedLaunchMode}
                onChange={(event) => setSelectedLaunchMode(event.target.value as SessionLaunchMode)}
              >
                <option value="new">New</option>
                <option value="continueMostRecent">Continue</option>
                <option value="resumeSpecific">Resume...</option>
              </select>
            ) : null}
            <div className="shell-launch-control">
              <select
                className="shell-select"
                aria-label={`${configuration.name} default shell for all new shell launches`}
                title="Default shell for all new shell launches"
                value={shellKind}
                onChange={(event) => onUpdateShellKind(event.currentTarget.value as ShellKind)}
              >
                {shellOptions.map((option) => (
                  <option key={option.kind} value={option.kind} disabled={!option.available}>
                    {option.label}
                    {option.available ? '' : ' (not found)'}
                  </option>
                ))}
              </select>
              <button
                className="control-button"
                type="button"
                disabled={directoryChangeDisabled || !selectedShellAvailable}
                onClick={() => {
                  void onStartShell(configuration.id, shellKind);
                }}
              >
                <TerminalSquare size={15} aria-hidden="true" />
                <span>Shell</span>
              </button>
            </div>
            <button
              className="icon-button quiet"
              type="button"
              title="Stop session"
              aria-label="Stop session"
              onClick={() => {
                void onStopSession(configuration.id);
              }}
            >
              <Square size={14} aria-hidden="true" />
            </button>
          </>
        ) : null}
        <button
          className="icon-button quiet"
          type="button"
          title={
            directoryChangeDisabled
              ? 'Stop the session before changing directory'
              : 'Change directory'
          }
          aria-label="Change directory"
          disabled={directoryChangeDisabled}
          onClick={() => {
            void onSelectDirectory(configuration.id);
          }}
        >
          <FolderPen size={15} aria-hidden="true" />
        </button>
        <button
          className="icon-button quiet"
          type="button"
          title={
            configuration.workingDirectory
              ? 'Open directory in File Explorer'
              : 'No directory selected'
          }
          aria-label="Open directory"
          disabled={!configuration.workingDirectory}
          onClick={() => {
            void onOpenDirectory(configuration.id);
          }}
        >
          <FolderOpen size={15} aria-hidden="true" />
        </button>
        {runtime.processState === 'crashed' || runtime.processState === 'error' ? (
          <span className="bay-warning">
            <AlertTriangle size={14} aria-hidden="true" />
            Exit {runtime.exitCode ?? 'unknown'}
          </span>
        ) : null}
      </footer>
    </article>
  );
}

function StatusPair({
  label,
  value,
  attention = false,
}: {
  label: string;
  value: string;
  attention?: boolean;
}) {
  return (
    <span className={attention ? 'meta-pair attention' : 'meta-pair'}>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function formatShortTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
