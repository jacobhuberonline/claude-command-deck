import { z } from 'zod';
import { SESSION_IDS } from '../domain/types';

const sessionIdSchema = z.enum(SESSION_IDS);
const launchModeSchema = z.enum(['new', 'continueMostRecent', 'resumeSpecific', 'custom']);

export const sessionAudioPreferencesSchema = z.object({
  enabled: z.boolean(),
  completionEnabled: z.boolean(),
  attentionEnabled: z.boolean(),
  errorEnabled: z.boolean(),
  volumeMultiplier: z.number().min(0).max(2),
  onlyWhenUnfocused: z.boolean(),
});

export const sessionConfigurationSchema = z.object({
  id: sessionIdSchema,
  name: z.string().min(1).max(120),
  workingDirectory: z.string().max(4096),
  executable: z.string().min(1).max(512),
  args: z.array(z.string().max(2048)).max(64),
  launchMode: launchModeSchema,
  scrollback: z.number().int().min(100).max(100000),
  restoreOnLaunch: z.boolean(),
  audio: sessionAudioPreferencesSchema,
});

export const authConfigurationSchema = z.object({
  provider: z.enum(['aws', 'custom', 'disabled']),
  checkExecutable: z.string().max(512),
  checkArgs: z.array(z.string().max(2048)).max(64),
  refreshExecutable: z.string().max(512),
  refreshArgs: z.array(z.string().max(2048)).max(64),
  workingDirectory: z.string().max(4096),
  shellMode: z.boolean(),
  checkIntervalSeconds: z.number().int().min(30).max(86400),
  checkTimeoutSeconds: z.number().int().min(1).max(600),
  expirationWarningMinutes: z.number().int().min(0).max(1440),
  startupChecksEnabled: z.boolean(),
  nativeNotificationsEnabled: z.boolean(),
});

export const quietHoursConfigurationSchema = z.object({
  enabled: z.boolean(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  days: z.array(z.number().int().min(0).max(6)).max(7),
  allowAuthDisconnectSounds: z.boolean(),
  allowCrashSounds: z.boolean(),
});

export const audioPreferencesSchema = z.object({
  masterEnabled: z.boolean(),
  masterVolume: z.number().min(0).max(1),
  doNotDisturb: z.boolean(),
  doNotDisturbUntil: z.string().optional(),
  startupSoundsEnabled: z.boolean(),
  sessionReadyEnabled: z.boolean(),
  completionEnabled: z.boolean(),
  attentionEnabled: z.boolean(),
  authenticationEnabled: z.boolean(),
  errorEnabled: z.boolean(),
  onlyWhenUnfocused: z.boolean(),
  cooldownMs: z.number().int().min(0).max(600000),
  minimumActivityMs: z.number().int().min(0).max(600000),
  quietHours: quietHoursConfigurationSchema,
});

export const notificationPreferencesSchema = z.object({
  enabled: z.boolean(),
  authTransitions: z.boolean(),
  sessionAttention: z.boolean(),
  sessionCrash: z.boolean(),
  reloadAllSummary: z.boolean(),
  cooldownMs: z.number().int().min(0).max(600000),
});

export const applicationSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  shellExecutable: z.string().min(1).max(512),
  claudeExecutable: z.string().min(1).max(512),
  claudeBaseArgs: z.array(z.string().max(2048)).max(64),
  sessions: z.array(sessionConfigurationSchema).length(4),
  focusedSessionId: sessionIdSchema,
  focusMode: z.boolean(),
  auth: authConfigurationSchema,
  audio: audioPreferencesSchema,
  notifications: notificationPreferencesSchema,
});
