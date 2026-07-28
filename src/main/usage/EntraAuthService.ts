import { createHash, randomBytes } from 'node:crypto';
import { BrowserWindow, safeStorage } from 'electron';
import Store from 'electron-store';
import type { SafeLogger } from '../logging/SafeLogger';

// Public SPA client registration used by the AI Sentinel web app. The AWS API Gateway behind
// ai-sentinel.symplr.com accepts the Microsoft Graph token this client issues.
const TENANT_ID = '609c6297-f55c-4b6d-91aa-63ccb6cbdcf9';
const CLIENT_ID = 'a064852c-822e-4285-9e6f-4bff7a459ab6';
const REDIRECT_URI = 'https://ai-sentinel.symplr.com';
const SCOPE = 'User.Read openid profile offline_access';
const AUTHORITY = `https://login.microsoftonline.com/${TENANT_ID}`;
const AUTHORIZE_ENDPOINT = `${AUTHORITY}/oauth2/v2.0/authorize`;
const TOKEN_ENDPOINT = `${AUTHORITY}/oauth2/v2.0/token`;
const EXPIRY_SKEW_MS = 60 * 1000;

interface TokenState {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  email: string;
}

interface StoredShape {
  refreshToken?: string;
  email?: string;
}

class TokenEndpointError extends Error {
  constructor(
    readonly status: number,
    readonly oauthError: string | null,
  ) {
    super(`Token endpoint returned ${status}.`);
    this.name = 'TokenEndpointError';
  }
}

export interface EntraAccount {
  email: string;
}

export class EntraAuthService {
  private readonly store = new Store<StoredShape>({ name: 'usage-auth', clearInvalidConfig: true });
  private tokenState: TokenState | null = null;

  constructor(private readonly logger: SafeLogger) {}

  getAccount(): EntraAccount | null {
    const email = (this.tokenState?.email ?? this.store.get('email'))?.trim();
    if (email) {
      return { email };
    }
    return this.loadStoredRefreshToken() ? { email: '' } : null;
  }

  isSignedIn(): boolean {
    return this.tokenState !== null || this.loadStoredRefreshToken() !== null;
  }

