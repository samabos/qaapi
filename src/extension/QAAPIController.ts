import * as vscode from 'vscode';
import {
  QAAPIConfig,
  AuthConfig,
  TestSuite,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from '../types';
import { FileStore } from '../store/FileStore';
import { AIGenerator, ClaudeCliMissingError } from '../ai/AIGenerator';
import { OpenAPIGenerator } from '../generator/OpenAPIGenerator';
import { SourceParser } from '../parser/SourceParser';
import { AuthManager } from '../runner/AuthManager';
import { TestCaseRunner } from '../runner/TestCaseRunner';
import { request, Agent } from 'undici';
import SwaggerParser from '@apidevtools/swagger-parser';
import { encryptBundle, decryptBundle, isEncryptedBundle } from '../crypto/bundle';
import { log } from '../Logger';

/** Allow self-signed dev certs (ASP.NET, Vite, etc) on localhost only. */
const insecureLocalhostAgent = new Agent({ connect: { rejectUnauthorized: false } });

function isLocalhost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}


export class QAAPIController {
  private store: FileStore | undefined;
  private config: QAAPIConfig | undefined;
  private authConfig: AuthConfig | undefined;
  private sourceParser = new SourceParser();
  private authManager = new AuthManager();
  private testCaseRunner = new TestCaseRunner(this.authManager);
  private generator = new AIGenerator();
  private openApiGenerator = new OpenAPIGenerator();
  private suites: TestSuite[] = [];

