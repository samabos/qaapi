import { request } from 'undici';
import { AuthConfig } from '../types';

const TOKEN_FIELDS = ['token', 'access_token', 'accessToken', 'jwt', 'idToken'];

interface CachedOAuth2Token {
  accessToken: string;
  expiresAt: number; // epoch ms
}

export class AuthManager {
  private token: string | null = null;
  private config: AuthConfig | null = null;
  private baseUrl = '';
  private oauth2Cache: CachedOAuth2Token | null = null;

  setConfig(config: AuthConfig, baseUrl: string): void {
    this.config = config;
    this.baseUrl = baseUrl;
    this.token = null;
    this.oauth2Cache = null;
  }

  /**
   * Bootstrap a single auth token based on the configured strategy.
   */
  async bootstrap(): Promise<boolean> {
    if (!this.config) return false;

    switch (this.config.strategy) {
      case 'credentials': {
        const first = this.config.credentials
          ? Object.values(this.config.credentials)[0]
          : undefined;
        if (first) {
          this.token = await this.loginWithCredentials(first.email, first.password);
        }
        break;
      }

      case 'auto-register': {
        const first = this.config.credentials
          ? Object.entries(this.config.credentials)[0]
          : undefined;
        if (first) {
          this.token = await this.autoRegisterAndLogin(first[0], first[1].email, first[1].password);
        }
        break;
      }

      case 'api-key':
        this.token = this.config.apiKey ?? null;
        break;

      case 'oauth2-client-credentials':
        this.token = await this.fetchOAuth2Token();
        break;

      case 'none':
      default:
        break;
    }

    return this.token !== null;
  }

  getToken(): string | null {
    return this.token;
  }

  /**
   * Get token with automatic refresh for expired OAuth2 tokens.
   */
  async ensureToken(): Promise<string | null> {
    if (this.config?.strategy === 'oauth2-client-credentials') {
      if (!this.oauth2Cache || Date.now() >= this.oauth2Cache.expiresAt - 30_000) {
        this.oauth2Cache = null;
        this.token = await this.fetchOAuth2Token();
      }
      return this.token;
    }
    return this.token;
  }

  /**
   * Force-refresh the token.
   */
  async refresh(): Promise<string | null> {
    if (this.config?.strategy === 'oauth2-client-credentials') {
      this.oauth2Cache = null;
      this.token = await this.fetchOAuth2Token();
      return this.token;
    }

    const first = this.config?.credentials
      ? Object.values(this.config.credentials)[0]
      : undefined;
    if (first) {
      this.token = await this.loginWithCredentials(first.email, first.password);
    }
    return this.token;
  }

  /* ---- Private -------------------------------------------------- */

  private async fetchOAuth2Token(): Promise<string | null> {
    if (this.oauth2Cache && Date.now() < this.oauth2Cache.expiresAt - 30_000) {
      return this.oauth2Cache.accessToken;
    }

    const oauth2 = this.config?.oauth2;
    if (!oauth2?.tokenUrl || !oauth2.clientId || !oauth2.clientSecret) return null;

    const params = new URLSearchParams({ grant_type: 'client_credentials' });
    if (oauth2.scope) {
      params.set('scope', oauth2.scope);
    }

    try {
      const { statusCode, body } = await request(oauth2.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${oauth2.clientId}:${oauth2.clientSecret}`).toString('base64')}`,
        },
        body: params.toString(),
      });

      if (statusCode >= 400) return null;

      const data = await body.json() as Record<string, unknown>;
      const accessToken = typeof data.access_token === 'string' ? data.access_token : null;
      if (!accessToken) return null;

      const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
      this.oauth2Cache = {
        accessToken,
        expiresAt: Date.now() + expiresIn * 1000,
      };

      return accessToken;
    } catch {
      return null;
    }
  }

  private async loginWithCredentials(email: string, password: string): Promise<string | null> {
    if (!this.config?.loginEndpoint) return null;

    const url = `${this.baseUrl}${this.config.loginEndpoint}`;
    const { statusCode, body } = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (statusCode >= 400) return null;

    const data = await body.json() as Record<string, unknown>;
    return this.extractToken(data);
  }

  private async autoRegisterAndLogin(
    name: string,
    email: string,
    password: string,
  ): Promise<string | null> {
    if (!this.config?.registerEndpoint) {
      return this.loginWithCredentials(email, password);
    }

    const ephemeralEmail = `qaapi_${name}_${Date.now()}@test.local`;
    const url = `${this.baseUrl}${this.config.registerEndpoint}`;

    try {
      await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ephemeralEmail, password }),
      });
    } catch {
      // registration may fail if user exists — proceed to login
    }

    return this.loginWithCredentials(email, password);
  }

  private extractToken(data: Record<string, unknown>): string | null {
    for (const field of TOKEN_FIELDS) {
      if (typeof data[field] === 'string') return data[field] as string;
    }
    if (data.data && typeof data.data === 'object') {
      const nested = data.data as Record<string, unknown>;
      for (const field of TOKEN_FIELDS) {
        if (typeof nested[field] === 'string') return nested[field] as string;
      }
    }
    return null;
  }
}
