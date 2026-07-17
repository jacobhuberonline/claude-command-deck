import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { FolderPen, Play, RotateCcw, Send, Square, TerminalSquare } from 'lucide-react';
import type {
  ProcessState,
  SessionId,
  SessionLaunchMode,
  SessionSnapshot,
} from '../../../shared/domain/types';
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
  const [prompt, setPrompt] = useState('');
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const hasDirectory = configuration.workingDirectory.trim().length > 0;
  const canStop = ['starting', 'running', 'restarting', 'stopping'].includes(runtime.processState);
  const isClaudeRuntime =
    runtime.processType === undefined || runtime.processType === 'claudeSession';
  const canSendPrompt = runtime.processState === 'running' && isClaudeRuntime;
  const promptDisabled = !canSendPrompt;

  const submitPrompt = async () => {
    const value = prompt.trimEnd();
    if (!value.trim() || promptDisabled) {
      return;
    }

    const result = await terminalBridge.write({
      sessionId: configuration.id,
      data: `${value}\r`,
    });

    if (!result.ok) {
      setPromptError(result.error);
      return;
    }

    setPrompt('');
    setPromptError(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitPrompt();
  };

  const onPromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt();
    }
  };

  const startShell = () => {
    setConsoleOpen(true);
    onStartShell(configuration.id);
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
              <button
                className="control-button"
                type="button"
                onClick={() => onLaunchClaude(configuration.id, 'resumeSpecific')}
              >
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
          <button
            className="control-button"
            type="button"
            onClick={() => setConsoleOpen((current) => !current)}
          >
            <TerminalSquare size={15} aria-hidden="true" />
            <span>{consoleOpen ? 'Hide Console' : 'Console'}</span>
          </button>
        </div>
      </div>

      <form className="prompt-composer" onSubmit={onSubmit}>
        <textarea
          aria-label={`Prompt ${configuration.name}`}
          value={prompt}
          disabled={promptDisabled}
          placeholder={promptPlaceholder(hasDirectory, runtime.processState, runtime.processType)}
          onChange={(event) => {
            setPrompt(event.currentTarget.value);
            setPromptError(null);
          }}
          onKeyDown={onPromptKeyDown}
        />
        <button
          className="control-button primary"
          type="submit"
          disabled={promptDisabled || !prompt.trim()}
          aria-label={`Send prompt to ${configuration.name}`}
        >
          <Send size={15} aria-hidden="true" />
          <span>Send</span>
        </button>
      </form>
      {promptError ? <span className="prompt-error">{promptError}</span> : null}

      {runtime.outputPreview ? (
        <div className="workbench-output" aria-label={`${configuration.name} output`}>
          <pre>{runtime.outputPreview}</pre>
        </div>
      ) : null}

      {consoleOpen ? <TerminalPane session={session} terminalBridge={terminalBridge} /> : null}
    </section>
  );
}

function promptPlaceholder(
  hasDirectory: boolean,
  processState: ProcessState,
  processType: SessionSnapshot['runtime']['processType'],
) {
  if (!hasDirectory) {
    return 'Select a directory first';
  }

  if (processType === 'shellSession') {
    return 'Shell input uses Console';
  }

  if (processState !== 'running') {
    return 'Start Claude to send prompts';
  }

  return 'Type a prompt for Claude';
}
