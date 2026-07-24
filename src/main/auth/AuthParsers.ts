import type { AuthSafeIdentity } from '../../shared/domain/types';

export function parseAwsCallerIdentity(output: string): AuthSafeIdentity | null {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const identity: AuthSafeIdentity = {
      accountId: typeof record.Account === 'string' ? record.Account : undefined,
      arn: typeof record.Arn === 'string' ? record.Arn : undefined,
      userId: typeof record.UserId === 'string' ? record.UserId : undefined,
    };
    return identity.accountId || identity.arn || identity.userId ? identity : null;
  } catch {
    return null;
  }
}
