import { X } from 'lucide-react';
import type {
  AppStateSnapshot,
  AuthConfiguration,
  AuthProvider,
  AudioEvent,
  AudioPreferences,
  NotificationPreferences,
  SessionAudioPreferences,
  SessionId,
  SettingsSection,
} from '../../../shared/domain/types';
import { buildSanitizedDiagnosticsReport } from '../../services/diagnostics/DiagnosticsReport';

interface SettingsPanelProps {
  appState: AppStateSnapshot;
  section: SettingsSection | null;
  onSelectSection: (section: SettingsSection) => void;
  onClose: () => void;
  onUpdateAuthConfiguration: (auth: AuthConfiguration) => void;
  onUpdateAudioPreferences: (preferences: AudioPreferences) => void;
  onUpdateNotificationPreferences: (preferences: NotificationPreferences) => void;
  onUpdateSessionAudioPreferences: (
    sessionId: SessionId,
    preferences: SessionAudioPreferences,
  ) => void;
  onTestAudio: (event: AudioEvent) => void;
  onRerunDiagnostics: () => void;
  onOpenLogDirectory: () => void;
}

const sections: Array<{ id: SettingsSection; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'shell', label: 'Shell' },
  { id: 'authentication', label: 'Authentication' },
  { id: 'audio', label: 'Audio' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

export function SettingsPanel({
  appState,
  section,
  onSelectSection,
  onClose,
  onUpdateAuthConfiguration,
  onUpdateAudioPreferences,
  onUpdateNotificationPreferences,
  onUpdateSessionAudioPreferences,
  onTestAudio,
  onRerunDiagnostics,
  onOpenLogDirectory,
}: SettingsPanelProps) {
  if (!section) {
    return null;
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <section
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-header">
          <div>
            <h2 id="settings-title">Settings</h2>
            <span>Schema v{appState.settings.schemaVersion}</span>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close Settings"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {sections.map((item) => (
              <button
                key={item.id}
                className={item.id === section ? 'selected' : ''}
                type="button"
                onClick={() => onSelectSection(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            <SettingsSectionContent
              appState={appState}
              section={section}
              onUpdateAuthConfiguration={onUpdateAuthConfiguration}
              onUpdateAudioPreferences={onUpdateAudioPreferences}
              onUpdateNotificationPreferences={onUpdateNotificationPreferences}
              onUpdateSessionAudioPreferences={onUpdateSessionAudioPreferences}
              onTestAudio={onTestAudio}
              onRerunDiagnostics={onRerunDiagnostics}
              onOpenLogDirectory={onOpenLogDirectory}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function SettingsSectionContent({
  appState,
  section,
  onUpdateAudioPreferences,
  onUpdateAuthConfiguration,
  onUpdateNotificationPreferences,
  onUpdateSessionAudioPreferences,
  onTestAudio,
  onRerunDiagnostics,
  onOpenLogDirectory,
}: {
  appState: AppStateSnapshot;
  section: SettingsSection;
  onUpdateAudioPreferences: (preferences: AudioPreferences) => void;
  onUpdateAuthConfiguration: (auth: AuthConfiguration) => void;
  onUpdateNotificationPreferences: (preferences: NotificationPreferences) => void;
  onUpdateSessionAudioPreferences: (
    sessionId: SessionId,
    preferences: SessionAudioPreferences,
  ) => void;
  onTestAudio: (event: AudioEvent) => void;
  onRerunDiagnostics: () => void;
  onOpenLogDirectory: () => void;
}) {
  if (section === 'authentication') {
    return (
      <AuthenticationSettings auth={appState.settings.auth} onUpdate={onUpdateAuthConfiguration} />
    );
  }

  if (section === 'audio') {
    return (
      <AudioSettings
        appState={appState}
        onUpdateAudioPreferences={onUpdateAudioPreferences}
        onUpdateSessionAudioPreferences={onUpdateSessionAudioPreferences}
        onTestAudio={onTestAudio}
      />
    );
  }

  if (section === 'notifications') {
    return (
      <NotificationSettings
        preferences={appState.settings.notifications}
        onUpdate={onUpdateNotificationPreferences}
      />
    );
  }

  if (section === 'diagnostics') {
    return (
      <>
        <h3>Diagnostics</h3>
        <div className="settings-action-grid">
          <button className="control-button" type="button" onClick={onOpenLogDirectory}>
            Open Log Directory
          </button>
          <button
            className="control-button"
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(buildSanitizedDiagnosticsReport(appState));
            }}
          >
            Copy Sanitized Diagnostics
          </button>
          <button className="control-button" type="button" onClick={onRerunDiagnostics}>
            Rerun Diagnostics
          </button>
        </div>
        {appState.diagnostics.map((check) => (
          <div className={`diagnostic-row diagnostic-${check.status}`} key={check.id}>
            <strong>{check.label}</strong>
            <span>{check.detail}</span>
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      <h3>{sections.find((item) => item.id === section)?.label}</h3>
      <Field label="Claude executable" value={appState.settings.claudeExecutable} />
      <Field label="Shell executable" value={appState.settings.shellExecutable} />
      <Field label="Restore running sessions" value="Disabled by default" />
    </>
  );
}

const soundTests: Array<{ event: AudioEvent; label: string }> = [
  { event: 'session.ready', label: 'Session ready' },
  { event: 'session.estimated_completion', label: 'Estimated completion' },
  { event: 'session.possible_permission_prompt', label: 'Attention' },
  { event: 'auth.connected', label: 'Auth connected' },
  { event: 'auth.disconnected', label: 'Auth disconnected' },
  { event: 'session.crashed', label: 'Error' },
  { event: 'reload_all.completed', label: 'Reload All complete' },
  { event: 'reload_all.partially_failed', label: 'Reload All warning' },
];

function AuthenticationSettings({
  auth,
  onUpdate,
}: {
  auth: AuthConfiguration;
  onUpdate: (auth: AuthConfiguration) => void;
}) {
  const update = (patch: Partial<AuthConfiguration>) => onUpdate({ ...auth, ...patch });

  return (
    <>
      <h3>Authentication</h3>
      <label className="settings-field">
        <span>Provider</span>
        <select
          className="settings-text-input"
          value={auth.provider}
          onChange={(event) => update({ provider: event.currentTarget.value as AuthProvider })}
        >
          <option value="aws">AWS</option>
          <option value="custom">Custom</option>
          <option value="disabled">Disabled</option>
        </select>
      </label>
      <TextField
        label="Check executable"
        value={auth.checkExecutable}
        placeholder="aws"
        onChange={(value) => update({ checkExecutable: value })}
      />
      <ArgsField
        label="Check arguments"
        value={auth.checkArgs}
        placeholder={'sts\nget-caller-identity\n--output\njson'}
        onChange={(value) => update({ checkArgs: value })}
      />
      <TextField
        label="Refresh executable"
        value={auth.refreshExecutable}
        placeholder="aws"
        onChange={(value) => update({ refreshExecutable: value })}
      />
      <ArgsField
        label="Refresh arguments"
        value={auth.refreshArgs}
        placeholder={'sso\nlogin'}
        onChange={(value) => update({ refreshArgs: value })}
      />
      <TextField
        label="Working directory"
        value={auth.workingDirectory}
        placeholder="Leave blank to use the app directory"
        onChange={(value) => update({ workingDirectory: value })}
      />
      <ToggleField
        label="Shell mode"
        enabled={auth.shellMode}
        onToggle={() => update({ shellMode: !auth.shellMode })}
      />
      <NumberField
        label="Check interval"
        value={auth.checkIntervalSeconds}
        min={30}
        max={86400}
        suffix="s"
        onChange={(value) => update({ checkIntervalSeconds: value })}
      />
      <NumberField
        label="Check timeout"
        value={auth.checkTimeoutSeconds}
        min={1}
        max={600}
        suffix="s"
        onChange={(value) => update({ checkTimeoutSeconds: value })}
      />
      <ToggleField
        label="Startup checks"
        enabled={auth.startupChecksEnabled}
        onToggle={() => update({ startupChecksEnabled: !auth.startupChecksEnabled })}
      />
    </>
  );
}

function AudioSettings({
  appState,
  onUpdateAudioPreferences,
  onUpdateSessionAudioPreferences,
  onTestAudio,
}: {
  appState: AppStateSnapshot;
  onUpdateAudioPreferences: (preferences: AudioPreferences) => void;
  onUpdateSessionAudioPreferences: (
    sessionId: SessionId,
    preferences: SessionAudioPreferences,
  ) => void;
  onTestAudio: (event: AudioEvent) => void;
}) {
  const audio = appState.settings.audio;
  const update = (patch: Partial<AudioPreferences>) =>
    onUpdateAudioPreferences({ ...audio, ...patch });

  return (
    <>
      <h3>Audio</h3>
      <ToggleField
        label="Master sounds"
        enabled={audio.masterEnabled}
        onToggle={() => update({ masterEnabled: !audio.masterEnabled })}
      />
      <RangeField
        label="Master volume"
        value={Math.round(audio.masterVolume * 100)}
        min={0}
        max={100}
        suffix="%"
        onChange={(value) => update({ masterVolume: value / 100 })}
      />
      <ToggleField
        label="Do Not Disturb"
        enabled={audio.doNotDisturb}
        onToggle={() => update({ doNotDisturb: !audio.doNotDisturb })}
      />
      <ToggleField
        label="Routine focus suppression"
        enabled={audio.onlyWhenUnfocused}
        onToggle={() => update({ onlyWhenUnfocused: !audio.onlyWhenUnfocused })}
      />
      <ToggleField
        label="Session-ready sounds"
        enabled={audio.sessionReadyEnabled}
        onToggle={() => update({ sessionReadyEnabled: !audio.sessionReadyEnabled })}
      />
      <ToggleField
        label="Completion sounds"
        enabled={audio.completionEnabled}
        onToggle={() => update({ completionEnabled: !audio.completionEnabled })}
      />
      <ToggleField
        label="Attention sounds"
        enabled={audio.attentionEnabled}
        onToggle={() => update({ attentionEnabled: !audio.attentionEnabled })}
      />
      <ToggleField
        label="Authentication sounds"
        enabled={audio.authenticationEnabled}
        onToggle={() => update({ authenticationEnabled: !audio.authenticationEnabled })}
      />
      <ToggleField
        label="Error sounds"
        enabled={audio.errorEnabled}
        onToggle={() => update({ errorEnabled: !audio.errorEnabled })}
      />
      <RangeField
        label="Sound cooldown"
        value={audio.cooldownMs}
        min={0}
        max={60000}
        step={500}
        suffix="ms"
        onChange={(value) => update({ cooldownMs: value })}
      />
      <RangeField
        label="Minimum active duration"
        value={audio.minimumActivityMs}
        min={0}
        max={60000}
        step={1000}
        suffix="ms"
        onChange={(value) => update({ minimumActivityMs: value })}
      />
      <ToggleField
        label="Quiet hours"
        enabled={audio.quietHours.enabled}
        onToggle={() =>
          update({
            quietHours: {
              ...audio.quietHours,
              enabled: !audio.quietHours.enabled,
            },
          })
        }
      />
      <TimeField
        label="Quiet start"
        value={audio.quietHours.startTime}
        onChange={(value) => update({ quietHours: { ...audio.quietHours, startTime: value } })}
      />
      <TimeField
        label="Quiet end"
        value={audio.quietHours.endTime}
        onChange={(value) => update({ quietHours: { ...audio.quietHours, endTime: value } })}
      />
      <div className="settings-field settings-field-stack">
        <span>Test sounds</span>
        <div className="settings-action-grid">
          {soundTests.map((sound) => (
            <button
              className="control-button"
              type="button"
              key={sound.event}
              onClick={() => onTestAudio(sound.event)}
            >
              {sound.label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-field settings-field-stack">
        <span>Per-session audio</span>
        <div className="session-audio-list">
          {appState.sessions.map((session) => (
            <SessionAudioRow
              key={session.configuration.id}
              sessionId={session.configuration.id}
              name={session.configuration.name}
              preferences={session.configuration.audio}
              onUpdate={onUpdateSessionAudioPreferences}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function NotificationSettings({
  preferences,
  onUpdate,
}: {
  preferences: NotificationPreferences;
  onUpdate: (preferences: NotificationPreferences) => void;
}) {
  const update = (patch: Partial<NotificationPreferences>) =>
    onUpdate({ ...preferences, ...patch });

  return (
    <>
      <h3>Notifications</h3>
      <ToggleField
        label="Native notifications"
        enabled={preferences.enabled}
        onToggle={() => update({ enabled: !preferences.enabled })}
      />
      <ToggleField
        label="Authentication transitions"
        enabled={preferences.authTransitions}
        onToggle={() => update({ authTransitions: !preferences.authTransitions })}
      />
      <ToggleField
        label="Session attention"
        enabled={preferences.sessionAttention}
        onToggle={() => update({ sessionAttention: !preferences.sessionAttention })}
      />
      <ToggleField
        label="Session crash"
        enabled={preferences.sessionCrash}
        onToggle={() => update({ sessionCrash: !preferences.sessionCrash })}
      />
      <ToggleField
        label="Reload All summary"
        enabled={preferences.reloadAllSummary}
        onToggle={() => update({ reloadAllSummary: !preferences.reloadAllSummary })}
      />
      <RangeField
        label="Notification cooldown"
        value={preferences.cooldownMs}
        min={0}
        max={300000}
        step={5000}
        suffix="ms"
        onChange={(value) => update({ cooldownMs: value })}
      />
    </>
  );
}

function SessionAudioRow({
  sessionId,
  name,
  preferences,
  onUpdate,
}: {
  sessionId: SessionId;
  name: string;
  preferences: SessionAudioPreferences;
  onUpdate: (sessionId: SessionId, preferences: SessionAudioPreferences) => void;
}) {
  const update = (patch: Partial<SessionAudioPreferences>) =>
    onUpdate(sessionId, { ...preferences, ...patch });

  return (
    <div className="session-audio-row">
      <strong>{name}</strong>
      <button
        className="control-button"
        type="button"
        onClick={() => update({ enabled: !preferences.enabled })}
      >
        {preferences.enabled ? 'Sound on' : 'Sound off'}
      </button>
      <button
        className="control-button"
        type="button"
        onClick={() => update({ completionEnabled: !preferences.completionEnabled })}
      >
        Completion {preferences.completionEnabled ? 'on' : 'off'}
      </button>
      <button
        className="control-button"
        type="button"
        onClick={() => update({ attentionEnabled: !preferences.attentionEnabled })}
      >
        Attention {preferences.attentionEnabled ? 'on' : 'off'}
      </button>
      <button
        className="control-button"
        type="button"
        onClick={() => update({ errorEnabled: !preferences.errorEnabled })}
      >
        Error {preferences.errorEnabled ? 'on' : 'off'}
      </button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ToggleField({
  label,
  enabled,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="settings-field">
      <span>{label}</span>
      <button className="control-button" type="button" onClick={onToggle}>
        {enabled ? 'Enabled' : 'Disabled'}
      </button>
    </div>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input
        className="settings-text-input"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function ArgsField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string[];
  placeholder?: string;
  onChange: (value: string[]) => void;
}) {
  return (
    <label className="settings-field settings-field-stack">
      <span>{label}</span>
      <textarea
        className="settings-text-input settings-text-area"
        value={value.join('\n')}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(
            event.currentTarget.value
              .split('\n')
              .map((item) => item.trim())
              .filter(Boolean),
          );
        }}
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <span className="settings-number-pair">
        <input
          className="settings-text-input"
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) {
              onChange(Math.min(max, Math.max(min, next)));
            }
          }}
        />
        <strong>{suffix}</strong>
      </span>
    </label>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <span className="settings-input-pair">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <strong>
          {value}
          {suffix}
        </strong>
      </span>
    </label>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input
        className="time-input"
        type="time"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}
