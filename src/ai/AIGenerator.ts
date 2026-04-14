import { TestSuite, SourceContext } from '../types';
import * as crypto from 'crypto';
import * as cp from 'child_process';

export interface GenerationProgress {
  (message: string, progress: number): void;
}

export class AIGenerator {
  private activeProcess: cp.ChildProcess | null = null;

  /**
   * Generate a TestSuite for the given domain using OpenAPI spec + source context.
   * Shells out to `claude -p` (print mode) — uses the user's existing Claude Code
   * authentication. No API key or Copilot needed.
   */
  async generate(
    domain: string,
    openApiSnippet: string,
    sourceContext: SourceContext,
    rawSource: string,
    existingSuite: TestSuite | null,
    onProgress?: GenerationProgress,
  ): Promise<TestSuite> {
    onProgress?.(`Generating tests for ${domain}...`, 10);

    const prompt = this.buildPrompt(domain, openApiSnippet, sourceContext, rawSource, existingSuite);

    onProgress?.(`Sending to Claude...`, 20);

    const text = await this.callClaude(prompt, onProgress);

    onProgress?.(`Parsing response...`, 95);

    const suite = this.parseResponse(text, domain, rawSource);

    onProgress?.(`Done generating ${domain}`, 100);

    return suite;
  }

  /**
   * Kill the active Claude CLI process if one is running.
   */
  cancel(): void {
    if (this.activeProcess) {
      this.activeProcess.kill();
      this.activeProcess = null;
    }
  }

  /**
   * Compute source hash for change detection.
   */
  static sourceHash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /* ---- Claude CLI ------------------------------------------------ */

  private callClaude(prompt: string, onProgress?: GenerationProgress): Promise<string> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const proc = cp.spawn('claude', ['-p', '--output-format', 'text'], {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.activeProcess = proc;

      let stdout = '';
      let stderr = '';
      let receivedData = false;

      // Heartbeat: update progress every 2s so the UI knows we're alive
      const heartbeat = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        if (receivedData) {
          const chars = stdout.length;
          onProgress?.(`Receiving from Claude... ${chars} chars (${elapsed}s)`, 60);
        } else {
          onProgress?.(`Waiting for Claude... (${elapsed}s)`, 30);
        }
      }, 2000);

      const cleanup = () => {
        clearInterval(heartbeat);
        this.activeProcess = null;
      };

      proc.stdout.on('data', (chunk: Buffer) => {
        receivedData = true;
        stdout += chunk.toString();
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        onProgress?.(`Receiving from Claude... ${stdout.length} chars (${elapsed}s)`, 60 + Math.min(30, stdout.length / 200));
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        cleanup();
        reject(new Error(
          `Failed to run Claude CLI: ${err.message}. ` +
          'Make sure Claude Code is installed and "claude" is on your PATH.',
        ));
      });

