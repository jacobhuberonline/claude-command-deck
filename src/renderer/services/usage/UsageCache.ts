export interface MonthlyUsageSnapshot {
  amountUsd: number;
  limitUsd: number | null;
  month: string;
  observedAt: string;
  accountEmail: string;
}

export function currentUsageMonth(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function parseStoredUsage(
  raw: string | null,
  accountEmail: string | null,
  expectedMonth = currentUsageMonth(),
): MonthlyUsageSnapshot | null {
  const normalizedAccountEmail = accountEmail?.trim().toLowerCase();
  if (!raw || !normalizedAccountEmail) {
    return null;
  }

  try {
    const value = JSON.parse(raw) as Partial<MonthlyUsageSnapshot>;
    const cachedAccountEmail = value.accountEmail?.trim().toLowerCase();
    const observedAt = typeof value.observedAt === 'string' ? Date.parse(value.observedAt) : NaN;
    if (
      !Number.isFinite(value.amountUsd) ||
      (value.limitUsd !== null && !Number.isFinite(value.limitUsd)) ||
      value.month !== expectedMonth ||
      cachedAccountEmail !== normalizedAccountEmail ||
      !Number.isFinite(observedAt)
    ) {
      return null;
    }

    return {
      amountUsd: value.amountUsd as number,
      limitUsd: value.limitUsd as number | null,
      month: value.month,
      observedAt: value.observedAt as string,
      accountEmail: value.accountEmail as string,
    };
  } catch {
    return null;
  }
}
