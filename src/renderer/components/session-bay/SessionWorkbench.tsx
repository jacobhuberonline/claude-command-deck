import { FolderPen, Play, RotateCcw, Square, TerminalSquare } from 'lucide-react';
import type { SessionId, SessionLaunchMode, SessionSnapshot } from '../../../shared/domain/types';
import type { TerminalBridge } from '../../../shared/ipc/contracts';
import { TerminalPane } from '../terminal/TerminalPane';

interface SessionWorkbenchProps {
  session: SessionSnapshot;
  onLaunchClaude: (sessionId: SessionId, launchMode: SessionLaunchMode) => void;
  onSelectDirectory: (sessionId: SessionId) => void;
  onStartShell: (sessionId: SessionId) => void;
  onStopSession: (sessionId: SessionId) => void;
  terminalBridge: TerminalBridge;
}

export function SessionWorkbench({
  session,
  onLaunchClaude,
  onSelectDirectory,
  onStartShell,
  onStopSession,
  terminalBridge,
}: SessionWorkbenchProps) {
  const { configuration, runtime } = session;
  const hasDirectory = configuration.workingDirectory.trim().length > 0;
  const canStop = ['starting', 'running', 'restarting', 'stopping'].includes(runtime.processState);

  const startShell = () => {
    onStartShell(configuration.id);
  };

  const resumeClaude = () => {
    window.setTimeout(() => onLaunchClaude(configuration.id, 'resumeSpecific'), 0);
  };

  return (
    <section className="session-workbench" aria-label={`${configuration.name} session controls`}>
      <div className="workbench-toolbar">
        <span className={`workbench-status state-${runtime.processState}`}>
          {runtime.activityState === 'active' ? 'Claude is working' : runtime.statusMessage}
        </span>

        <div className="workbench-actions" aria-label={`${configuration.name} actions`}>
          {!hasDirectory ? (
            <button
              className="control-button primary"
              type="button"
              onClick={() => onSelectDirectory(configuration.id)}
            >
              <FolderPen size={15} aria-hidden="true" />
              <span>Directory</span>
            </button>
          ) : (
            <>
              <button
                className="control-button primary"
                type="button"
                onClick={() => onLaunchClaude(configuration.id, 'continueMostRecent')}
              >
                <RotateCcw size={15} aria-hidden="true" />
                <span>Continue</span>
              </button>
              <button
                className="control-button"
                type="button"
                onClick={() => onLaunchClaude(configuration.id, 'new')}
              >
                <Play size={15} aria-hidden="true" />
                <span>New</span>
              </button>
              <button className="control-button" type="button" onClick={resumeClaude}>
                <RotateCcw size={15} aria-hidden="true" />
                <span>Resume</span>
              </button>
              <button className="control-button" type="button" onClick={startShell}>
                <TerminalSquare size={15} aria-hidden="true" />
                <span>Shell</span>
              </button>
            </>
          )}
          <button
            className="control-button"
            type="button"
            disabled={!canStop}
            onClick={() => onStopSession(configuration.id)}
          >
            <Square size={14} aria-hidden="true" />
            <span>Stop</span>
          </button>
        </div>
      </div>

      <TerminalPane session={session} terminalBridge={terminalBridge} />
    </section>
  );
}
