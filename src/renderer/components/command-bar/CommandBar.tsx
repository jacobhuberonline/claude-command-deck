import {
  BellOff,
  CircleAlert,
  CheckCircle2,
  Gauge,
  Loader2,
  RefreshCcw,
  RotateCcw,
  Settings,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  AudioPreferences,
  AuthStateSnapshot,
  SessionSnapshot,
} from '../../../shared/domain/types';

interface CommandBarProps {
  appVersion: string;
  auth: AuthStateSnapshot;
  sessions: SessionSnapshot[];
  audio: AudioPreferences;
  onOpenSettings: () => void;
  onToggleFocusMode: () => void;
  onReloadAll: () => void;
  onAuthAction: () => void;
  onToggleAudio: () => void;
}

export function CommandBar({
  appVersion,
  auth,
  sessions,
  audio,
  onOpenSettings,
  onToggleFocusMode,
  onReloadAll,
  onAuthAction,
  onToggleAudio,
}: CommandBarProps) {
  const running = sessions.filter((session) => session.runtime.processState === 'running').length;
  const busy = sessions.filter((session) => session.runtime.activityState === 'active').length;
  const awaiting = sessions.filter(
    (session) =>
      session.runtime.activityState === 'likelyAwaitingInput' ||
      session.runtime.activityState === 'possiblePermissionPrompt',
  ).length;
  const attention = sessions.filter((session) => session.runtime.attention).length;
  const AudioIcon = audio.masterEnabled ? Volume2 : VolumeX;
  const authBusy = auth.status === 'checking' || auth.status === 'refreshing';

  return (
    <header className="command-bar">
      <div className="brand-block" aria-label={`Claude Command Deck version ${appVersion}`}>
        <div className="brand-mark" aria-hidden="true">
          <Gauge size={18} />
        </div>
        <div>
          <h1>Claude Command Deck</h1>
        </div>
      </div>

      <div className="count-strip" aria-label="Session counts">
        <Metric label="Running" value={running} />
        <Metric label="Busy" value={busy} />
        <Metric label="Awaiting" value={awaiting} />
        <Metric label="Attention" value={attention} tone={attention > 0 ? 'warning' : 'neutral'} />
      </div>

      <div className="command-actions">
        <button
          className="control-button primary"
          type="button"
          title="Reload All sessions"
          aria-label="Reload All sessions"
          onClick={onReloadAll}
        >
          <RotateCcw size={16} aria-hidden="true" />
          <span>Reload All</span>
        </button>
        <button
          className="icon-button"
          type="button"
          title={audio.masterEnabled ? 'Mute sounds' : 'Unmute sounds'}
          aria-label={audio.masterEnabled ? 'Mute sounds' : 'Unmute sounds'}
          onClick={onToggleAudio}
        >
          <AudioIcon size={17} aria-hidden="true" />
        </button>
        {audio.doNotDisturb ? (
          <span className="dnd-indicator" title="Do Not Disturb active">
            <BellOff size={15} aria-hidden="true" />
            DND
          </span>
        ) : null}
        <button
          className="icon-button"
          type="button"
          title="Toggle focused-session mode"
          aria-label="Toggle focused-session mode"
          onClick={onToggleFocusMode}
        >
          <Gauge size={17} aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Open Settings"
          aria-label="Open Settings"
          onClick={onOpenSettings}
        >
          <Settings size={17} aria-hidden="true" />
        </button>
        <button
          className={`icon-button auth-status-icon auth-${auth.status}`}
          type="button"
          title={`${auth.label}: ${auth.details}`}
          aria-label={auth.status === 'connected' ? 'Check Connection' : 'Connect Authentication'}
          disabled={authBusy}
          onClick={onAuthAction}
        >
          <AuthStatusIcon status={auth.status} spinning={authBusy} />
        </button>
      </div>
    </header>
  );
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'warning';
}) {
  return (
    <span className={`metric metric-${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </span>
  );
}

function AuthStatusIcon({
  status,
  spinning,
}: {
  status: AuthStateSnapshot['status'];
  spinning: boolean;
}) {
  if (status === 'connected') {
    return <CheckCircle2 size={17} aria-hidden="true" />;
  }

  if (status === 'checking' || status === 'refreshing') {
    return <Loader2 className={spinning ? 'spin' : ''} size={17} aria-hidden="true" />;
  }

  if (status === 'disconnected' || status === 'error' || status === 'expiringSoon') {
    return <CircleAlert size={17} aria-hidden="true" />;
  }

  return <RefreshCcw size={17} aria-hidden="true" />;
}