  async signIn(): Promise<EntraAccount> {
    const verifier = base64UrlEncode(randomBytes(32));
    const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest());
    const state = base64UrlEncode(randomBytes(16));
    const code = await this.requestAuthorizationCode(challenge, state);
    const tokenState = await this.exchangeCode(code, verifier);
    this.persist(tokenState);
    return { email: tokenState.email };
  }

  signOut(): void {
    this.tokenState = null;
    this.store.clear();
  }

  async getAccessToken(): Promise<string | null> {
    if (this.tokenState && this.tokenState.accessTokenExpiresAt - EXPIRY_SKEW_MS > Date.now()) {
      return this.tokenState.accessToken;
    }

    const refreshToken = this.tokenState?.refreshToken ?? this.loadStoredRefreshToken();
    if (!refreshToken) {
      return null;
    }

    try {
      const tokenState = await this.refresh(refreshToken);
      this.persist(tokenState);
      return tokenState.accessToken;
    } catch (error) {
      if (error instanceof TokenEndpointError && error.oauthError === 'invalid_grant') {
        // Entra uses invalid_grant when the stored refresh token can no longer be redeemed.
        this.signOut();
      } else {
        this.logger.warn('Usage token refresh failed; stored session retained.', {
          reason:
            error instanceof TokenEndpointError
              ? `http_${error.status}`
              : error instanceof Error
                ? error.name
                : 'unknown',
        });
      }
      return null;
    }
  }

  getSignedInEmail(): string | null {
    return this.tokenState?.email ?? this.store.get('email') ?? null;
  }

  private requestAuthorizationCode(codeChallenge: string, state: string): Promise<string> {
    const authorizeUrl = new URL(AUTHORIZE_ENDPOINT);
    authorizeUrl.search = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      response_mode: 'fragment',
      scope: SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      prompt: 'select_account',
    }).toString();

    return new Promise<string>((resolve, reject) => {
      const authWindow = new BrowserWindow({
        width: 520,
        height: 680,
        title: 'Sign in to AI Sentinel',
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      let settled = false;
      const finish = (error: Error | null, code?: string) => {
        if (settled) {
          return;
        }
        settled = true;
        authWindow.removeAllListeners('closed');
        if (!authWindow.isDestroyed()) {
          // Destroy rather than close so a partially loaded redirect target cannot delay teardown.
          authWindow.destroy();
        }
        if (error) {
          reject(error);
        } else {
          resolve(code as string);
        }
      };

      const inspect = (event: Electron.Event, url: string) => {
        if (!url.startsWith(REDIRECT_URI)) {
          return;
        }
        // The authorization code is on the redirect back to the SPA origin; stop that page from
        // actually loading since we only need its query/fragment parameters.
        event.preventDefault();
        const parsed = new URL(url);
        const params = new URLSearchParams(parsed.search || parsed.hash.replace(/^#/, ''));
        const returnedCode = params.get('code');
        const returnedError = params.get('error');
        const returnedState = params.get('state');
        if (returnedError) {
          finish(new Error('Microsoft sign-in was rejected.'));
        } else if (returnedCode) {
          if (returnedState !== state) {
            finish(new Error('Microsoft sign-in returned an unexpected state.'));
            return;
          }
          finish(null, returnedCode);
        }
      };

      authWindow.webContents.on('will-redirect', (event, url) => inspect(event, url));
      authWindow.webContents.on('will-navigate', (event, url) => inspect(event, url));
      authWindow.on('closed', () => {
        if (!settled) {
          settled = true;
          reject(new Error('Sign-in window was closed before completing.'));
        }
      });

      void authWindow.loadURL(authorizeUrl.toString()).catch(() => {
        finish(new Error('Unable to open the Microsoft sign-in page.'));
      });
    });
  }

  private async exchangeCode(code: string, codeVerifier: string): Promise<TokenState> {
    return this.postToken({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
      scope: SCOPE,
    });
  }

  private async refresh(refreshToken: string): Promise<TokenState> {
    return this.postToken({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPE,
    });
  }

  private async postToken(body: Record<string, string>): Promise<TokenState> {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // The Entra client is registered as a Single-Page Application, which only redeems
        // authorization codes on cross-origin requests. Sending the SPA's origin makes the
        // token endpoint treat this exchange as one.
        origin: REDIRECT_URI,
      },
      body: new URLSearchParams(body).toString(),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const oauthError = readOAuthError(detail);
      this.logger.warn('Usage token exchange failed', {
        status: response.status,
        oauthError: oauthError ?? 'unknown',
      });
      throw new TokenEndpointError(response.status, oauthError);
    }

    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!payload.access_token) {
      throw new Error('Token endpoint did not return an access token.');
    }

    return {
      accessToken: payload.access_token,
      accessTokenExpiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
      refreshToken: payload.refresh_token ?? body.refresh_token ?? '',
      email: readEmailClaim(payload.access_token),
    };
  }

  private persist(tokenState: TokenState): void {
    this.tokenState = tokenState;
    if (tokenState.email) {
      this.store.set('email', tokenState.email);
    }
    if (tokenState.refreshToken && safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(tokenState.refreshToken).toString('base64');
      this.store.set('refreshToken', encrypted);
    }
  }

  private loadStoredRefreshToken(): string | null {
    const stored = this.store.get('refreshToken');
    if (!stored || !safeStorage.isEncryptionAvailable()) {
      return null;
    }
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      this.logger.warn('Stored usage refresh token could not be decrypted.');
      return null;
    }
  }
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function readEmailClaim(accessToken: string): string {
  try {
    const [, payload] = accessToken.split('.');
    if (!payload) {
      return '';
    }
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString()) as {
      upn?: string;
      unique_name?: string;
      preferred_username?: string;
      email?: string;
    };
    return (
      claims.upn ??
      claims.preferred_username ??
      claims.unique_name ??
      claims.email ??
      ''
    ).trim();
  } catch {
    return '';
  }
}

function readOAuthError(detail: string): string | null {
  try {
    const payload = JSON.parse(detail) as { error?: unknown };
    return typeof payload.error === 'string' ? payload.error : null;
  } catch {
    return null;
  }
}
