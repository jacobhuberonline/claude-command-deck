import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { discoverClaudeRequestSchema } from '../../shared/schemas/ipc';
import { discoverClaude } from '../claude/ClaudeDiscovery';

export function registerClaudeHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.claudeDiscover, (_event, rawPayload) => {
    const payload = discoverClaudeRequestSchema.safeParse(rawPayload);
    return payload.success ? discoverClaude(payload.data.executable) : discoverClaude('claude');
  });
}
