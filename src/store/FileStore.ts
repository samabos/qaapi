import * as vscode from 'vscode';
import {
  QAAPIConfig,
  AuthConfig,
  TestSuite,
} from '../types';

const QAAPI_DIR = '.qaapi';
const CONFIG_FILE = 'qaapi.config.json';
const AUTH_FILE = 'auth.config.json';
const SPEC_CACHE_FILE = 'openapi.cache.json';
const TESTS_DIR = 'tests';

export class FileStore {
  private root: vscode.Uri;

  constructor(workspaceRoot: vscode.Uri) {
    this.root = vscode.Uri.joinPath(workspaceRoot, QAAPI_DIR);
  }

  /* ---- Config -------------------------------------------------- */

  async readConfig(): Promise<QAAPIConfig | null> {
    return this.readJson<QAAPIConfig>(CONFIG_FILE);
  }

  async writeConfig(config: QAAPIConfig): Promise<void> {
    await this.writeJson(CONFIG_FILE, config);
  }

  /* ---- Auth ----------------------------------------------------- */

  async readAuth(): Promise<AuthConfig | null> {
    return this.readJson<AuthConfig>(AUTH_FILE);
  }

  async writeAuth(auth: AuthConfig): Promise<void> {
    await this.writeJson(AUTH_FILE, auth);
  }

  /* ---- OpenAPI spec cache --------------------------------------- */

  /** Dereferenced spec saved at Sync time so AI features don't need the
   *  dev API to be running. Committing this is up to the user. */
  async readSpec(): Promise<Record<string, unknown> | null> {
    return this.readJson<Record<string, unknown>>(SPEC_CACHE_FILE);
  }

  async writeSpec(spec: Record<string, unknown>): Promise<void> {
    await this.writeJson(SPEC_CACHE_FILE, spec);
  }

  /* ---- Test Suites --------------------------------------------- */

  async readAllSuites(): Promise<TestSuite[]> {
    const testsUri = vscode.Uri.joinPath(this.root, TESTS_DIR);
    try {
      const entries = await vscode.workspace.fs.readDirectory(testsUri);
      const suites: TestSuite[] = [];
      for (const [name] of entries) {
        if (name.endsWith('.journey.json')) {
          const suite = await this.readJson<TestSuite>(`${TESTS_DIR}/${name}`);
          if (suite) suites.push(this.migrateSuite(suite));
        }
      }
      return suites;
    } catch {
      return [];
    }
  }

  /**
   * Migrate old suite format:
   * - Remove journey.roles
   * - Convert step.expectedStatus from Record<string,number> to number
   */
  private migrateSuite(suite: TestSuite): TestSuite {
    for (const journey of suite.journeys) {
      // Remove legacy roles field
      delete (journey as unknown as Record<string, unknown>)['roles'];

      for (const step of journey.steps) {
        // Convert expectedStatus from object to number
        if (typeof step.expectedStatus === 'object' && step.expectedStatus !== null) {
          const obj = step.expectedStatus as unknown as Record<string, number>;
          const values = Object.values(obj);
          step.expectedStatus = values[0] ?? 200;
        }
      }
    }
    return suite;
  }

  async writeSuite(suite: TestSuite): Promise<void> {
    await this.writeJson(`${TESTS_DIR}/${suite.id}.journey.json`, suite);
  }

  async deleteSuite(suiteId: string): Promise<void> {
    const uri = vscode.Uri.joinPath(this.root, TESTS_DIR, `${suiteId}.journey.json`);
    try {
      await vscode.workspace.fs.delete(uri);
    } catch {
      // ignore if not found
    }
  }

  /* ---- Scaffold ------------------------------------------------ */

  async ensureStructure(): Promise<void> {
    const testsUri = vscode.Uri.joinPath(this.root, TESTS_DIR);
    try {
      await vscode.workspace.fs.createDirectory(this.root);
      await vscode.workspace.fs.createDirectory(testsUri);
    } catch {
      // dirs may already exist
    }
  }

  /* ---- Helpers -------------------------------------------------- */

  private async readJson<T>(relativePath: string): Promise<T | null> {
    const uri = vscode.Uri.joinPath(this.root, relativePath);
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      return JSON.parse(Buffer.from(raw).toString('utf-8')) as T;
    } catch {
      return null;
    }
  }

  private async writeJson(relativePath: string, data: unknown): Promise<void> {
    const uri = vscode.Uri.joinPath(this.root, relativePath);
    const content = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
    await vscode.workspace.fs.writeFile(uri, content);
  }
}
