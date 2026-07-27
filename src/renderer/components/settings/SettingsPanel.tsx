import { FolderPen, X } from 'lucide-react';
import type {
  AppStateSnapshot,
  AuthConfiguration,
  AuthProvider,
  AudioEvent,
  AudioPreferences,
  NotificationPreferences,
  SessionAudioPreferences,
  SessionConfiguration,
  SessionId,
  ShellKind,
  ShellOption,
  SettingsSection,
} from '../../../shared/domain/types';
import { buildSanitizedDiagnosticsReport } from '../../services/diagnostics/DiagnosticsReport';

interface SettingsPanelProps {
  appState: AppStateSnapshot;
  section: SettingsSection | null;
  onSelectSection: (section: SettingsSection) => void;
  onClose: () => void;
  onUpdateAuthConfiguration: (auth: AuthConfiguration) => void;
  onUpdateClaudeConfiguration: (executable: string, baseArgs: string[]) => void;
  shellOptions: ShellOption[];
  onUpdateShellConfiguration: (shellKind: ShellKind) => void;
  onUpdateAudioPreferences: (preferences: AudioPreferences) => void;
  onUpdateNotificationPreferences: (preferences: NotificationPreferences) => void;
  onUpdateSessionConfiguration: (configuration: SessionConfiguration) => void;
  onUpdateSessionAudioPreferences: (
    sessionId: SessionId,
    preferences: SessionAudioPreferences,
  ) => void;
  onSelectDirectory: (sessionId: SessionId) => void;
  onTestAudio: (event: AudioEvent) => void;
  onRerunDiagnostics: () => void;
  onOpenLogDirectory: () => void;
}

const sections: Array<{ id: SettingsSection; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'shell', label: 'Shell' },
  { id: 'authentication', label: 'Credential monitor' },
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
  onUpdateClaudeConfiguration,
  shellOptions,
  onUpdateShellConfiguration,
  onUpdateAudioPreferences,
  onUpdateNotificationPreferences,
  onUpdateSessionConfiguration,
  onUpdateSessionAudioPreferences,
  onSelectDirectory,
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
              onUpdateClaudeConfiguration={onUpdateClaudeConfiguration}
              shellOptions={shellOptions}
              onUpdateShellConfiguration={onUpdateShellConfiguration}
              onUpdateAudioPreferences={onUpdateAudioPreferences}
              onUpdateNotificationPreferences={onUpdateNotificationPreferences}
              onUpdateSessionConfiguration={onUpdateSessionConfiguration}
              onUpdateSessionAudioPreferences={onUpdateSessionAudioPreferences}
              onSelectDirectory={onSelectDirectory}
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
  onUpdateClaudeConfiguration,
  shellOptions,
  onUpdateShellConfiguration,
  onUpdateNotificationPreferences,
  onUpdateSessionConfiguration,
  onUpdateSessionAudioPreferences,
  onSelectDirectory,
  onTestAudio,
  onRerunDiagnostics,
  onOpenLogDirectory,
}: {
  appState: AppStateSnapshot;
  section: SettingsSection;
  onUpdateAudioPreferences: (preferences: AudioPreferences) => void;
  onUpdateAuthConfiguration: (auth: AuthConfiguration) => void;
  onUpdateClaudeConfiguration: (executable: string, baseArgs: string[]) => void;
  shellOptions: ShellOption[];
  onUpdateShellConfiguration: (shellKind: ShellKind) => void;
  onUpdateNotificationPreferences: (preferences: NotificationPreferences) => void;
  onUpdateSessionConfiguration: (configuration: SessionConfiguration) => void;
  onUpdateSessionAudioPreferences: (
    sessionId: SessionId,
    preferences: SessionAudioPreferences,
  ) => void;
  onSelectDirectory: (sessionId: SessionId) => void;
  onTestAudio: (event: AudioEvent) => void;
  onRerunDiagnostics: () => void;
  onOpenLogDirectory: () => void;
}) {
  if (section === 'general') {
    return <GeneralSettings appState={appState} />;
  }

  if (section === 'claude') {
    return (
      <ClaudeSettings
        appState={appState}
        onUpdateClaudeConfiguration={onUpdateClaudeConfiguration}
        onUpdateSessionConfiguration={onUpdateSessionConfiguration}
        onSelectDirectory={onSelectDirectory}
      />
    );
  }

  if (section === 'shell') {
    return (
      <ShellSettings
        shellKind={appState.settings.shellKind}
        shellOptions={shellOptions}
        onUpdate={onUpdateShellConfiguration}
      />
    );
  }

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
      <Field label="Restore running sessions" value="Disabled by default" />
    </>
  );
}

function GeneralSettings({ appState }: { appState: AppStateSnapshot }) {
  return (
    <>
      <h3>Session management</h3>
      <Field label="Saved sessions" value={String(appState.sessions.length)} />
      <Field label="Quick switch" value="Alt+1…9 or Ctrl+PageUp / Ctrl+PageDown" />
      <Field label="Find sessions" value="Ctrl+Shift+P" />
      <Field label="Add a directory" value="Alt+N" />
      <Field
        label="Terminal transcripts"
        value="Buffered in memory for switching; never persisted"
      />
    </>
  );
}

