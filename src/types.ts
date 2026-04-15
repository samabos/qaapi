/* ------------------------------------------------------------------ */
/*  Data Model                                                        */
/* ------------------------------------------------------------------ */

export interface QAAPIConfig {
  environments: Record<string, Environment>;
  activeEnvironment: string;
  openApiPath: string;
  sourcePaths: string[];
}

export interface Environment {
  baseUrl: string;
}

export interface AuthConfig {
  strategy: 'credentials' | 'auto-register' | 'api-key' | 'oauth2-client-credentials' | 'token-chain' | 'none';
  credentials?: Record<string, RoleCredentials>;
  loginEndpoint?: string;
  registerEndpoint?: string;
  apiKey?: string;
  oauth2?: OAuth2ClientCredentials;
  tokenChain?: TokenChain;
}

export interface OAuth2ClientCredentials {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
}

/**
 * A token-chain executes N requests in order. Each step extracts a value
 * from its response (JSONPath); that value is available to subsequent
 * steps as `{{<step.name>}}` inside headers and body values. The LAST
 * step's extracted value is the bearer token used on every test request.
 */
export interface TokenChain {
  steps: TokenStep[];
  /** Bypass TLS cert verification on every step. For dev servers with
   *  self-signed / untrusted chains. Never enable against production. */
  insecureTls?: boolean;
}

export interface TokenStep {
  name: string;                        // referenced by later steps as {{name}}
  method: 'GET' | 'POST';
  url: string;                         // absolute URL
  bodyType: 'json' | 'form' | 'raw' | 'none';
  /** Used for 'json' and 'form' body types. Values support {{<name>}}. */
  body?: Record<string, string>;
  /** Used for 'raw' body type. Full string with {{<name>}} templates resolved before sending. */
  bodyRaw?: string;
  headers?: Record<string, string>;    // values support {{<name>}} templates
  extract: string;                     // JSONPath into response body, e.g. $.access_token
}

export interface RoleCredentials {
  email: string;
  password: string;
}

/* ------------------------------------------------------------------ */
/*  Test Suite                                                        */
/* ------------------------------------------------------------------ */

export interface TestSuite {
  id: string;
  name: string;
  journeys: Journey[];
  generatedAt: string;
  sourceHash: string;
}

export interface Journey {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  steps: Step[];
  extractions: Extraction[];
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Step {
  id: string;
  name: string;
  method: HttpMethod;
  path: string;
  payload?: Record<string, unknown>;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  expectedStatus: number;
  assertions: Assertion[];
}

export interface Extraction {
  from: string;
  to: string;
}

export interface Assertion {
  path: string;
  exists?: boolean;
  equals?: unknown;
  contains?: unknown;
  greaterThan?: number;
}

/* ------------------------------------------------------------------ */
/*  Execution Results                                                 */
/* ------------------------------------------------------------------ */

export type StepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface StepResult {
  stepId: string;
  stepName: string;
  method: HttpMethod;
  path: string;
  status: StepStatus;
  statusCode?: number;
  expectedStatusCode?: number;
  requestUrl?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseBody?: unknown;
  responseHeaders?: Record<string, string>;
  assertions: AssertionResult[];
  extractedValues?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
}

export interface AssertionResult {
  path: string;
  passed: boolean;
  expected?: unknown;
  actual?: unknown;
  error?: string;
}

export interface RunResult {
  suiteId: string;
  journeyId: string;
  journeyName?: string;
  steps: StepResult[];
  passed: boolean;
  durationMs: number;
}

/* ------------------------------------------------------------------ */
/*  Source Parsing                                                     */
/* ------------------------------------------------------------------ */

export interface SourceContext {
  dtoDefinitions: DtoDefinition[];
}

export interface DtoDefinition {
  filePath: string;
  className: string;
  fields: string[];
}

/* ------------------------------------------------------------------ */
/*  Message Protocol: Extension → Webview                             */
/* ------------------------------------------------------------------ */

export type ExtensionToWebviewMessage =
  | { type: 'ENVIRONMENTS_LOADED'; environments: Record<string, Environment>; active: string }
  | { type: 'CONFIG_LOADED'; config: QAAPIConfig }
  | { type: 'TEST_SUITES_LOADED'; suites: TestSuite[] }
  | { type: 'GENERATION_PROGRESS'; message: string; progress: number }
  | { type: 'TEST_STEP_UPDATE'; result: StepResult }
  | { type: 'RUN_COMPLETE'; result: RunResult }
  | { type: 'AUTH_CONFIG_LOADED'; config: AuthConfig }
  | { type: 'AUTH_STATUS'; strategy: string; user?: string; ready: boolean }
  | { type: 'API_STATUS'; reachable: boolean; latency?: number }
  | { type: 'PAYLOAD_SUGGESTION'; stepId: string; payload?: Record<string, unknown>; error?: string }
  | { type: 'CASES_EXPANDED'; suiteId: string; journeyId: string; added: number; error?: string }
  | { type: 'ERROR'; message: string };

/* ------------------------------------------------------------------ */
/*  Message Protocol: Webview → Extension                             */
/* ------------------------------------------------------------------ */

export type WebviewToExtensionMessage =
  | { type: 'READY' }
  | { type: 'GENERATE_TESTS'; force?: boolean }
  | { type: 'RUN_TESTS'; suiteId?: string; journeyId?: string; stepId?: string }
  | { type: 'UPDATE_TEST_CASE'; suiteId: string; journey: Journey }
  | { type: 'DELETE_TEST_CASE'; suiteId: string; journeyId: string }
  | { type: 'DELETE_SUITE'; suiteId: string }
  | { type: 'SET_ENVIRONMENT'; name: string }
  | { type: 'SET_AUTH'; config: AuthConfig }
  | { type: 'UPDATE_CONFIG'; config: QAAPIConfig }
  | { type: 'CANCEL_GENERATION' }
  | { type: 'OPEN_SETTINGS' }
  | { type: 'EXPORT_BUNDLE' }
  | { type: 'IMPORT_BUNDLE' }
  | { type: 'SUGGEST_PAYLOAD'; suiteId: string; journeyId: string; stepId: string; description: string }
  | { type: 'EXPAND_CASES'; suiteId: string; journeyId: string };
