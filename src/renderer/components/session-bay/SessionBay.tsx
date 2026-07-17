import {
  AlertTriangle,
  FolderOpen,
  Maximize2,
  MoreHorizontal,
  Play,
  RotateCcw,
  Square,
  TerminalSquare,
} from 'lucide-react';
import type { SessionId, SessionSnapshot } from '../../../shared/domain/types';
import type { TerminalBridge } from '../../../shared/ipc/contracts';
import { TerminalPane } from '../terminal/TerminalPane';

interface SessionBayProps {
  session: SessionSnapshot;
  isFocused: boolean;
  isCompact?: boolean;
  isLarge?: boolean;
  onFocus: () => void;
  onToggleFocusMode: () => void;
  onOpenSettings: () => void;
  onStartShell: (sessionId: SessionId) => void;
  onStartClaude: (sessionId: SessionId) => void;
  onReloadContinue: (sessionId: SessionId) => void;
  onFreshRestart: (sessionId: SessionId) => void;
  onSelectDirectory: (sessionId: SessionId) => void;
  onStopSession: (sessionId: SessionId) => void;
  terminalBridge: TerminalBridge;
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
  authenticationMayBeRequired: 'Authentication may be required',
};

export function SessionBay({
  session,
  isFocused,
  isCompact = false,
  isLarge = false,
  onFocus,
  onToggleFocusMode,
  onOpenSettings,
  onStartShell,
  onStartClaude,
  onReloadContinue,
  onFreshRestart,
  onSelectDirectory,
  onStopSession,
  terminalBridge,
}: SessionBayProps) {
  const { configuration, runtime } = session;
  const isAttention =
    runtime.attention ||
    runtime.activityState === 'possiblePermissionPrompt' ||
    runtime.activityState === 'authenticationMayBeRequired';
  const showTerminal = !isCompact;

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
        <button
          className="bay-title"
          type="button"
          onClick={onFocus}
          title={configuration.workingDirectory || 'No directory selected'}
        >
          <span className="status-dot" aria-hidden="true" />
          <span>
            <strong>{configuration.name}</strong>
          </span>
        </button>
        <div className="bay-header-actions">
          {configuration.workingDirectory && runtime.sameProject ? (
            <span className="same-project">Same project</span>
          ) : null}
          <button
            className="icon-button quiet"
            type="button"
            title="Focus session"
            aria-label={`Focus ${configuration.name}`}
            onClick={onToggleFocusMode}
          >
            <Maximize2 size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="bay-meta">
        <StatusPair label="Process" value={processLabels[runtime.processState]} />
        <StatusPair
          label="Activity"
          value={activityLabels[runtime.activityState]}
          attention={isAttention}
        />
        <StatusPair
          label="Started"
          value={runtime.startedAt ? formatShortTime(runtime.startedAt) : 'Not running'}
        />
        <StatusPair
          label="Last output"
          value={runtime.lastOutputAt ? formatShortTime(runtime.lastOutputAt) : 'No output'}
        />
      </div>

      {showTerminal ? <TerminalPane session={session} terminalBridge={terminalBridge} /> : null}

      <footer className="bay-actions">
        <button
          className="control-button primary"
          type="button"
          onClick={() => {
            if (runtime.processState === 'empty' || !configuration.workingDirectory) {
              void onSelectDirectory(configuration.id);
            } else {
              void onStartClaude(configuration.id);
            }
          }}
        >
          <Play size={15} aria-hidden="true" />
          <span>{runtime.processState === 'empty' ? 'Select Directory' : 'Start Claude'}</span>
        </button>
        <button
          className="control-button"
          type="button"
          onClick={() => {
            void onStartShell(configuration.id);
          }}
        >
          <TerminalSquare size={15} aria-hidden="true" />
          <span>Shell</span>
        </button>
        <button
          className="control-button"
          type="button"
          onClick={() => {
            void onReloadContinue(configuration.id);
          }}
        >
          <RotateCcw size={15} aria-hidden="true" />
          <span>Reload & Continue</span>
        </button>
        <button
          className="control-button"
          type="button"
          onClick={() => {
            void onFreshRestart(configuration.id);
          }}
        >
          <RotateCcw size={15} aria-hidden="true" />
          <span>Fresh</span>
        </button>
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
        <button
          className="icon-button quiet"
          type="button"
          title="Open session settings"
          aria-label="Open session settings"
          onClick={onOpenSettings}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
        <button
          className="icon-button quiet"
          type="button"
          title="Open directory"
          aria-label="Open directory"
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
