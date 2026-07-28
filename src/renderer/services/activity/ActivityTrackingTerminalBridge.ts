import type {
  CommandResult,
  TerminalBridge,
  TerminalWriteRequest,
} from '../../../shared/ipc/contracts';

type RecordTerminalInput = (sessionId: string, data: string, nowMs: number) => void;

export async function writeWithActivityTracking(
  terminalBridge: TerminalBridge,
  request: TerminalWriteRequest,
  recordInput: RecordTerminalInput,
  now: () => number = Date.now,
): Promise<CommandResult> {
  const submittedAt = now();
  const result = await terminalBridge.write(request);
  if (result.ok) {
    recordInput(request.sessionId, request.data, submittedAt);
  }
  return result;
}
