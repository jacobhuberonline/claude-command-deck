import {
  BellOff,
  CircleAlert,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCcw,
  Settings,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  AudioPreferences,
  AuthStateSnapshot,
  SessionSnapshot,
} from '../../../shared/domain/types';
import type { MonthlyUsageSnapshot } from '../../app/App';

interface CommandBarProps {
  appVersion: string;
  auth: AuthStateSnapshot;
  usage: MonthlyUsageSnapshot | null;
  usageEnabled: boolean;
  usageUrl: string;
  onOpenUsage: () => void;
  sessions: SessionSnapshot[];
  audio: AudioPreferences;
  focusMode: boolean;
  onOpenSettings: () => void;
  onAddSession: () => void;
  onAuthAction: () => void;
  onToggleAudio: () => void;
}

export function CommandBar({
  appVersion,
  auth,
  usage,
  usageEnabled,
  usageUrl,
  onOpenUsage,
  sessions,
  audio,
  focusMode,
  onOpenSettings,
  onAddSession,
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
          <CommandDeckMark />
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
        {focusMode ? (
          <button
            className="control-button primary"
            type="button"
            title="Add a Claude session directory (Alt+N)"
            aria-label="Add session"
            onClick={onAddSession}
          >
            <Plus size={16} aria-hidden="true" />
            <span>Session</span>
          </button>
        ) : null}
        {usageEnabled ? (
          <button
            className={`metric metric-link usage-pill metric-${usage ? usageTone(usage) : 'neutral'}`}
            type="button"
            title={
              usage
                ? `${usage.limitUsd !== null ? `Limit ${formatUsd(usage.limitUsd)}. ` : ''}Updated ${formatObservedAt(usage.observedAt)}. Open AI Sentinel for details.`
                : `Open AI Sentinel (${usageUrl}) for your monthly usage.`
            }
            onClick={onOpenUsage}
          >
            <span>This month</span>
            <strong>{usage ? formatUsd(usage.amountUsd) : '--'}</strong>
          </button>
        ) : null}
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
          aria-label={`Open credential monitor. ${auth.label}: ${auth.details}`}
          disabled={authBusy}
          onClick={onAuthAction}
        >
          <AuthStatusIcon status={auth.status} spinning={authBusy} />
        </button>
      </div>
    </header>
  );
}

function CommandDeckMark() {
  return (
    <svg
      className="command-deck-mark"
      viewBox="0 0 24 24"
      width="19"
      height="19"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="3.2"
        y="3.2"
        width="17.6"
        height="17.6"
        rx="4.2"
        fill="var(--surface-2)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M7 8h3.7M13.3 8H17M7 12h3.7M13.3 12H17"
        stroke="var(--line-strong)"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path
        d="M7.3 16.2l2.05-1.9-2.05-1.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M11.45 16.25h4.1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="17.25" cy="16.2" r="1.45" fill="var(--green)" />
    </svg>
  );
}

type MetricTone = 'neutral' | 'warning' | 'danger';

function Metric({
  label,
  value,
  tone = 'neutral',
  title,
}: {
  label: string;
  value: number | string;
  tone?: MetricTone;
  title?: string;
}) {
  return (
    <span className={`metric metric-${tone}`} title={title}>
      <strong>{value}</strong>
      <span>{label}</span>
    </span>
  );
}

function usageTone(usage: MonthlyUsageSnapshot): MetricTone {
  if (usage.limitUsd === null || usage.limitUsd <= 0) {
    return 'neutral';
  }

  const ratio = usage.amountUsd / usage.limitUsd;
  if (ratio >= 1) {
    return 'danger';
  }
  if (ratio >= 0.8) {
    return 'warning';
  }
  return 'neutral';
}

function formatUsd(amount: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatObservedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
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