      proc.on('close', (code, signal) => {
        cleanup();
        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          reject(new Error('Generation cancelled.'));
          return;
        }
        if (code !== 0) {
          reject(new Error(
            `Claude CLI exited with code ${code}: ${stderr.trim() || 'unknown error'}`,
          ));
          return;
        }
        resolve(stdout);
      });

      // Write prompt to stdin and close
      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  }

  /* ---- Prompt --------------------------------------------------- */

  private buildPrompt(
    domain: string,
    openApiSnippet: string,
    sourceContext: SourceContext,
    rawSource: string,
    existingSuite: TestSuite | null,
  ): string {
    const parts: string[] = [];

    parts.push(`You are an expert API test generator. Generate a complete TestSuite JSON for the "${domain}" domain.`);
    parts.push('');
    parts.push('The tests run as a single authenticated service user. Do NOT generate multi-role tests.');
    parts.push('Focus on: correct HTTP status codes, request payloads, and business-logic response assertions.');
    parts.push('');

    // ── Data sources ──
    parts.push('## OpenAPI Spec (endpoints for this domain):');
    parts.push('```json');
    parts.push(openApiSnippet);
    parts.push('```');

    if (rawSource) {
      parts.push('');
      parts.push('## Source Code:');
      parts.push('```typescript');
      parts.push(rawSource);
      parts.push('```');
    }

    if (sourceContext.dtoDefinitions.length > 0) {
      parts.push('');
      parts.push('## Detected DTO Definitions (request/response shapes):');
      parts.push(JSON.stringify(sourceContext.dtoDefinitions, null, 2));
      parts.push('Use these field names for payloads and assertions — do NOT invent field names.');
    }

    if (sourceContext.validationRules.length > 0) {
      parts.push('');
      parts.push('## Detected Validation Rules:');
      parts.push(JSON.stringify(sourceContext.validationRules, null, 2));
      parts.push('');
      parts.push('Use these to generate validation edge-case journeys:');
      parts.push('- For each @IsNotEmpty field, include a step that omits it → expect 400.');
      parts.push('- For @IsEmail fields, include a step with an invalid email → expect 400.');
      parts.push('- For @MinLength(n), include a step with a too-short value → expect 400.');
    }

    if (sourceContext.errorConditions.length > 0) {
      parts.push('');
      parts.push('## Detected Error Conditions (thrown exceptions):');
      parts.push(JSON.stringify(sourceContext.errorConditions, null, 2));
      parts.push('Map exception types to status codes: BadRequestException→400, NotFoundException→404, ConflictException→409.');
    }

    if (existingSuite) {
      parts.push('');
      parts.push('## Existing Test Suite (reference only — DO NOT copy assertion paths or status codes):');
      parts.push('Use this only to understand which journeys exist. Regenerate ALL assertions from scratch using the OpenAPI spec.');
      parts.push(JSON.stringify(existingSuite, null, 2));
    }

    // ── Critical rules ──
    parts.push('');
    parts.push('## CRITICAL RULES — Read carefully:');
    parts.push('');
    parts.push('### 1. Status codes: Derive from the OpenAPI spec, do NOT guess');
    parts.push('- Read the "responses" object for each endpoint in the spec.');
    parts.push('- POST that creates a resource → use the status code defined in the spec (often 201).');
    parts.push('- GET/PUT/PATCH → use the status code defined in the spec (often 200).');
    parts.push('- DELETE → use the status code defined in the spec (often 200 or 204).');
    parts.push('- Validation failures → 400.');
    parts.push('- Not found → 404.');
    parts.push('- NEVER assume 200 for everything. Use the exact code from the spec.');
    parts.push('');
    parts.push('### 2. Assertion paths: Use the ACTUAL response schema');
    parts.push('Assertions are evaluated against an envelope: `{ body: <responseBody> }`.');
    parts.push('So ALL assertion paths MUST start with `$.body.`');
    parts.push('');
    parts.push('Examples — if the API returns `{ "data": { "id": 1, "name": "x" }, "status": 200, "message": "OK" }`:');
    parts.push('  CORRECT: `$.body.data.id`   → resolves to 1');
    parts.push('  CORRECT: `$.body.data.name` → resolves to "x"');
    parts.push('  CORRECT: `$.body.message`   → resolves to "OK"');
    parts.push('  WRONG:   `$.id`             → resolves to nothing');
    parts.push('  WRONG:   `$.data.id`        → resolves to nothing');
    parts.push('');
    parts.push('Read the response schema from the OpenAPI spec to determine the exact structure.');
    parts.push('If the spec wraps responses in a `data` property, use `$.body.data.<field>`.');
    parts.push('If the spec returns flat objects, use `$.body.<field>`.');
    parts.push('');
    parts.push('### 3. Extraction paths');
    parts.push('Extractions use format: `from: "steps.<index>.response.body.<path>"`, `to: "ctx.<varName>"`.');
    parts.push('Reference extracted values in later steps as `{{ctx.<varName>}}`.');
    parts.push('Example — extract an ID from step 0, use in step 1 URL:');
    parts.push('  `{ "from": "steps.0.response.body.data.id", "to": "ctx.createdId" }`');
    parts.push('  Step 1 path: `/api/items/{{ctx.createdId}}`');
    parts.push('');
    parts.push('### 4. Field names: Use ONLY names from the OpenAPI spec and DTOs');
    parts.push('- Request payloads: use field names from the requestBody schema or DTO definitions above.');
    parts.push('- Assertions: use field names from the response schema.');
    parts.push('- NEVER invent field names. If you are unsure of a field name, omit the assertion.');
    parts.push('');
    parts.push('### 5. What to test');
    parts.push('For each endpoint generate journeys covering:');
    parts.push('- **Happy path**: valid payload → success status → assert key response fields exist/have correct types.');
    parts.push('- **Validation errors**: missing required fields, wrong types, invalid formats → 400.');
    parts.push('- **Not found**: reference a non-existent ID → 404.');
    parts.push('- **Chained flows**: create → read → update → delete, using extractions to pass IDs between steps.');
    parts.push('');
    parts.push('### 6. Tags');
    parts.push('Assign 1-3 tags to each journey from this list:');
    parts.push('- "happy-path" — standard success flow');
    parts.push('- "validation" — tests input validation / 400 errors');
    parts.push('- "not-found" — tests 404 scenarios');
    parts.push('- "crud-flow" — create/read/update/delete chain');
    parts.push('- "edge-case" — boundary conditions or unusual inputs');

    // ── Output format ──
    parts.push('');
    parts.push('## Output Format');
    parts.push('Return ONLY valid JSON matching this TypeScript interface:');
    parts.push('```typescript');
    parts.push('interface TestSuite {');
    parts.push('  id: string;           // domain name');
    parts.push('  name: string;');
    parts.push('  journeys: Journey[];');
    parts.push('  generatedAt: string;  // ISO 8601');
    parts.push('  sourceHash: string;   // will be replaced');
    parts.push('}');
    parts.push('interface Journey {');
    parts.push('  id: string;');
    parts.push('  name: string;');
    parts.push('  description: string;');
    parts.push('  tags: string[];              // 1-3 tags from the allowed list');
    parts.push('  steps: Step[];');
    parts.push('  extractions: Extraction[];');
    parts.push('}');
    parts.push('interface Step {');
    parts.push('  id: string;');
    parts.push('  name: string;');
    parts.push('  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";');
    parts.push('  path: string;');
    parts.push('  payload?: Record<string, unknown>;');
    parts.push('  headers?: Record<string, string>;');
    parts.push('  queryParams?: Record<string, string>;');
    parts.push('  expectedStatus: number;                  // HTTP status code from spec');
    parts.push('  assertions: Assertion[];                 // paths MUST start with $.body.');
    parts.push('}');
    parts.push('interface Extraction { from: string; to: string; }');
    parts.push('interface Assertion { path: string; exists?: boolean; equals?: unknown; contains?: unknown; greaterThan?: number; }');
    parts.push('```');
    parts.push('');
    parts.push('Return raw JSON only — no markdown fences, no explanation, no comments.');

    return parts.join('\n');
  }

  /* ---- Response parsing ----------------------------------------- */

  private parseResponse(text: string, domain: string, rawSource: string): TestSuite {
    // Strip markdown fences if present
    let json = text.trim();
    if (json.startsWith('```')) {
      json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(json) as TestSuite;

    // Ensure required fields
    parsed.id = parsed.id || domain;
    parsed.generatedAt = new Date().toISOString();
    parsed.sourceHash = AIGenerator.sourceHash(rawSource);

    return parsed;
  }
}
