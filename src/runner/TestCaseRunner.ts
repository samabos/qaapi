import { request, Agent } from 'undici';
import { JSONPath } from 'jsonpath-plus';

/** Allow self-signed dev certs on localhost — never applied to remote hosts. */
const insecureLocalhostAgent = new Agent({ connect: { rejectUnauthorized: false } });

function isLocalhost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}
import {
  Journey,
  Step,
  StepResult,
  RunResult,
  Assertion,
  AssertionResult,
  Extraction,
  StepStatus,
} from '../types';
import { AuthManager } from './AuthManager';

export interface StepUpdateCallback {
  (result: StepResult): void;
}

export class TestCaseRunner {
  constructor(private authManager: AuthManager) {}

  /**
   * Execute a journey. Calls onStepUpdate with live results as each step completes.
   */
  async run(
    journey: Journey,
    baseUrl: string,
    onStepUpdate?: StepUpdateCallback,
  ): Promise<RunResult> {
    const ctx: Record<string, unknown> = {};
    const stepResults: StepResult[] = [];
    const responses: Array<{ statusCode: number; headers: Record<string, string>; body: unknown }> = [];
    const startTime = Date.now();
    let halted = false;

    for (let i = 0; i < journey.steps.length; i++) {
      const step = journey.steps[i];

      if (halted) {
        const skipped = this.makeResult(step, 'skipped');
        stepResults.push(skipped);
        onStepUpdate?.(skipped);
        continue;
      }

      const running = this.makeResult(step, 'running');
      onStepUpdate?.(running);

      try {
        const result = await this.executeStep(step, baseUrl, ctx);
        responses.push({
          statusCode: result.statusCode!,
          headers: result.responseHeaders ?? {},
          body: result.responseBody,
        });

        // Run extractions for this step
        try {
          this.applyExtractions(journey.extractions, i, responses, ctx);
          result.extractedValues = { ...ctx };
        } catch (err) {
          result.status = 'failed';
          result.error = `Extraction failed: ${err instanceof Error ? err.message : String(err)}`;
          halted = true;
        }

        if (result.status === 'failed') halted = true;

        stepResults.push(result);
        onStepUpdate?.(result);
      } catch (err) {
        const failed = this.makeResult(step, 'failed');
        failed.error = err instanceof Error ? err.message : String(err);
        stepResults.push(failed);
        onStepUpdate?.(failed);
        halted = true;
      }
    }

    const passed = stepResults.every(r => r.status === 'passed' || r.status === 'skipped');

    return {
      suiteId: '',
      journeyId: journey.id,
      steps: stepResults,
      passed: passed && stepResults.some(r => r.status === 'passed'),
      durationMs: Date.now() - startTime,
    };
  }

  /* ---- Step execution ------------------------------------------- */

