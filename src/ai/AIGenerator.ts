import * as cp from 'child_process';
import { log } from '../Logger';

/** One AI-generated test case, before it's promoted to a full Journey. */
export interface ExpandedCase {
  name: string;
  description: string;
  expectedStatus: number;
  payload?: Record<string, unknown>;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
}

/** Thrown when the `claude` CLI isn't on PATH. The controller catches this
 *  and shows a modal with an actionable install button. */
export class ClaudeCliMissingError extends Error {
  constructor() {
    super('Claude Code CLI is not installed or not on your PATH.');
    this.name = 'ClaudeCliMissingError';
  }
}

/** Patterns that indicate the shell couldn't find the `claude` binary. */
function looksLikeNotFound(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return (
    s.includes('not recognized') ||
    s.includes('command not found') ||
    s.includes('cannot find') ||
    s.includes('no such file or directory')
  );
}

export class AIGenerator {
  private activeProcess: cp.ChildProcess | null = null;

  cancel(): void {
    if (this.activeProcess) {
      this.activeProcess.kill();
      this.activeProcess = null;
    }
  }

  async suggestPayload(args: {
    method: string;
    path: string;
    caseDescription: string;
    openApiOperation: unknown;
    dtoSource: string | null;
    currentPayload: Record<string, unknown> | undefined;
  }): Promise<Record<string, unknown>> {
    const prompt = this.buildSuggestPrompt(args);
    const text = await this.callClaude(prompt);
    return this.parseJsonResponse(text);
  }

  /**
   * Generate extra test cases for an endpoint. Covers response codes declared
   * in the OpenAPI spec + failure modes from the source (validators, thrown
   * exceptions), skipping cases already covered by existing journey names.
   */
  async expandCases(args: {
    method: string;
    path: string;
    openApiOperation: unknown;
    dtoSource: string | null;
    existingCaseNames: string[];
  }): Promise<ExpandedCase[]> {
    const prompt = this.buildExpandCasesPrompt(args);
    const text = await this.callClaude(prompt);
    return this.parseCasesResponse(text);
  }

  /* ---- Claude CLI ------------------------------------------------ */

