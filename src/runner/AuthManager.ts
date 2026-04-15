import { request, Agent } from 'undici';
import { JSONPath } from 'jsonpath-plus';
import { AuthConfig, TokenStep } from '../types';
import { log } from '../Logger';

/** Shared dispatcher for token-chain steps that opt into TLS bypass. */
const insecureTlsAgent = new Agent({ connect: { rejectUnauthorized: false } });

/**
 * Decode a JWT's `exp` claim into epoch ms, or return null if the string
 * isn't a JWT or has no exp. No signature verification — we only trust the
 * claim for scheduling our own refresh, never for authorization.
 */
function extractJwtExpiry(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    if (payload && typeof payload.exp === 'number') {
      return payload.exp * 1000;
    }
  } catch {
    // not a JWT
  }
  return null;
}

const TOKEN_FIELDS = ['token', 'access_token', 'accessToken', 'jwt', 'idToken'];

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

/** How many ms before expiry we treat the token as already expired, so we
 *  refresh proactively instead of racing a request against the boundary. */
const TOKEN_REFRESH_SKEW_MS = 30_000;

export class AuthManager {
  private token: string | null = null;
  private config: AuthConfig | null = null;
  private baseUrl = '';
  private oauth2Cache: CachedToken | null = null;
  private tokenChainCache: CachedToken | null = null;

  setConfig(config: AuthConfig, baseUrl: string): void {
    this.config = config;
    this.baseUrl = baseUrl;
    this.token = null;
    this.oauth2Cache = null;
    this.tokenChainCache = null;
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

      case 'token-chain':
        this.token = await this.fetchTokenChain();
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
   * Get token with automatic refresh for expired OAuth2 or token-chain tokens.
   * For JWT-producing chains, the exp claim is honored.
   */
  async ensureToken(): Promise<string | null> {
    if (this.config?.strategy === 'oauth2-client-credentials') {
      if (!this.oauth2Cache || Date.now() >= this.oauth2Cache.expiresAt - TOKEN_REFRESH_SKEW_MS) {
        this.oauth2Cache = null;
        this.token = await this.fetchOAuth2Token();
      }
      return this.token;
    }
    if (this.config?.strategy === 'token-chain') {
      if (!this.tokenChainCache || Date.now() >= this.tokenChainCache.expiresAt - TOKEN_REFRESH_SKEW_MS) {
        this.tokenChainCache = null;
        this.token = await this.fetchTokenChain();
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

    if (this.config?.strategy === 'token-chain') {
      this.tokenChainCache = null;
      this.token = await this.fetchTokenChain();
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

  /**
   * Execute a chain of requests. Each step extracts a value (JSONPath)
   * that later steps can template in via `{{name}}`. The final step's
   * extracted value becomes the bearer token.
   */
  private async fetchTokenChain(): Promise<string | null> {
    const chain = this.config?.tokenChain;
    if (!chain?.steps?.length) return null;

    const values: Record<string, string> = {};
    let lastValue: string | null = null;

    for (let i = 0; i < chain.steps.length; i++) {
      const step = chain.steps[i];
      const extracted = await this.runTokenStep(step, values, i);
      if (extracted === null) return null;
      values[step.name] = extracted;
      lastValue = extracted;
    }

    // Cache the final token using its JWT exp claim if present. Non-JWTs
    // stay uncached and re-fetch on every Run click.
    this.tokenChainCache = null;
    if (lastValue) {
      const expiresAt = extractJwtExpiry(lastValue);
      if (expiresAt) {
        this.tokenChainCache = { accessToken: lastValue, expiresAt };
        const expiryIso = new Date(expiresAt).toISOString();
        log.info(`token-chain cached; expires at ${expiryIso}`);
      }
    }

    return lastValue;
  }

  private async runTokenStep(
    step: TokenStep,
    values: Record<string, string>,
    index: number,
  ): Promise<string | null> {
    if (!step.url) return null;

    const url = this.resolveTemplate(step.url, values);
    const headers = this.resolveHeaders(step.headers, values);
    const body = this.prepareBody(step, values, headers);
    const dispatcher = this.config?.tokenChain?.insecureTls ? insecureTlsAgent : undefined;
    const label = `step ${index + 1} (${step.name || 'unnamed'})`;

    try {
      const { statusCode, body: resBody } = await request(url, {
        method: step.method,
        headers,
        body,
        dispatcher,
      });

      if (statusCode >= 400) {
        const errorText = await this.readBodySafely(resBody);
        log.warn(
          `token-chain ${label} → ${step.method} ${url}\n` +
          `  status: ${statusCode}\n` +
          `  response: ${errorText}`,
        );
        return null;
      }

      const data = await resBody.json();
      const extracted = this.extractValue(data, step.extract);
      if (extracted === null) {
        log.warn(
          `token-chain ${label} → extract "${step.extract}" returned nothing\n` +
          `  response: ${JSON.stringify(data)}`,
        );
      }
      return extracted;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const hint = (msg.includes('certificate') || msg.includes('CERT_'))
        ? '  (TLS error — enable "Allow insecure TLS" in the auth settings if this is a dev endpoint)'
        : '';
      log.warn(
        `token-chain ${label} → ${step.method} ${url} failed: ${msg}${hint ? '\n' + hint : ''}`,
      );
      return null;
    }
  }

  private async readBodySafely(body: { text(): Promise<string> }): Promise<string> {
    try {
      const text = await body.text();
      return text.length > 2000 ? text.slice(0, 2000) + '…(truncated)' : text;
    } catch {
      return '<unreadable body>';
    }
  }

  private resolveHeaders(
    headers: Record<string, string> | undefined,
    values: Record<string, string>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers ?? {})) {
      if (k) out[k] = this.resolveTemplate(v, values);
    }
    return out;
  }

  private prepareBody(
    step: TokenStep,
    values: Record<string, string>,
    headers: Record<string, string>,
  ): string | undefined {
    if (step.bodyType === 'none') return undefined;

    if (step.bodyType === 'raw') {
      const raw = step.bodyRaw ?? '';
      if (!raw.trim()) return undefined;
      headers['Content-Type'] ??= 'application/json';
      return this.resolveTemplate(raw, values);
    }

    const entries = Object.entries(step.body ?? {});
    if (entries.length === 0) return undefined;

    const resolved = entries.map(([k, v]) => [k, this.resolveTemplate(v, values)] as const);

    if (step.bodyType === 'form') {
      const params = new URLSearchParams();
      for (const [k, v] of resolved) params.append(k, v);
      headers['Content-Type'] ??= 'application/x-www-form-urlencoded';
      return params.toString();
    }

    const obj: Record<string, string> = {};
    for (const [k, v] of resolved) obj[k] = v;
    headers['Content-Type'] ??= 'application/json';
    return JSON.stringify(obj);
  }

  private extractValue(data: unknown, path: string): string | null {
    const results = JSONPath({ path, json: data as object }) as unknown[];
    const first = results[0];
    if (typeof first === 'string') return first;
    if (typeof first === 'number' || typeof first === 'boolean') return String(first);
    if (first !== undefined && first !== null) return JSON.stringify(first);
    return null;
  }

  /** Replace `{{name}}` occurrences with entries from `values`. */
  private resolveTemplate(input: string, values: Record<string, string>): string {
    return input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => {
      return key in values ? values[key] : match;
    });
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
