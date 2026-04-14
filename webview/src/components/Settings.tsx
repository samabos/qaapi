import { useState, useEffect } from 'react';
import type { QAAPIConfig, AuthConfig, RoleCredentials } from '../types';

interface SettingsProps {
  config: QAAPIConfig | null;
  authConfig: AuthConfig | null;
  onSave: (config: QAAPIConfig) => void;
  onSaveAuth: (config: AuthConfig) => void;
  onClose: () => void;
}

interface RoleEntry {
  role: string;
  email: string;
  password: string;
}

function credentialsToEntries(creds?: Record<string, RoleCredentials>): RoleEntry[] {
  if (!creds || Object.keys(creds).length === 0) {
    return [{ role: '', email: '', password: '' }];
  }
  return Object.entries(creds).map(([role, c]) => ({ role, email: c.email, password: c.password }));
}

function entriesToCredentials(entries: RoleEntry[]): Record<string, RoleCredentials> {
  const out: Record<string, RoleCredentials> = {};
  for (const e of entries) {
    const role = e.role.trim();
    if (role) out[role] = { email: e.email, password: e.password };
  }
  return out;
}

export default function Settings({ config, authConfig, onSave, onSaveAuth, onClose }: SettingsProps) {
  const [baseUrl, setBaseUrl] = useState('');
  const [openApiPath, setOpenApiPath] = useState('');
  const [sourcePaths, setSourcePaths] = useState('');
  const [envName, setEnvName] = useState('');

  // Auth state
  const [strategy, setStrategy] = useState<AuthConfig['strategy']>('none');
  const [loginEndpoint, setLoginEndpoint] = useState('');
  const [registerEndpoint, setRegisterEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [oauth2TokenUrl, setOauth2TokenUrl] = useState('');
  const [oauth2ClientId, setOauth2ClientId] = useState('');
  const [oauth2ClientSecret, setOauth2ClientSecret] = useState('');
  const [oauth2Scope, setOauth2Scope] = useState('');
  const [roleEntries, setRoleEntries] = useState<RoleEntry[]>([{ role: '', email: '', password: '' }]);

  useEffect(() => {
    if (!config) return;
    const active = config.activeEnvironment;
    setEnvName(active);
    setBaseUrl(config.environments[active]?.baseUrl ?? '');
    setOpenApiPath(config.openApiPath);
    setSourcePaths(config.sourcePaths.join(', '));
  }, [config]);

  useEffect(() => {
    if (!authConfig) return;
    setStrategy(authConfig.strategy);
    setLoginEndpoint(authConfig.loginEndpoint ?? '');
    setRegisterEndpoint(authConfig.registerEndpoint ?? '');
    setApiKey(authConfig.apiKey ?? '');
    setOauth2TokenUrl(authConfig.oauth2?.tokenUrl ?? '');
    setOauth2ClientId(authConfig.oauth2?.clientId ?? '');
    setOauth2ClientSecret(authConfig.oauth2?.clientSecret ?? '');
    setOauth2Scope(authConfig.oauth2?.scope ?? '');
    setRoleEntries(credentialsToEntries(authConfig.credentials));
  }, [authConfig]);

  const handleSave = () => {
    if (!config) return;

    const updatedConfig: QAAPIConfig = {
      ...config,
      openApiPath,
      sourcePaths: sourcePaths
        .split(',')
        .map(p => p.trim())
        .filter(Boolean),
      environments: {
        ...config.environments,
        [envName]: { baseUrl },
      },
    };

    const updatedAuth: AuthConfig = { strategy };
    if (strategy === 'credentials' || strategy === 'auto-register') {
      updatedAuth.loginEndpoint = loginEndpoint;
      updatedAuth.credentials = entriesToCredentials(roleEntries);
      if (strategy === 'auto-register') {
        updatedAuth.registerEndpoint = registerEndpoint;
      }
    } else if (strategy === 'api-key') {
      updatedAuth.apiKey = apiKey;
    } else if (strategy === 'oauth2-client-credentials') {
      updatedAuth.oauth2 = {
        tokenUrl: oauth2TokenUrl,
        clientId: oauth2ClientId,
        clientSecret: oauth2ClientSecret,
        ...(oauth2Scope ? { scope: oauth2Scope } : {}),
      };
    }

    onSave(updatedConfig);
    onSaveAuth(updatedAuth);
  };

  const updateRole = (idx: number, field: keyof RoleEntry, value: string) => {
    setRoleEntries(prev => prev.map((e, i) => (i === idx ? { ...e, [field]: value } : e)));
  };

  const addRole = () => {
    setRoleEntries(prev => [...prev, { role: '', email: '', password: '' }]);
  };

  const removeRole = (idx: number) => {
    setRoleEntries(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const inputClass =
    'w-full bg-surface2 text-text text-sm px-3 py-2 rounded border border-border focus:border-accent outline-none font-mono';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface border border-border rounded-lg w-[480px] max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-text">Project Settings</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text text-lg leading-none"
          >
            &times;
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Base URL */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              Base URL
              <span className="ml-1 text-text-muted/60 font-normal">
                ({envName} environment)
              </span>
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:3000"
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-text-muted">
              The root URL of the API you want to test
            </p>
          </div>

          {/* OpenAPI / Swagger URL */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              OpenAPI / Swagger URL
            </label>
            <input
              type="text"
              value={openApiPath}
              onChange={(e) => setOpenApiPath(e.target.value)}
              placeholder="http://localhost:3000/api-docs/json"
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-text-muted">
              URL or file path to the OpenAPI/Swagger spec (JSON or YAML)
            </p>
          </div>

          {/* Source Paths */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              Codebase Path
            </label>
            <input
              type="text"
              value={sourcePaths}
              onChange={(e) => setSourcePaths(e.target.value)}
              placeholder="src/modules, src/controllers"
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-text-muted">
              Comma-separated directories to scan for source code (relative to workspace root).
              Useful for monorepos — point to the specific API's source.
            </p>
          </div>

          {/* ── Authentication ── */}
          <div className="border-t border-border pt-4">
            <h3 className="text-xs font-medium text-text mb-3">Authentication</h3>

            {/* Strategy */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-text-muted mb-1">Strategy</label>
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as AuthConfig['strategy'])}
                className="w-full bg-surface2 text-text text-sm px-3 py-2 rounded border border-border focus:border-accent outline-none"
              >
                <option value="none">None</option>
                <option value="credentials">Credentials</option>
                <option value="auto-register">Auto-register</option>
                <option value="api-key">API Key</option>
                <option value="oauth2-client-credentials">OAuth2 Client Credentials</option>
              </select>
            </div>

            {strategy === 'none' && (
              <p className="text-[11px] text-text-muted">
                No authentication will be applied. Requests will be sent without auth headers.
              </p>
            )}

            {(strategy === 'credentials' || strategy === 'auto-register') && (
              <div className="space-y-3">
                {/* Login endpoint */}
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    Login Endpoint
                  </label>
                  <input
                    type="text"
                    value={loginEndpoint}
                    onChange={(e) => setLoginEndpoint(e.target.value)}
                    placeholder="/auth/login"
                    className={inputClass}
                  />
                </div>

                {/* Register endpoint (auto-register only) */}
                {strategy === 'auto-register' && (
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">
                      Register Endpoint
                    </label>
                    <input
                      type="text"
                      value={registerEndpoint}
                      onChange={(e) => setRegisterEndpoint(e.target.value)}
                      placeholder="/auth/register"
                      className={inputClass}
                    />
                  </div>
                )}

                {/* Credentials */}
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    Credentials
                  </label>
                  <div className="space-y-2">
                    {roleEntries.map((entry, idx) => (
                      <div key={idx} className="flex items-start gap-1.5">
                        <input
                          type="text"
                          value={entry.role}
                          onChange={(e) => updateRole(idx, 'role', e.target.value)}
                          placeholder="role"
                          className="w-[80px] bg-surface2 text-text text-xs px-2 py-1.5 rounded border border-border focus:border-accent outline-none font-mono"
                        />
                        <input
                          type="text"
                          value={entry.email}
                          onChange={(e) => updateRole(idx, 'email', e.target.value)}
                          placeholder="email"
                          className="flex-1 bg-surface2 text-text text-xs px-2 py-1.5 rounded border border-border focus:border-accent outline-none font-mono"
                        />
                        <input
                          type="password"
                          value={entry.password}
                          onChange={(e) => updateRole(idx, 'password', e.target.value)}
                          placeholder="password"
                          className="flex-1 bg-surface2 text-text text-xs px-2 py-1.5 rounded border border-border focus:border-accent outline-none font-mono"
                        />
                        <button
                          onClick={() => removeRole(idx)}
                          className="px-1.5 py-1 text-xs text-text-muted hover:text-red transition-colors"
                          title="Remove role"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={addRole}
                    className="mt-1.5 text-[11px] text-accent hover:text-accent/80 transition-colors"
                  >
                    + Add role
                  </button>
                </div>
              </div>
            )}

            {strategy === 'api-key' && (
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className={inputClass}
                />
                <p className="mt-1 text-[11px] text-text-muted">
                  Sent as a Bearer token in the Authorization header
                </p>
              </div>
            )}

            {strategy === 'oauth2-client-credentials' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    Token URL
                  </label>
                  <input
                    type="text"
                    value={oauth2TokenUrl}
                    onChange={(e) => setOauth2TokenUrl(e.target.value)}
                    placeholder="https://auth.example.com/oauth/token"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    Client ID
                  </label>
                  <input
                    type="text"
                    value={oauth2ClientId}
                    onChange={(e) => setOauth2ClientId(e.target.value)}
                    placeholder="my-client-id"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    Client Secret
                  </label>
                  <input
                    type="password"
                    value={oauth2ClientSecret}
                    onChange={(e) => setOauth2ClientSecret(e.target.value)}
                    placeholder="my-client-secret"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    Scope
                    <span className="ml-1 text-text-muted/60 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={oauth2Scope}
                    onChange={(e) => setOauth2Scope(e.target.value)}
                    placeholder="read write"
                    className={inputClass}
                  />
                  <p className="mt-1 text-[11px] text-text-muted">
                    Space-separated scopes. Token is cached and auto-refreshed on expiry.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded text-text-muted border border-border hover:text-text hover:border-text-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent/90 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
