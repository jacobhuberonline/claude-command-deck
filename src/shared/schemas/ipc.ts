import { z } from 'zod';
import { MAX_SESSION_COUNT } from '../domain/types';
import {
  authConfigurationSchema,
  audioPreferencesSchema,
  notificationPreferencesSchema,
  sessionAudioPreferencesSchema,
  sessionConfigurationSchema,
  sessionIdSchema,
  shellKindSchema,
} from './settings';

export { sessionIdSchema };

export const openExternalDirectoryRequestSchema = z.object({
  sessionId: sessionIdSchema,
});

export const selectDirectoryRequestSchema = z.object({
  sessionId: sessionIdSchema,
});

export const removeSessionRequestSchema = z.object({
  sessionId: sessionIdSchema,
});

export const updateAudioPreferencesRequestSchema = z.object({
  preferences: audioPreferencesSchema,
});

export const updateAuthConfigurationRequestSchema = z.object({
  auth: authConfigurationSchema,
});

export const updateShellConfigurationRequestSchema = z.object({
  shellKind: shellKindSchema,
});

export const updateClaudeConfigurationRequestSchema = z.object({
  executable: z.string().trim().min(1).max(512),
  baseArgs: z.array(z.string().max(2048)).max(64),
});

export const updateDeckPreferencesRequestSchema = z.object({
  focusedSessionId: sessionIdSchema,
  focusMode: z.boolean(),
});

export const updateNotificationPreferencesRequestSchema = z.object({
  preferences: notificationPreferencesSchema,
});

export const updateSessionConfigurationRequestSchema = z.object({
  configuration: sessionConfigurationSchema,
});

export const updateSessionOrderRequestSchema = z.object({
  sessionIds: z
    .array(sessionIdSchema)
    .min(1)
    .max(MAX_SESSION_COUNT)
    .refine((sessionIds) => new Set(sessionIds).size === sessionIds.length, {
      message: 'Session IDs must be unique.',
    }),
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
  shellKind: shellKindSchema,
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(2).max(200),
});

export const prepareClaudeLaunchRequestSchema = z.object({
  sessionId: sessionIdSchema,
  launchMode: z.enum(['new', 'continueMostRecent', 'resumeSpecific']),
});

export const startClaudeRequestSchema = z.object({
  sessionId: sessionIdSchema,
  planId: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  allowFreshFallback: z.boolean(),
  allowAmbiguousContinue: z.boolean(),
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
  planId: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    .optional(),
});

export const authWriteRequestSchema = z.object({
  data: z.string().max(1024 * 256),
});

export const authResizeRequestSchema = z.object({
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(2).max(200),
});
