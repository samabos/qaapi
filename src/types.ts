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
  strategy: 'credentials' | 'auto-register' | 'api-key' | 'oauth2-client-credentials' | 'none';
  credentials?: Record<string, RoleCredentials>;
  loginEndpoint?: string;
  registerEndpoint?: string;
  apiKey?: string;
  oauth2?: OAuth2ClientCredentials;
}

export interface OAuth2ClientCredentials {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
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
  roleGuards: RoleGuard[];
  validationRules: ValidationRule[];
  errorConditions: ErrorCondition[];
  dtoDefinitions: DtoDefinition[];
  roleEnums: RoleEnum[];
}

export interface RoleGuard {
  filePath: string;
  line: number;
  roles: string[];
  handler?: string;
}

export interface ValidationRule {
  filePath: string;
  line: number;
  field: string;
  decorator: string;
  params?: string;
}

export interface ErrorCondition {
  filePath: string;
  line: number;
  exceptionType: string;
  message?: string;
}

export interface DtoDefinition {
  filePath: string;
  className: string;
  fields: string[];
}

export interface RoleEnum {
  filePath: string;
  name: string;
  values: string[];
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
  | { type: 'SET_ENVIRONMENT'; name: string }
  | { type: 'SET_AUTH'; config: AuthConfig }
  | { type: 'UPDATE_CONFIG'; config: QAAPIConfig }
  | { type: 'CANCEL_GENERATION' }
  | { type: 'OPEN_SETTINGS' };
