import type { MonthlyUsageResult } from '../../shared/domain/types';
import type { SafeLogger } from '../logging/SafeLogger';
import type { EntraAuthService } from './EntraAuthService';

const USAGE_ENDPOINT = 'https://co2vb54rz2.execute-api.us-east-2.amazonaws.com/api/governance/invoke';
const USAGE_ORIGIN = 'https://ai-sentinel.symplr.com';
const REQUEST_TIMEOUT_MS = 15000;

export class UsageService {
  constructor(
    private readonly authService: EntraAuthService,
    private readonly logger: SafeLogger,
  ) {}

  async getMonthlyUsage(): Promise<MonthlyUsageResult> {
    const accessToken = await this.authService.getAccessToken();
    if (!accessToken) {
      return { ok: false, error: 'Sign in to AI Sentinel in Settings to load usage.' };
    }

    const email = this.authService.getSignedInEmail()?.trim();
    if (!email) {
      return { ok: false, error: 'Signed-in account is missing an email address.' };
    }

    const month = currentMonth();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(USAGE_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/plain, */*',
          origin: USAGE_ORIGIN,
          referer: `${USAGE_ORIGIN}/`,
          authorization: `Bearer ${accessToken}`,
          'x-caller-email': email,
        },
        body: JSON.stringify({
          tool_name: 'query_user_detail',
          parameters: { user_id: email, month },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          ok: false,
          error: `AI Sentinel returned ${response.status} ${response.statusText}.`,
        };
      }

      const payload = (await response.json()) as {
        est_cost_usd?: unknown;
        total_cost?: unknown;
        effective_limit?: unknown;
      };

      const amountUsd = toFiniteNumber(payload.est_cost_usd ?? payload.total_cost);
      if (amountUsd === null) {
        return { ok: false, error: 'AI Sentinel response did not include a usage total.' };
      }

      return {
        ok: true,
        amountUsd,
        limitUsd: toFiniteNumber(payload.effective_limit),
        month,
        observedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? 'The AI Sentinel usage request timed out.'
          : 'Unable to reach AI Sentinel for usage.';
      this.logger.warn('Usage request failed', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return { ok: false, error: message };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function currentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