function ShellSettings({
  shellKind,
  shellOptions,
  onUpdate,
}: {
  shellKind: ShellKind;
  shellOptions: ShellOption[];
  onUpdate: (shellKind: ShellKind) => void;
}) {
  return (
    <>
      <h3>Shell</h3>
      <label className="settings-field" htmlFor="default-shell">
        <span>Default shell</span>
        <select
          id="default-shell"
          className="settings-text-input"
          value={shellKind}
          aria-describedby="default-shell-hint"
          onChange={(event) => onUpdate(event.currentTarget.value as ShellKind)}
        >
          {shellOptions.map((option) => (
            <option key={option.kind} value={option.kind} disabled={!option.available}>
              {option.label}
              {option.available ? '' : ' (not found)'}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-hint" id="default-shell-hint">
        This choice applies only when starting a new shell process. A terminal that is already
        running keeps its current shell. Automatic selects an installed shell that fits your
        operating system.
      </p>
      <p className="settings-hint">
        Switching shells does not install command-line tools; commands such as NuGet must still be
        installed and available on PATH.
      </p>
    </>
  );
}

function ClaudeSettings({
  appState,
  onUpdateClaudeConfiguration,
  onUpdateSessionConfiguration,
  onSelectDirectory,
}: {
  appState: AppStateSnapshot;
  onUpdateClaudeConfiguration: (executable: string, baseArgs: string[]) => void;
  onUpdateSessionConfiguration: (configuration: SessionConfiguration) => void;
  onSelectDirectory: (sessionId: SessionId) => void;
}) {
  return (
    <>
      <h3>Claude Code</h3>
      <TextField
        label="Default executable"
        value={appState.settings.claudeExecutable}
        placeholder="claude"
        onChange={(executable) =>
          onUpdateClaudeConfiguration(executable, appState.settings.claudeBaseArgs)
        }
      />
      <ArgsField
        label="Default launch arguments"
        value={appState.settings.claudeBaseArgs}
        placeholder={'--permission-mode\nacceptEdits'}
        onChange={(baseArgs) =>
          onUpdateClaudeConfiguration(appState.settings.claudeExecutable, baseArgs)
        }
      />
      <p className="settings-hint">
        Models are optional. A blank session model adds no per-session override; default launch
        arguments and Claude configuration still apply. New conversations are named so this deck can
        resume the exact conversation later.
      </p>
      <div className="session-profile-list">
        {appState.sessions.map((session) => {
          const configuration = session.configuration;
          const processActive =
            ['starting', 'running', 'restarting', 'stopping'].includes(
              session.runtime.processState,
            ) ||
            (session.runtime.processState === 'error' && session.runtime.processType !== undefined);
          const update = (patch: Partial<SessionConfiguration>) =>
            onUpdateSessionConfiguration({ ...configuration, ...patch });
          return (
            <section className="session-profile" key={configuration.id}>
              <header>
                <strong>{configuration.name}</strong>
                <span>
                  {configuration.hasNamedConversation
                    ? 'Named conversation'
                    : configuration.launchMode === 'continueMostRecent'
                      ? 'Legacy directory conversation'
                      : 'Not started'}
                </span>
              </header>
              <TextField
                label="Display name"
                value={configuration.name}
                onChange={(name) => update({ name })}
              />
              <TextField
                label="Model override"
                value={configuration.model}
                placeholder="Default, haiku, sonnet, opus, or full model ID"
                onChange={(model) => update({ model })}
              />
              <TextField
                label="Executable override"
                value={configuration.executable}
                placeholder={`Inherit ${appState.settings.claudeExecutable}`}
                onChange={(executable) => update({ executable })}
              />
              <div className="settings-field settings-field-stack">
                <span>Working directory</span>
                <div className="settings-inline-row">
                  <strong>{configuration.workingDirectory || 'No directory selected'}</strong>
                  <button
                    className="control-button"
                    type="button"
                    disabled={processActive}
                    title={
                      processActive
                        ? 'Stop the attached process before changing directory'
                        : 'Change working directory'
                    }
                    onClick={() => onSelectDirectory(configuration.id)}
                  >
                    <FolderPen size={15} aria-hidden="true" />
                    <span>Change</span>
                  </button>
                </div>
              </div>
              <Field
                label="Claude conversation"
                value={configuration.claudeSessionName || 'Created on first fresh launch'}
              />
            </section>
          );
        })}
      </div>
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
      <h3>Credential monitor</h3>
      <p className="settings-hint">
        This optional monitor does not directly inspect running Claude sessions. The AWS preset
        checks local AWS credentials; a custom check reports only the command&apos;s exit status.
      </p>
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
        label="Login executable"
        value={auth.refreshExecutable}
        placeholder="aws"
        onChange={(value) => update({ refreshExecutable: value })}
      />
      <ArgsField
        label="Login arguments"
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
        label="Check once at app start"
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
  const valueText = value.join('\n');
  const commit = (draft: string) => {
    onChange(
      draft
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
    );
  };

  return (
    <label className="settings-field settings-field-stack">
      <span>{label}</span>
      <textarea
        className="settings-text-input settings-text-area"
        defaultValue={valueText}
        placeholder={placeholder}
        onChange={(event) => commit(event.currentTarget.value)}
        onBlur={(event) => commit(event.currentTarget.value)}
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