  onMessage: ((msg: ExtensionToWebviewMessage) => void) | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (root) {
      this.store = new FileStore(root);
    }
  }

  dispose(): void {
    // cleanup if needed
  }

  /* ---- Webview message handler ---------------------------------- */

  async handleWebviewMessage(msg: WebviewToExtensionMessage): Promise<void> {
    try {
      switch (msg.type) {
        case 'READY':
          await this.initialize();
          break;
        case 'GENERATE_TESTS':
          await this.generateTests(msg.force);
          break;
        case 'RUN_TESTS':
          await this.runTests(msg.suiteId, msg.journeyId, msg.stepId);
          break;
        case 'UPDATE_TEST_CASE':
          await this.updateTestCase(msg.suiteId, msg.journey);
          break;
        case 'DELETE_TEST_CASE':
          await this.deleteTestCase(msg.suiteId, msg.journeyId);
          break;
        case 'DELETE_SUITE':
          await this.deleteSuite(msg.suiteId);
          break;
        case 'SET_ENVIRONMENT':
          await this.setEnvironment(msg.name);
          break;
        case 'SET_AUTH':
          await this.setAuth(msg.config);
          break;
        case 'UPDATE_CONFIG':
          await this.updateConfig(msg.config);
          break;
        case 'CANCEL_GENERATION':
          this.generator.cancel();
          break;
        case 'OPEN_SETTINGS':
          vscode.commands.executeCommand('workbench.action.openSettings', 'qaapi');
          break;
        case 'EXPORT_BUNDLE':
          await this.exportBundle();
          break;
        case 'IMPORT_BUNDLE':
          await this.importBundle();
          break;
        case 'SUGGEST_PAYLOAD':
          await this.suggestPayload(msg.suiteId, msg.journeyId, msg.stepId, msg.description);
          break;
        case 'EXPAND_CASES':
          await this.expandCases(msg.suiteId, msg.journeyId);
          break;
      }
    } catch (err) {
      this.send({ type: 'ERROR', message: err instanceof Error ? err.message : String(err) });
    }
  }

  /* ---- Initialize ----------------------------------------------- */

  private async initialize(): Promise<void> {
    if (!this.store) {
      this.send({ type: 'ERROR', message: 'No workspace folder open.' });
      return;
    }

    await this.store.ensureStructure();

    this.config = (await this.store.readConfig()) ?? this.defaultConfig();
    this.authConfig = (await this.store.readAuth()) ?? undefined;

    this.send({ type: 'CONFIG_LOADED', config: this.config });
    this.send({
      type: 'ENVIRONMENTS_LOADED',
      environments: this.config.environments,
      active: this.config.activeEnvironment,
    });

    // Send saved auth config so the webview can populate Settings + TopBar
    if (this.authConfig) {
      this.send({ type: 'AUTH_CONFIG_LOADED', config: this.authConfig });
      this.send({
        type: 'AUTH_STATUS',
        strategy: this.authConfig.strategy,
        ready: this.authConfig.strategy !== 'none',
      });
    }

    this.suites = await this.store.readAllSuites();
    this.send({ type: 'TEST_SUITES_LOADED', suites: this.suites });

    await this.checkApiHealth();
  }

  /* ---- Test generation ------------------------------------------ */

  async generateTests(force?: boolean): Promise<void> {
    if (!this.config || !this.store) return;

    const spec = await this.fetchSpecWithRetry(this.config.openApiPath);
    if (!spec) return;

    // Group endpoints by domain (first path segment)
    const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;
    const domains = new Map<string, Record<string, Record<string, unknown>>>();
    for (const [pathKey, pathItem] of Object.entries(paths)) {
      const domain = pathKey.split('/').filter(Boolean)[0] ?? 'default';
      if (!domains.has(domain)) domains.set(domain, {});
      domains.get(domain)![pathKey] = pathItem;
    }

    await this.generateFromOpenAPI(domains);

    this.suites = await this.store.readAllSuites();
    this.send({ type: 'TEST_SUITES_LOADED', suites: this.suites });
    this.send({ type: 'GENERATION_PROGRESS', message: 'Done', progress: 100 });
  }

  /**
   * Deterministic Postman-style generation directly from the OpenAPI spec.
   * **Idempotent merge**: existing suites are read, and only endpoints not
   * already present (by method+path) are appended. User-edited journeys —
   * including payloads, headers, assertions, and names — are never touched.
   * To re-import an endpoint that was edited or removed, delete the journey
   * first and run import again.
   */
  private async generateFromOpenAPI(
    domains: Map<string, Record<string, Record<string, unknown>>>,
  ): Promise<void> {
    const total = domains.size || 1;
    let completed = 0;
    const specHash = OpenAPIGenerator.sourceHash(
      JSON.stringify([...domains.entries()]),
    );

    for (const [domain, domainPaths] of domains) {
      this.send({
        type: 'GENERATION_PROGRESS',
        message: `Importing ${domain}...`,
        progress: Math.round((completed / total) * 100),
      });

      const generated = this.openApiGenerator.generate(domain, domainPaths);
      const existing = this.suites.find(s => s.id === domain);
      const merged = this.mergeSuite(existing, generated, specHash);
      await this.store!.writeSuite(merged);
      completed++;
    }
  }

  /** Append only new endpoints (by method+path). Preserve user edits. */
  private mergeSuite(
    existing: TestSuite | undefined,
    generated: TestSuite,
    specHash: string,
  ): TestSuite {
    if (!existing) {
      return { ...generated, sourceHash: specHash };
    }

    const endpointKey = (j: import('../types').Journey) => {
      const first = j.steps[0];
      return first ? `${first.method}:${first.path}` : '';
    };

    const existingKeys = new Set(existing.journeys.map(endpointKey).filter(Boolean));
    const newJourneys = generated.journeys.filter(j => !existingKeys.has(endpointKey(j)));

    return {
      ...existing,
      journeys: [...existing.journeys, ...newJourneys],
      generatedAt: new Date().toISOString(),
      sourceHash: specHash,
    };
  }

  /* ---- Test execution ------------------------------------------- */

  async runTests(suiteId?: string, journeyId?: string, stepId?: string): Promise<void> {
    if (!this.config) return;

    const baseUrl = this.config.environments[this.config.activeEnvironment]?.baseUrl;
    if (!baseUrl) {
      this.send({ type: 'ERROR', message: 'No base URL configured for active environment.' });
      return;
    }

    // Bootstrap auth
    if (this.authConfig) {
      this.authManager.setConfig(this.authConfig, baseUrl);
      const ready = await this.authManager.bootstrap();
      this.send({
        type: 'AUTH_STATUS',
        strategy: this.authConfig.strategy,
        ready,
      });
      if (!ready && this.authConfig.strategy !== 'none') {
        this.send({
          type: 'ERROR',
          message: `Auth failed (strategy: ${this.authConfig.strategy}). See View, Output, qaapi for details.`,
        });
      }
    }

    const suitesToRun = suiteId
      ? this.suites.filter(s => s.id === suiteId)
      : this.suites;

    for (const suite of suitesToRun) {
      const journeysToRun = journeyId
        ? suite.journeys.filter(j => j.id === journeyId)
        : suite.journeys;

      for (const journey of journeysToRun) {
        const result = await this.testCaseRunner.run(
          journey,
          baseUrl,
          (stepResult) => {
            if (!stepId || stepResult.stepId === stepId) {
              this.send({ type: 'TEST_STEP_UPDATE', result: stepResult });
            }
          },
        );

        result.suiteId = suite.id;
        result.journeyName = journey.name;
        this.send({ type: 'RUN_COMPLETE', result });
      }
    }
  }

  /* ---- CRUD ----------------------------------------------------- */

  private async updateTestCase(suiteId: string, journey: import('../types').Journey): Promise<void> {
    const suite = this.suites.find(s => s.id === suiteId);
    if (!suite || !this.store) return;

    const idx = suite.journeys.findIndex(j => j.id === journey.id);
    if (idx >= 0) {
      suite.journeys[idx] = journey;
    } else {
      suite.journeys.push(journey);
    }

    await this.store.writeSuite(suite);
    this.suites = await this.store.readAllSuites();
    this.send({ type: 'TEST_SUITES_LOADED', suites: this.suites });
  }

  private async deleteTestCase(suiteId: string, journeyId: string): Promise<void> {
    const suite = this.suites.find(s => s.id === suiteId);
    if (!suite || !this.store) return;

    suite.journeys = suite.journeys.filter(j => j.id !== journeyId);
    await this.store.writeSuite(suite);
    this.suites = await this.store.readAllSuites();
    this.send({ type: 'TEST_SUITES_LOADED', suites: this.suites });
  }

  private async deleteSuite(suiteId: string): Promise<void> {
    if (!this.store) return;
    await this.store.deleteSuite(suiteId);
    this.suites = await this.store.readAllSuites();
    this.send({ type: 'TEST_SUITES_LOADED', suites: this.suites });
  }

  /* ---- AI: suggest payload for a single step --------------------- */

  private async suggestPayload(
    suiteId: string,
    journeyId: string,
    stepId: string,
    description: string,
  ): Promise<void> {
    if (!this.config) return;
    const suite = this.suites.find(s => s.id === suiteId);
    const journey = suite?.journeys.find(j => j.id === journeyId);
    const step = journey?.steps.find(s => s.id === stepId);
    if (!step) {
      this.send({ type: 'PAYLOAD_SUGGESTION', stepId, error: 'Step not found.' });
      return;
    }

    try {
      const spec = await this.fetchAndDereference(this.config.openApiPath);
      const specPaths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;
      const operation = specPaths[step.path]?.[step.method.toLowerCase()] ?? null;

      // Best-effort DTO lookup from the configured source paths.
      let dtoSource: string | null = null;
      try {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (root && this.config.sourcePaths.length > 0) {
          dtoSource = await this.findDtoSource(root, this.config.sourcePaths, step, operation);
        }
      } catch (err) {
        log.warn(`DTO lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      log.info(`Suggesting payload for ${step.method} ${step.path} — case: ${description || '(none)'}`);
      const payload = await this.generator.suggestPayload({
        method: step.method,
        path: step.path,
        caseDescription: description,
        openApiOperation: operation,
        dtoSource,
        currentPayload: step.payload,
      });

      this.send({ type: 'PAYLOAD_SUGGESTION', stepId, payload });
    } catch (err) {
      if (err instanceof ClaudeCliMissingError) {
        await this.promptInstallClaudeCli();
        this.send({ type: 'PAYLOAD_SUGGESTION', stepId, error: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Payload suggestion failed for ${stepId}: ${msg}`);
      this.send({ type: 'PAYLOAD_SUGGESTION', stepId, error: msg });
    }
  }

  /* ---- AI: expand test cases for an endpoint --------------------- */

  private async expandCases(suiteId: string, journeyId: string): Promise<void> {
    if (!this.config) return;
    const suite = this.suites.find(s => s.id === suiteId);
    const journey = suite?.journeys.find(j => j.id === journeyId);
    const step = journey?.steps[0];
    if (!suite || !journey || !step) {
      this.send({ type: 'CASES_EXPANDED', suiteId, journeyId, added: 0, error: 'Journey not found.' });
      return;
    }

    try {
      const spec = await this.fetchAndDereference(this.config.openApiPath);
      const specPaths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;
      const operation = specPaths[step.path]?.[step.method.toLowerCase()] ?? null;

      let dtoSource: string | null = null;
      try {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (root && this.config.sourcePaths.length > 0) {
          dtoSource = await this.findDtoSource(root, this.config.sourcePaths, step, operation);
        }
      } catch (err) {
        log.warn(`DTO lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Existing case names on this endpoint — so Claude doesn't duplicate
      const existingCaseNames = suite.journeys
        .filter(j => j.steps[0]?.method === step.method && j.steps[0]?.path === step.path)
        .map(j => j.name);

      log.info(`Expanding cases for ${step.method} ${step.path}`);
      const cases = await this.generator.expandCases({
        method: step.method,
        path: step.path,
        openApiOperation: operation,
        dtoSource,
        existingCaseNames,
      });

      if (cases.length === 0) {
        this.send({ type: 'CASES_EXPANDED', suiteId, journeyId, added: 0 });
        return;
      }

      // Append one Journey per generated case. Reuse the step's method/path.
      const timestamp = Date.now();
      for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        const slug = c.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'case';
        const newJourney: import('../types').Journey = {
          id: `${slug}-${timestamp}-${i}`,
          name: c.name,
          description: c.description || c.name,
          tags: [this.guessTag(c.expectedStatus)],
          extractions: [],
          steps: [{
            id: `${slug}-${timestamp}-${i}-step`,
            name: c.name,
            method: step.method,
            path: step.path,
            payload: c.payload,
            headers: c.headers,
            queryParams: c.queryParams,
            expectedStatus: c.expectedStatus,
            assertions: [],
          }],
        };
        suite.journeys.push(newJourney);
      }

      await this.store!.writeSuite(suite);
      this.suites = await this.store!.readAllSuites();
      this.send({ type: 'TEST_SUITES_LOADED', suites: this.suites });
      this.send({ type: 'CASES_EXPANDED', suiteId, journeyId, added: cases.length });
      log.info(`Added ${cases.length} case(s) to ${suite.name}`);
    } catch (err) {
      if (err instanceof ClaudeCliMissingError) {
        await this.promptInstallClaudeCli();
        this.send({ type: 'CASES_EXPANDED', suiteId, journeyId, added: 0, error: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Expand cases failed: ${msg}`);
      this.send({ type: 'CASES_EXPANDED', suiteId, journeyId, added: 0, error: msg });
    }
  }

  private guessTag(status: number): string {
    if (status >= 200 && status < 300) return 'happy-path';
    if (status === 404) return 'not-found';
    if (status >= 400 && status < 500) return 'validation';
    if (status >= 500) return 'edge-case';
    return 'edge-case';
  }

  /** Blocking modal when `claude` isn't on PATH. */
  private async promptInstallClaudeCli(): Promise<void> {
    const choice = await vscode.window.showErrorMessage(
      'qaapi AI needs the Claude Code CLI, but `claude` is not on your PATH.',
      {
        modal: true,
        detail:
          'Install Claude Code (https://docs.claude.com/en/docs/claude-code/setup), ' +
          'then FULLY restart VSCode — reloading the window is not enough; the extension host must pick up the new PATH.',
      },
      'Open install guide',
    );
    if (choice === 'Open install guide') {
      await vscode.env.openExternal(vscode.Uri.parse('https://docs.claude.com/en/docs/claude-code/setup'));
    }
  }

  /**
   * Try to find a DTO source snippet relevant to the step. Heuristic: parse
   * source, pick DTOs whose class name appears in the operation's
   * requestBody schema ref or summary. Falls back to the raw source cap.
   */
  private async findDtoSource(
    root: vscode.Uri,
    sourcePaths: string[],
    step: import('../types').Step,
    operation: unknown,
  ): Promise<string | null> {
    const ctx = await this.sourceParser.parse(root, sourcePaths);
    if (ctx.dtoDefinitions.length === 0) return null;

    const opJson = JSON.stringify(operation ?? {}).toLowerCase();
    const pathTokens = step.path.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

    const scored = ctx.dtoDefinitions.map(dto => {
      const name = dto.className.toLowerCase();
      let score = 0;
      if (opJson.includes(name)) score += 10;
      for (const tok of pathTokens) if (name.includes(tok)) score += 2;
      return { dto, score };
    });

    const top = scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    if (top.length === 0) return null;
    return top
      .map(({ dto }) => `// ${dto.filePath}\nclass ${dto.className} {\n  ${dto.fields.join('\n  ')}\n}`)
      .join('\n\n');
  }

  /* ---- Export / Import encrypted bundle -------------------------- */

  private async exportBundle(): Promise<void> {
    if (!this.config || !this.store) {
      this.send({ type: 'ERROR', message: 'Nothing to export — no workspace is open.' });
      return;
    }

    const password = await vscode.window.showInputBox({
      prompt: 'Set a password for the bundle. Send it to your colleague via a DIFFERENT channel than the file itself.',
      password: true,
      placeHolder: 'Strong password',
      ignoreFocusOut: true,
      validateInput: v => (v && v.length >= 8 ? null : 'Password must be at least 8 characters'),
    });
    if (!password) return;

    const confirm = await vscode.window.showInputBox({
      prompt: 'Confirm password',
      password: true,
      ignoreFocusOut: true,
      validateInput: v => (v === password ? null : 'Passwords do not match'),
    });
    if (!confirm) return;

    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('qaapi-bundle.enc.json'),
      filters: { 'qaapi bundle': ['json'] },
      saveLabel: 'Export encrypted bundle',
    });
    if (!target) return;

    const bundle = encryptBundle(
      {
        exportedAt: new Date().toISOString(),
        config: this.config,
        auth: this.authConfig ?? null,
        tests: this.suites,
      },
      password,
    );

    await vscode.workspace.fs.writeFile(
      target,
      Buffer.from(JSON.stringify(bundle, null, 2), 'utf-8'),
    );

    log.info(`Exported encrypted bundle to ${target.fsPath}`);
    this.send({
      type: 'ERROR',
      message: `Bundle saved. Share the file and password via separate channels.`,
    });
  }

  private async importBundle(): Promise<void> {
    if (!this.store) {
      this.send({ type: 'ERROR', message: 'Open a workspace before importing.' });
      return;
    }

    const picks = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'qaapi bundle': ['json'] },
      openLabel: 'Import encrypted bundle',
    });
    if (!picks?.[0]) return;

    let raw: unknown;
    try {
      const bytes = await vscode.workspace.fs.readFile(picks[0]);
      raw = JSON.parse(Buffer.from(bytes).toString('utf-8'));
    } catch (err) {
      this.send({ type: 'ERROR', message: `Could not read bundle: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }

    if (!isEncryptedBundle(raw)) {
      this.send({ type: 'ERROR', message: 'This file is not a qaapi encrypted bundle.' });
      return;
    }

    const password = await vscode.window.showInputBox({
      prompt: 'Enter the password for this bundle',
      password: true,
      ignoreFocusOut: true,
    });
    if (!password) return;

    let payload;
    try {
      payload = decryptBundle(raw, password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.send({ type: 'ERROR', message: msg });
      log.warn(`Bundle decrypt failed: ${msg}`);
      return;
    }

    const choice = await vscode.window.showWarningMessage(
      `Import will replace config and auth, and merge ${payload.tests.length} test suite(s). Continue?`,
      { modal: true },
      'Import',
    );
    if (choice !== 'Import') return;

    // Apply — merge suites by id (same rule as Sync), overwrite config and auth.
    this.config = payload.config;
    this.authConfig = payload.auth ?? undefined;
    await this.store.writeConfig(payload.config);
    if (payload.auth) {
      await this.store.writeAuth(payload.auth);
    }
    for (const incoming of payload.tests) {
      const existing = this.suites.find(s => s.id === incoming.id);
      const merged = this.mergeSuite(existing, incoming, incoming.sourceHash);
      await this.store.writeSuite(merged);
    }

    this.suites = await this.store.readAllSuites();
    this.send({ type: 'CONFIG_LOADED', config: this.config });
    this.send({
      type: 'ENVIRONMENTS_LOADED',
      environments: this.config.environments,
      active: this.config.activeEnvironment,
    });
    if (this.authConfig) {
      this.send({ type: 'AUTH_CONFIG_LOADED', config: this.authConfig });
      this.send({
        type: 'AUTH_STATUS',
        strategy: this.authConfig.strategy,
        ready: this.authConfig.strategy !== 'none',
      });
    }
    this.send({ type: 'TEST_SUITES_LOADED', suites: this.suites });
    log.info(`Imported bundle from ${picks[0].fsPath}: ${payload.tests.length} suite(s), config + auth updated.`);
  }

  /* ---- Environment ---------------------------------------------- */

  private async setEnvironment(name: string): Promise<void> {
    if (!this.config || !this.store) return;
    this.config.activeEnvironment = name;
    await this.store.writeConfig(this.config);
    this.send({
      type: 'ENVIRONMENTS_LOADED',
      environments: this.config.environments,
      active: name,
    });
    await this.checkApiHealth();
  }

  private async setAuth(config: AuthConfig): Promise<void> {
    this.authConfig = config;
    await this.store?.writeAuth(config);
    this.send({ type: 'AUTH_CONFIG_LOADED', config });
    this.send({
      type: 'AUTH_STATUS',
      strategy: config.strategy,
      ready: config.strategy !== 'none',
    });
  }

  private async updateConfig(config: QAAPIConfig): Promise<void> {
    if (!this.store) return;
    this.config = config;
    await this.store.writeConfig(config);
    this.send({ type: 'CONFIG_LOADED', config });
    this.send({
      type: 'ENVIRONMENTS_LOADED',
      environments: config.environments,
      active: config.activeEnvironment,
    });
    await this.checkApiHealth();
  }

  /* ---- OpenAPI fetch with retry ---------------------------------- */

  /**
   * Fetch the spec over HTTP (so we can bypass TLS for localhost dev certs)
   * then hand the parsed object to SwaggerParser for $ref dereferencing.
   * Falls back to SwaggerParser's own loader for non-http paths (file://, etc).
   */
  private async fetchAndDereference(specPath: string): Promise<Record<string, unknown>> {
    if (!/^https?:\/\//i.test(specPath)) {
      return (await SwaggerParser.dereference(specPath)) as Record<string, unknown>;
    }

    const dispatcher = isLocalhost(specPath) ? insecureLocalhostAgent : undefined;
    const { statusCode, body } = await request(specPath, { dispatcher });
    if (statusCode >= 400) {
      throw new Error(`HTTP ${statusCode} fetching spec`);
    }
    const raw = await body.json();
    const dereferenced = await SwaggerParser.dereference(raw as never);
    return dereferenced as unknown as Record<string, unknown>;
  }

  private async fetchSpecWithRetry(
    specPath: string,
    maxAttempts = 3,
    delayMs = 3000,
  ): Promise<Record<string, unknown> | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.send({
        type: 'GENERATION_PROGRESS',
        message: attempt === 1
          ? 'Fetching OpenAPI spec...'
          : `Retrying OpenAPI spec (attempt ${attempt}/${maxAttempts})...`,
        progress: 5,
      });

      try {
        return await this.fetchAndDereference(specPath);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);

        if (attempt < maxAttempts) {
          this.send({
            type: 'GENERATION_PROGRESS',
            message: `Spec unreachable — retrying in ${delayMs / 1000}s (${attempt}/${maxAttempts})...`,
            progress: 5,
          });
          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else {
          this.send({
            type: 'ERROR',
            message: `Failed to fetch OpenAPI spec after ${maxAttempts} attempts: ${errMsg}`,
          });
          return null;
        }
      }
    }

    return null;
  }

  /* ---- Health check --------------------------------------------- */

  private async checkApiHealth(): Promise<void> {
    if (!this.config) return;
    const baseUrl = this.config.environments[this.config.activeEnvironment]?.baseUrl;
    if (!baseUrl) {
      this.send({ type: 'API_STATUS', reachable: false });
      return;
    }

    try {
      const start = Date.now();
      await request(baseUrl, {
        method: 'GET',
        headersTimeout: 3000,
        bodyTimeout: 3000,
      });
      this.send({ type: 'API_STATUS', reachable: true, latency: Date.now() - start });
    } catch {
      this.send({ type: 'API_STATUS', reachable: false });
    }
  }

  /* ---- Helpers -------------------------------------------------- */

  private send(msg: ExtensionToWebviewMessage): void {
    this.onMessage?.(msg);
  }

  private defaultConfig(): QAAPIConfig {
    return {
      environments: {
        local: { baseUrl: 'http://localhost:3000' },
      },
      activeEnvironment: 'local',
      openApiPath: 'http://localhost:3000/api-docs/json',
      sourcePaths: ['src'],
    };
  }
}