  private callClaude(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      log.info(`Spawning claude CLI (prompt: ${prompt.length} chars)`);

      const proc = cp.spawn('claude', ['-p', '--output-format', 'text'], {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.activeProcess = proc;

      let stdout = '';
      let stderr = '';

      const cleanup = () => {
        this.activeProcess = null;
      };

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        cleanup();
        log.warn(`claude CLI spawn error: ${err.message}`);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new ClaudeCliMissingError());
          return;
        }
        reject(new Error(`Failed to run Claude CLI: ${err.message}`));
      });

      proc.on('close', (code, signal) => {
        cleanup();
        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          reject(new Error('Generation cancelled.'));
          return;
        }
        if (code !== 0) {
          const errText = stderr.trim();
          if (looksLikeNotFound(errText)) {
            log.warn(`claude CLI not found (stderr): ${errText}`);
            reject(new ClaudeCliMissingError());
            return;
          }
          log.warn(`claude CLI exited ${code}: ${errText}`);
          reject(new Error(`Claude CLI exited with code ${code}: ${errText || 'unknown error'}`));
          return;
        }
        const duration = Math.round((Date.now() - startTime) / 1000);
        log.info(`claude CLI complete: ${stdout.length} chars in ${duration}s`);

        // Empty output usually means an auth prompt got swallowed by piped stdin.
        // Short responses like `{}` are legitimate answers for negative-test cases.
        if (stdout.trim().length === 0) {
          log.warn(`claude CLI returned empty stdout. stderr: ${stderr.trim() || '(none)'}`);
          reject(new Error(
            'Claude returned no output. ' +
            (stderr.trim() ? `stderr: ${stderr.trim()}` : 'Run `claude` once in a terminal to verify auth, then retry.'),
          ));
          return;
        }
        resolve(stdout);
      });

      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  }

  /* ---- Prompts --------------------------------------------------- */

  private buildSuggestPrompt(args: {
    method: string;
    path: string;
    caseDescription: string;
    openApiOperation: unknown;
    dtoSource: string | null;
    currentPayload: Record<string, unknown> | undefined;
  }): string {
    const parts: string[] = [];
    parts.push('You generate a single JSON request body for an API integration test.');
    parts.push('');
    parts.push(`Endpoint: ${args.method} ${args.path}`);
    parts.push(`Case being tested: ${args.caseDescription || '(no description — use a valid happy-path payload)'}`);
    parts.push('');
    parts.push('## OpenAPI operation');
    parts.push('```json');
    parts.push(JSON.stringify(args.openApiOperation, null, 2));
    parts.push('```');
    if (args.dtoSource) {
      parts.push('');
      parts.push('## Matching DTO / validator source');
      parts.push('```typescript');
      parts.push(args.dtoSource);
      parts.push('```');
      parts.push('Use the field names exactly as declared. Respect validation decorators.');
    }
    if (args.currentPayload && Object.keys(args.currentPayload).length > 0) {
      parts.push('');
      parts.push('## Current payload (refine rather than replace)');
      parts.push('```json');
      parts.push(JSON.stringify(args.currentPayload, null, 2));
      parts.push('```');
    }
    parts.push('');
    parts.push('## Rules');
    parts.push('- Return ONLY raw JSON. No markdown fences, no prose.');
    parts.push('- For happy-path cases, values must satisfy all validation rules.');
    parts.push('- For negative cases (missing field, invalid value, etc), craft the payload to trigger that specific failure.');
    parts.push('- Use realistic values (emails, names, ISO dates). Avoid literally "test" or "foo".');
    parts.push('- Preserve nested structures from the schema.');
    return parts.join('\n');
  }

  private buildExpandCasesPrompt(args: {
    method: string;
    path: string;
    openApiOperation: unknown;
    dtoSource: string | null;
    existingCaseNames: string[];
  }): string {
    const parts: string[] = [];
    parts.push(`Generate additional test cases for ${args.method} ${args.path}.`);
    parts.push('');
    parts.push('Read the OpenAPI operation (especially the "responses" object) and the DTO/validators below.');
    parts.push('For every response status the endpoint can return (200/201/204/400/404/409/500, etc.), emit ONE test case that triggers it.');
    parts.push('');
    parts.push('## OpenAPI operation');
    parts.push('```json');
    parts.push(JSON.stringify(args.openApiOperation, null, 2));
    parts.push('```');
    if (args.dtoSource) {
      parts.push('');
      parts.push('## Matching DTO / validators / thrown exceptions');
      parts.push('```typescript');
      parts.push(args.dtoSource);
      parts.push('```');
    }
    if (args.existingCaseNames.length > 0) {
      parts.push('');
      parts.push('## Existing test cases (DO NOT duplicate these)');
      for (const name of args.existingCaseNames) parts.push(`- ${name}`);
    }
    parts.push('');
    parts.push('## Rules');
    parts.push('- Craft `payload` / `headers` / `queryParams` so the request actually triggers the target status code.');
    parts.push('- For 400 cases, violate a specific validator and name the case after the violation (e.g. "400 - missing email", "400 - email format invalid").');
    parts.push('- For 404, reference a non-existent resource. For 409, simulate a conflict.');
    parts.push('- Use field names from the OpenAPI schema / DTO exactly — never invent names.');
    parts.push('- Skip status codes already covered by existing case names.');
    parts.push('- Skip 5xx unless the source clearly shows a code path that returns it (e.g. explicit `throw new InternalServerError(...)`).');
    parts.push('- Include a `payload` field only for methods that take a body (POST/PUT/PATCH). Omit otherwise.');
    parts.push('');
    parts.push('## Output format');
    parts.push('Return ONLY a raw JSON array — no fences, no prose. Each element has:');
    parts.push('```typescript');
    parts.push('{ name: string; description: string; expectedStatus: number; payload?: object; headers?: Record<string,string>; queryParams?: Record<string,string>; }');
    parts.push('```');
    parts.push('Empty array is fine if nothing new to add.');
    return parts.join('\n');
  }

  /* ---- Response parsing ----------------------------------------- */

  private parseCasesResponse(text: string): ExpandedCase[] {
    let json = text.trim();
    if (json.startsWith('```')) {
      json = json.replaceAll(/^```(?:json)?\n?/g, '').replaceAll(/\n?```$/g, '');
    }
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      throw new TypeError('Expected a JSON array of test cases.');
    }
    return parsed.filter((c): c is ExpandedCase =>
      c && typeof c === 'object'
        && typeof c.name === 'string'
        && typeof c.expectedStatus === 'number',
    );
  }

  private parseJsonResponse(text: string): Record<string, unknown> {
    let json = text.trim();
    if (json.startsWith('```')) {
      json = json.replaceAll(/^```(?:json)?\n?/g, '').replaceAll(/\n?```$/g, '');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const preview = json.length > 400 ? json.slice(0, 400) + '…(truncated)' : json;
      log.warn(`Claude response was not valid JSON: ${msg}`);
      log.warn(`  response preview: ${preview}`);
      throw new Error(`Claude returned non-JSON output (${msg}). See View → Output → qaapi for the raw response.`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Claude returned a non-object payload.');
    }
    return parsed as Record<string, unknown>;
  }
}
