import type { SafeLogger } from '../src/main/logging/SafeLogger';
import { EntraAuthService } from '../src/main/usage/EntraAuthService';
import { UsageService } from '../src/main/usage/UsageService';
import {
  parseStoredUsage,
  type MonthlyUsageSnapshot,
} from '../src/renderer/services/usage/UsageCache';

const authMocks = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  fetch: vi.fn(),
}));

vi.mock('electron-store', () => ({
  default: class {
    get(key: string) {
      return authMocks.store.get(key);
    }

    set(key: string, value: unknown) {
      authMocks.store.set(key, value);
    }

    clear() {
      authMocks.store.clear();
    }
  },
}));

vi.mock('electron', () => ({
  BrowserWindow: class {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

describe('AI Sentinel authentication and usage', () => {
  beforeEach(() => {
    authMocks.store.clear();
    authMocks.fetch.mockReset();
    vi.stubGlobal('fetch', authMocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retains the stored session when a token refresh fails transiently', async () => {
    seedStoredSession();
    authMocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'temporarily_unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const service = new EntraAuthService(createLogger());

    await expect(service.getAccessToken()).resolves.toBeNull();

    expect(service.isSignedIn()).toBe(true);
    expect(authMocks.store.get('email')).toBe('user@example.com');
    expect(authMocks.store.get('refreshToken')).toBe(encodeStoredToken('stored-refresh-token'));
  });

  it('clears the stored session when Entra rejects the refresh token', async () => {
    seedStoredSession();
    authMocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const service = new EntraAuthService(createLogger());

    await expect(service.getAccessToken()).resolves.toBeNull();

    expect(service.isSignedIn()).toBe(false);
    expect(authMocks.store.size).toBe(0);
  });

  it('distinguishes expired credentials from a retryable refresh failure', async () => {
    const signedOutAuth = {
      getAccessToken: vi.fn(() => Promise.resolve(null)),
      isSignedIn: vi.fn(() => false),
    } as unknown as EntraAuthService;
    const retainedAuth = {
      getAccessToken: vi.fn(() => Promise.resolve(null)),
      isSignedIn: vi.fn(() => true),
    } as unknown as EntraAuthService;

    await expect(
      new UsageService(signedOutAuth, createLogger()).getMonthlyUsage(),
    ).resolves.toEqual({
      ok: false,
      error: 'Sign in to AI Sentinel in Settings to load usage.',
      authRequired: true,
    });
    await expect(new UsageService(retainedAuth, createLogger()).getMonthlyUsage()).resolves.toEqual(
      {
        ok: false,
        error: 'Unable to refresh the AI Sentinel session. Try again shortly.',
        authRequired: false,
      },
    );
  });
});

describe('AI Sentinel usage cache', () => {
  const snapshot: MonthlyUsageSnapshot = {
    amountUsd: 12.34,
    limitUsd: 100,
    month: '2026-07',
    observedAt: '2026-07-28T12:00:00.000Z',
    accountEmail: 'user@example.com',
  };

  it('loads a valid cache for the same account and month', () => {
    expect(parseStoredUsage(JSON.stringify(snapshot), 'USER@example.com', '2026-07')).toEqual(
      snapshot,
    );
  });

  it('rejects a cache from another month or account', () => {
    expect(parseStoredUsage(JSON.stringify(snapshot), 'user@example.com', '2026-08')).toBeNull();
    expect(parseStoredUsage(JSON.stringify(snapshot), 'other@example.com', '2026-07')).toBeNull();
  });

  it('rejects legacy, malformed, and non-finite cache values', () => {
    const legacy = {
      amountUsd: 12.34,
      limitUsd: 100,
      observedAt: snapshot.observedAt,
    };
    const nonFinite = {
      ...snapshot,
      amountUsd: 'NaN',
    };

    expect(
      parseStoredUsage(JSON.stringify(legacy), snapshot.accountEmail, snapshot.month),
    ).toBeNull();
    expect(parseStoredUsage('{invalid', snapshot.accountEmail, snapshot.month)).toBeNull();
    expect(
      parseStoredUsage(JSON.stringify(nonFinite), snapshot.accountEmail, snapshot.month),
    ).toBeNull();
  });
});

function seedStoredSession(): void {
  authMocks.store.set('email', 'user@example.com');
  authMocks.store.set('refreshToken', encodeStoredToken('stored-refresh-token'));
}

function encodeStoredToken(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function createLogger(): SafeLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as SafeLogger;
}