  private async executeStep(
    step: Step,
    baseUrl: string,
    ctx: Record<string, unknown>,
  ): Promise<StepResult> {
    const start = Date.now();
    // 1. Substitute {name} placeholders with step.pathParams values.
    // 2. Then resolve {{ctx.*}} / {{env.*}} templates.
    const pathWithParams = this.substitutePathParams(step.path, step.pathParams);
    const path = this.resolveTemplate(pathWithParams, ctx, baseUrl);
    const url = path.startsWith('http') ? path : `${baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.resolveTemplateObj(step.headers ?? {}, ctx, baseUrl),
    };

    // Inject auth token (ensureToken auto-refreshes expired OAuth2 tokens)
    const token = await this.authManager.ensureToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Resolve payload templates
    const resolvedPayload = step.payload
      ? this.resolvePayload(step.payload, ctx, baseUrl)
      : undefined;
    const body = resolvedPayload ? JSON.stringify(resolvedPayload) : undefined;

    // Build query string
    const resolvedParams = this.resolveTemplateObj(step.queryParams ?? {}, ctx, baseUrl);
    const qs = new URLSearchParams(resolvedParams).toString();
    const fullUrl = qs ? `${url}?${qs}` : url;

    const response = await request(fullUrl, {
      method: step.method,
      headers,
      body,
      dispatcher: isLocalhost(fullUrl) ? insecureLocalhostAgent : undefined,
    });

    const responseBody = await response.body.json().catch(() => null);
    const responseHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(response.headers)) {
      if (typeof v === 'string') responseHeaders[k] = v;
    }

    const statusMatch = step.expectedStatus !== undefined
      ? response.statusCode === step.expectedStatus
      : response.statusCode < 400;

    const assertionResults = this.evaluateAssertions(step.assertions, responseBody);
    const allAssertionsPass = assertionResults.every(a => a.passed);

    const status: StepStatus = (statusMatch && allAssertionsPass) ? 'passed' : 'failed';

    return {
      stepId: step.id,
      stepName: step.name,
      method: step.method,
      path: step.path,
      status,
      statusCode: response.statusCode,
      expectedStatusCode: step.expectedStatus,
      requestUrl: fullUrl,
      requestHeaders: headers,
      requestBody: resolvedPayload,
      responseBody,
      responseHeaders,
      assertions: assertionResults,
      durationMs: Date.now() - start,
    };
  }

  /* ---- Template resolution -------------------------------------- */

  /** Replace `{name}` segments in a path with values from pathParams.
   *  Leaves `{{double}}` templates alone so ctx/env resolution still works. */
  private substitutePathParams(path: string, params: Record<string, string> | undefined): string {
    if (!params) return path;
    return path.replaceAll(/\{([^{}]+)\}/g, (match, key: string) => {
      const value = params[key];
      return value !== undefined && value !== '' ? encodeURIComponent(value) : match;
    });
  }

  private resolveTemplate(template: string, ctx: Record<string, unknown>, baseUrl: string): string {
    return template.replace(/\{\{(ctx|env)\.(\w+)\}\}/g, (_match, scope: string, key: string) => {
      if (scope === 'ctx') return String(ctx[key] ?? '');
      if (scope === 'env' && key === 'baseUrl') return baseUrl;
      return '';
    });
  }

  private resolveTemplateObj(
    obj: Record<string, string>,
    ctx: Record<string, unknown>,
    baseUrl: string,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = this.resolveTemplate(v, ctx, baseUrl);
    }
    return result;
  }

  private resolvePayload(
    payload: Record<string, unknown>,
    ctx: Record<string, unknown>,
    baseUrl: string,
  ): Record<string, unknown> {
    const json = JSON.stringify(payload);
    const resolved = this.resolveTemplate(json, ctx, baseUrl);
    return JSON.parse(resolved) as Record<string, unknown>;
  }

  /* ---- Extractions ---------------------------------------------- */

  private applyExtractions(
    extractions: Extraction[],
    currentStepIndex: number,
    responses: Array<{ statusCode: number; headers: Record<string, string>; body: unknown }>,
    ctx: Record<string, unknown>,
  ): void {
    for (const ext of extractions) {
      const match = ext.from.match(/^steps\.(\d+)\.response\.(.+)$/);
      if (!match) continue;

      const stepIdx = parseInt(match[1], 10);
      if (stepIdx !== currentStepIndex) continue;

      const jsonPath = `$.${match[2]}`;
      const response = responses[stepIdx];
      if (!response) {
        throw new Error(`No response for step ${stepIdx} (extraction: ${ext.from})`);
      }

      const envelope = {
        statusCode: response.statusCode,
        headers: response.headers,
        body: response.body,
      };

      const results = JSONPath({ path: jsonPath, json: envelope });
      if (results.length === 0) {
        throw new Error(`JSONPath "${jsonPath}" returned no results for extraction ${ext.from} → ${ext.to}`);
      }

      const ctxKey = ext.to.replace(/^ctx\./, '');
      ctx[ctxKey] = results[0];
    }
  }

  /* ---- Assertions ----------------------------------------------- */

  private evaluateAssertions(assertions: Assertion[], responseBody: unknown): AssertionResult[] {
    return assertions.map(a => this.evaluateAssertion(a, responseBody));
  }

  private evaluateAssertion(assertion: Assertion, responseBody: unknown): AssertionResult {
    const envelope = { body: responseBody };
    const results = JSONPath({ path: assertion.path, json: envelope });
    const actual = results.length > 0 ? results[0] : undefined;

    if (assertion.exists !== undefined) {
      const passed = assertion.exists ? actual !== undefined : actual === undefined;
      return { path: assertion.path, passed, expected: assertion.exists, actual };
    }

    if (assertion.equals !== undefined) {
      const passed = JSON.stringify(actual) === JSON.stringify(assertion.equals);
      return { path: assertion.path, passed, expected: assertion.equals, actual };
    }

    if (assertion.contains !== undefined) {
      const passed = typeof actual === 'string' && typeof assertion.contains === 'string'
        ? actual.includes(assertion.contains)
        : Array.isArray(actual) && actual.includes(assertion.contains);
      return { path: assertion.path, passed, expected: assertion.contains, actual };
    }

    if (assertion.greaterThan !== undefined) {
      const passed = typeof actual === 'number' && actual > assertion.greaterThan;
      return { path: assertion.path, passed, expected: assertion.greaterThan, actual };
    }

    return { path: assertion.path, passed: true, actual };
  }

  /* ---- Helpers -------------------------------------------------- */

  private makeResult(step: Step, status: StepStatus): StepResult {
    return {
      stepId: step.id,
      stepName: step.name,
      method: step.method,
      path: step.path,
      status,
      assertions: [],
    };
  }
}
