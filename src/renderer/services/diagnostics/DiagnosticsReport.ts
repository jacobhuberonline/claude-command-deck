import type { AppStateSnapshot, DiagnosticCheck } from '../../../shared/domain/types';

export interface DiagnosticsReportEnvironment {
  platform: string;
  userAgent: string;
  notificationSupport: string;
  clipboardSupport: string;
}

export function buildSanitizedDiagnosticsReport(
  appState: AppStateSnapshot,
  environment: DiagnosticsReportEnvironment = defaultEnvironment(),
): string {
  const configuredSessions = appState.sessions.filter(
    (session) => session.configuration.workingDirectory.trim().length > 0,
  ).length;
  const lines = [
    '# Claude Command Deck Diagnostics',
    '',
    `App version: ${appState.appVersion}`,
    `Settings schema: ${appState.settings.schemaVersion}`,
    `Platform: ${sanitizeDiagnosticText(environment.platform)}`,
    `User agent: ${sanitizeDiagnosticText(environment.userAgent)}`,
    `Notification support: ${environment.notificationSupport}`,
    `Clipboard support: ${environment.clipboardSupport}`,
    `Claude executable: ${redactPathLikeValue(appState.settings.claudeExecutable)}`,
    `Shell executable: ${redactPathLikeValue(appState.settings.shellExecutable)}`,
    `Auth provider: ${appState.settings.auth.provider}`,
    `Auth status: ${appState.auth.status}`,
    `Configured sessions: ${configuredSessions}/4`,
    `Audio master enabled: ${appState.settings.audio.masterEnabled}`,
    `Native notifications enabled: ${appState.settings.notifications.enabled}`,
    '',
    '## Checks',
    ...appState.diagnostics.map(formatDiagnostic),
    '',
    '## Persistence Boundaries',
    '- Terminal transcripts: not included',
    '- Terminal input: not included',
    '- Raw authentication output: not included',
    '- Environment variables: not included',
  ];

  return `${lines.join('\n')}\n`;
}

export function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED_AWS_ACCESS_KEY]')
    .replace(/\b[A-Za-z0-9_/+=-]{32,}\b/g, '[REDACTED_TOKEN]');
}

function formatDiagnostic(check: DiagnosticCheck): string {
  const checkedAt = check.checkedAt ? ` (${check.checkedAt})` : '';
  return `- ${check.status.toUpperCase()} ${check.label}${checkedAt}: ${sanitizeDiagnosticText(
    check.detail,
  )}`;
}

function redactPathLikeValue(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return 'not configured';
  }

  const parts = normalized.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) {
    return sanitizeDiagnosticText(normalized);
  }

  return `[path]/${sanitizeDiagnosticText(parts.at(-1) ?? 'unknown')}`;
}

function defaultEnvironment(): DiagnosticsReportEnvironment {
  return {
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    notificationSupport:
      typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    clipboardSupport: navigator.clipboard ? 'available' : 'unavailable',
  };
}
