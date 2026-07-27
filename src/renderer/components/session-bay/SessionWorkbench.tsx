import { FolderPen, Play, RotateCcw, Square, TerminalSquare } from 'lucide-react';
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
import { TerminalPane } from '../terminal/TerminalPane';

interface SessionWorkbenchProps {
  session: SessionSnapshot;
  terminalFocusRequest: number;
  onLaunchClaude: (sessionId: SessionId, launchMode: SessionLaunchMode) => void;
  onSelectDirectory: (sessionId: SessionId) => void;
  shellKind: ShellKind;
  shellOptions: ShellOption[];
  onUpdateShellKind: (shellKind: ShellKind) => void;
  onStartShell: (sessionId: SessionId, shellKind: ShellKind) => void;
  onStopSession: (sessionId: SessionId) => void;
  onUpdateSessionConfiguration: (configuration: SessionConfiguration) => void;
  terminalBridge: TerminalBridge;
  terminalReplayStore: TerminalReplayStore;
}

const presetModels = [
  { value: '', label: 'Default model' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
];

export function SessionWorkbench({
  session,
  terminalFocusRequest,
  onLaunchClaude,
  onSelectDirectory,
  shellKind,
  shellOptions,
  onUpdateShellKind,
  onStartShell,
  onStopSession,
  onUpdateSessionConfiguration,
  terminalBridge,
  terminalReplayStore,
}: SessionWorkbenchProps) {
  const { configuration, runtime } = session;
  const hasDirectory = configuration.workingDirectory.trim().length > 0;
  const processActive = ['starting', 'running', 'restarting', 'stopping'].includes(
    runtime.processState,
  );
  const processAttached =
    processActive || (runtime.processState === 'error' && runtime.processType !== undefined);
  const launchBlocked =
    ['starting', 'restarting', 'stopping'].includes(runtime.processState) ||
    (runtime.processState === 'error' && processAttached);
  const primaryMode: SessionLaunchMode = configuration.hasNamedConversation
    ? 'continueMostRecent'
    : configuration.launchMode === 'continueMostRecent'
      ? 'continueMostRecent'
      : 'new';
  const primaryContinues = primaryMode === 'continueMostRecent';
  const presetModel = presetModels.find(
    (option) => option.value === configuration.model.trim().toLowerCase(),
  );
  const customModel = configuration.model && !presetModel;
  const selectedShellAvailable =
    shellOptions.find((option) => option.kind === shellKind)?.available ?? shellKind === 'auto';

  return (
    <section className="session-workbench" aria-label={`${configuration.name} session controls`}>
      <div className="workbench-toolbar">
        <span className={`workbench-status state-${runtime.processState}`}>
          {runtime.activityState === 'active' ? 'Claude is working' : runtime.statusMessage}
        </span>

        <div className="workbench-actions" aria-label={`${configuration.name} actions`}>
          <select
            className="model-select"
            aria-label={`${configuration.name} model`}
            title="Model for the next Claude launch"
            value={presetModel?.value ?? configuration.model}
            onChange={(event) =>
              onUpdateSessionConfiguration({
                ...configuration,
                model: event.currentTarget.value,
              })
            }
          >
            {presetModels.map((option) => (
              <option key={option.value || 'default'} value={option.value}>
                {option.label}
              </option>
            ))}
            {customModel ? (
              <option value={configuration.model}>{configuration.model}</option>
            ) : null}
          </select>

          {!hasDirectory ? (
            <button
              className="control-button primary"
              type="button"
              onClick={() => onSelectDirectory(configuration.id)}
            >
              <FolderPen size={15} aria-hidden="true" />
              <span>Choose Directory</span>
            </button>
          ) : (
            <>
              <button
                className="control-button primary"
                type="button"
                disabled={launchBlocked}
                onClick={() => onLaunchClaude(configuration.id, primaryMode)}
              >
                {primaryContinues ? (
                  <RotateCcw size={15} aria-hidden="true" />
                ) : (
                  <Play size={15} aria-hidden="true" />
                )}
                <span>{primaryContinues ? 'Continue' : 'Start Claude'}</span>
              </button>
              <button
                className="control-button"
                type="button"
                disabled={launchBlocked}
                onClick={() => onLaunchClaude(configuration.id, 'new')}
              >
                <Play size={15} aria-hidden="true" />
                <span>New</span>
              </button>
              <button
                className="control-button"
                type="button"
                disabled={launchBlocked}
                onClick={() => onLaunchClaude(configuration.id, 'resumeSpecific')}
              >
                <RotateCcw size={15} aria-hidden="true" />
                <span>Resume…</span>
              </button>
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
                  disabled={processAttached || !selectedShellAvailable}
                  onClick={() => onStartShell(configuration.id, shellKind)}
                >
                  <TerminalSquare size={15} aria-hidden="true" />
                  <span>Shell</span>
                </button>
              </div>
            </>
          )}
          <button
            className="control-button"
            type="button"
            disabled={!processAttached}
            onClick={() => onStopSession(configuration.id)}
          >
            <Square size={14} aria-hidden="true" />
            <span>Stop</span>
          </button>
        </div>
      </div>

      <TerminalPane
        session={session}
        active
        focusRequest={terminalFocusRequest}
        terminalBridge={terminalBridge}
        terminalReplayStore={terminalReplayStore}
      />
    </section>
  );
}
