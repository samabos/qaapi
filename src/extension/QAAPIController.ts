import * as vscode from 'vscode';
import {
  QAAPIConfig,
  AuthConfig,
  TestSuite,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from '../types';
import { FileStore } from '../store/FileStore';
import { AIGenerator } from '../ai/AIGenerator';
import { SourceParser } from '../parser/SourceParser';
import { AuthManager } from '../runner/AuthManager';
import { DAGRunner } from '../runner/DAGRunner';
import { request } from 'undici';
import SwaggerParser from '@apidevtools/swagger-parser';

export class QAAPIController {
  private store: FileStore | undefined;
  private config: QAAPIConfig | undefined;
  private authConfig: AuthConfig | undefined;
  private sourceParser = new SourceParser();
  private authManager = new AuthManager();
  private dagRunner = new DAGRunner(this.authManager);
  private generator = new AIGenerator();
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

    const root = vscode.workspace.workspaceFolders![0].uri;

    const spec = await this.fetchSpecWithRetry(this.config.openApiPath);
    if (!spec) return;

    // Group endpoints by domain (first path segment)
    const paths = (spec.paths ?? {}) as Record<string, unknown>;
    const domains = new Map<string, Record<string, unknown>>();
    for (const [pathKey, pathItem] of Object.entries(paths)) {
      const domain = pathKey.split('/').filter(Boolean)[0] ?? 'default';
      if (!domains.has(domain)) domains.set(domain, {});
      domains.get(domain)![pathKey] = pathItem;
    }

    const rawSource = await this.sourceParser.getRawContext(root, this.config.sourcePaths);
    const sourceCtx = await this.sourceParser.parse(root, this.config.sourcePaths);

    let completed = 0;
    for (const [domain, domainPaths] of domains) {
      const existing = this.suites.find(s => s.id === domain) ?? null;

      // Skip regeneration if source hasn't changed (unless forced)
      if (!force && existing && existing.sourceHash === AIGenerator.sourceHash(rawSource)) {
        completed++;
        continue;
      }

      // Don't feed old suite back on force regeneration — old assertions contaminate output
      const suite = await this.generator.generate(
        domain,
        JSON.stringify(domainPaths, null, 2),
        sourceCtx,
        rawSource,
        force ? null : existing,
        (message, progress) => {
          const overallProgress = Math.round(((completed + progress / 100) / domains.size) * 100);
          this.send({ type: 'GENERATION_PROGRESS', message, progress: overallProgress });
        },
      );

      await this.store!.writeSuite(suite);
      completed++;
    }

    this.suites = await this.store.readAllSuites();
    this.send({ type: 'TEST_SUITES_LOADED', suites: this.suites });
    this.send({ type: 'GENERATION_PROGRESS', message: 'Done', progress: 100 });
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
    }

    const suitesToRun = suiteId
      ? this.suites.filter(s => s.id === suiteId)
      : this.suites;

    for (const suite of suitesToRun) {
      const journeysToRun = journeyId
        ? suite.journeys.filter(j => j.id === journeyId)
        : suite.journeys;

      for (const journey of journeysToRun) {
        const result = await this.dagRunner.run(
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
        return (await SwaggerParser.dereference(specPath)) as Record<string, unknown>;
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
