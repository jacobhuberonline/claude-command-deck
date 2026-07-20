import { z } from 'zod';
import { SESSION_IDS } from '../domain/types';
import {
  authConfigurationSchema,
  audioPreferencesSchema,
  notificationPreferencesSchema,
  sessionAudioPreferencesSchema,
  sessionConfigurationSchema,
} from './settings';

export const sessionIdSchema = z.enum(SESSION_IDS);

export const openExternalDirectoryRequestSchema = z.object({
  sessionId: sessionIdSchema,
});

export const selectDirectoryRequestSchema = z.object({
  sessionId: sessionIdSchema,
});

export const updateAudioPreferencesRequestSchema = z.object({
  preferences: audioPreferencesSchema,
});

export const updateAuthConfigurationRequestSchema = z.object({
  auth: authConfigurationSchema,
});

export const updateNotificationPreferencesRequestSchema = z.object({
  preferences: notificationPreferencesSchema,
});

export const updateSessionConfigurationRequestSchema = z.object({
  configuration: sessionConfigurationSchema,
});

export const updateSessionAudioPreferencesRequestSchema = z.object({
  sessionId: sessionIdSchema,
  preferences: sessionAudioPreferencesSchema,
});

export const discoverClaudeRequestSchema = z.object({
  executable: z.string().trim().min(1).max(512),
});

export const startShellRequestSchema = z.object({
  sessionId: sessionIdSchema,
  workingDirectory: z.string().max(4096),
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(2).max(200),
});

export const startClaudeRequestSchema = z.object({
  sessionId: sessionIdSchema,
  workingDirectory: z.string().max(4096),
  executable: z.string().trim().min(1).max(512),
  args: z.array(z.string().max(2048)).max(64),
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(2).max(200),
});

export const terminalWriteRequestSchema = z.object({
  sessionId: sessionIdSchema,
  data: z.string().max(1024 * 256),
});

export const terminalResizeRequestSchema = z.object({
  sessionId: sessionIdSchema,
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(2).max(200),
});

export const terminalStopRequestSchema = z.object({
  sessionId: sessionIdSchema,
});

export const authWriteRequestSchema = z.object({
  data: z.string().max(1024 * 256),
});

export const authResizeRequestSchema = z.object({
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(2).max(200),
});
