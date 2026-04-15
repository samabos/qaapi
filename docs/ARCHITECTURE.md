# qaapi, VSCode Extension Architecture

> API integration testing inside VSCode. Import endpoints directly from OpenAPI, edit bodies/headers/params inline, run them with auth injected, and use AI on-demand to fill in realistic payloads or expand coverage across response codes.

---

## Design principles

- **Deterministic by default.** Tests come from the OpenAPI spec. AI is opt-in, per-endpoint, and additive.
- **Non-destructive.** Importing again merges; it never overwrites user edits. User-edited payloads, names, headers, assertions, all preserved.
- **Local-only.** Extension host plus webview. No backend, no sidecar, no API key we manage.
- **Use what's there.** Auth tokens go in memory. Bundles ship encrypted with a password. Claude CLI is invoked by subprocess, no separate key to manage.

---

## Process model

Everything runs inside the VSCode Extension Host (Node.js). The webview panel (React) is a stateless UI that talks to the host via `postMessage`.

```
VSCode Extension Host (Node.js)
├── QAAPIController         orchestrates every operation
├── PanelManager            webview panel lifecycle + activity bar integration
├── OpenAPIGenerator        deterministic TestSuite from dereferenced spec
├── AIGenerator             calls `claude` CLI: suggestPayload, expandCases
├── SourceParser            regex extraction of DTO class definitions
├── TestCaseRunner          executes journeys step-by-step, JSONPath chaining
├── AuthManager             token bootstrap + expiry-aware caching
├── FileStore               .qaapi/ folder read/write
├── crypto/bundle.ts        AES-256-GCM encrypted export/import
└── Logger                  VSCode Output channel "qaapi"
        ↕ postMessage
Webview (React + Tailwind + Vite), stateless, display + edit
```

---

## Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Extension host | TypeScript + VSCode Extension API | Target `vscode` engine `^1.93.0` |
| HTTP client | **undici** | All HTTP calls: tests, spec fetch, auth |
| OpenAPI parsing | `@apidevtools/swagger-parser` | Dereference inline, fetch via undici for localhost TLS bypass |
| AI generation | **Claude Code CLI** subprocess (`claude -p`) | No API key. CLI must be on PATH. |
| JSONPath | `jsonpath-plus` | Assertions, extractions, token-chain extract |
| Webview UI | React 19 + Tailwind CSS + Vite | Built separately, loaded from `webview/dist/` |
| Crypto | Node `crypto` (PBKDF2 + AES-256-GCM) | Encrypted bundles |
| Persistence | `.qaapi/` folder via `vscode.workspace.fs` | Per-repo, git-committable |

---

## File structure

```
qaapi/                               ← extension root
├── package.json                     ← activity bar view container + commands
├── tsconfig.json
├── media/qaapi.svg                  ← activity bar icon (monochrome, currentColor)
├── src/
│   ├── extension.ts                 ← activate(), commands, launcher tree view
│   ├── types.ts                     ← shared types + message protocol
│   ├── Logger.ts                    ← VSCode Output channel wrapper
│   ├── extension/
│   │   ├── QAAPIController.ts       ← all message handlers, orchestration
│   │   └── PanelManager.ts          ← webview panel create/reveal
│   ├── ai/
│   │   └── AIGenerator.ts           ← spawns `claude` CLI; suggestPayload + expandCases
│   ├── generator/
│   │   └── OpenAPIGenerator.ts      ← spec to TestSuite (one journey per operation)
│   ├── parser/
│   │   └── SourceParser.ts          ← DTO class extraction for AI grounding
│   ├── runner/
│   │   ├── TestCaseRunner.ts        ← executes journeys (was DAGRunner)
│   │   └── AuthManager.ts           ← bootstrap + token caching
│   ├── store/
│   │   └── FileStore.ts             ← .qaapi/ read/write, legacy format migration
│   └── crypto/
│       └── bundle.ts                ← AES-256-GCM encrypted bundle export/import
└── webview/
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    └── src/
        ├── main.tsx
        ├── App.tsx                  ← state + message bridge + optimistic updates
        ├── types.ts                 ← mirror of src/types.ts, keep in sync
        ├── index.css                ← design tokens
        └── components/
            ├── TopBar.tsx           ← env switcher, API status, auth status, Sync/Run All
            ├── Sidebar.tsx          ← suites → endpoint groups → journeys + actions
            ├── MainPanel.tsx        ← journey detail, tabbed Body/Headers/Query/Sent
            ├── Settings.tsx         ← env, auth, share (import/export bundle)
            └── TokenChainEditor.tsx ← multi-step custom auth flow editor

target-repo/                         ← developer's repo under test
└── .qaapi/
    ├── qaapi.config.json
    ├── auth.config.json
    └── tests/
        ├── users.journey.json       ← one TestSuite per domain (first path segment)
        └── orders.journey.json
```

---

## Data model

### QAAPIConfig, `qaapi.config.json`

```json
{
  "environments": {
    "local":   { "baseUrl": "http://localhost:3000" },
    "staging": { "baseUrl": "https://staging.api.example.com" }
  },
  "activeEnvironment": "local",
  "openApiPath": "http://localhost:3000/api-docs/json",
  "sourcePaths": ["src/modules"]
}
```

`sourcePaths` is optional. It's only read by the AI features to pull DTO snippets as grounding for Claude.

### AuthConfig, `auth.config.json`

Five strategies. See "Authentication" section for details.

```typescript
interface AuthConfig {
  strategy: 'credentials' | 'auto-register' | 'api-key' | 'oauth2-client-credentials' | 'token-chain' | 'none';
  credentials?: Record<string, RoleCredentials>;  // legacy multi-key, first entry used
  loginEndpoint?: string;
  registerEndpoint?: string;
  apiKey?: string;
  oauth2?: OAuth2ClientCredentials;
  tokenChain?: TokenChain;
}
```

### TestSuite, `{domain}.journey.json`

```typescript
interface TestSuite {
  id: string;           // domain (first path segment)
  name: string;
  journeys: Journey[];
  generatedAt: string;
  sourceHash: string;   // md5 of spec-at-import, metadata only
}

interface Journey {
  id: string;
  name: string;
  description: string;
  tags?: string[];                  // e.g. ['happy-path'], ['validation']
  steps: Step[];
  extractions: Extraction[];        // declarative chain data between steps
}

interface Step {
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;                      // supports {{ctx.x}} / {{env.baseUrl}}
  payload?: Record<string, unknown>;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  expectedStatus: number;            // single value, no role matrix
  assertions: Assertion[];
}

interface Extraction { from: string; to: string; }
interface Assertion {
  path: string;                      // JSONPath against { body: responseBody }
  exists?: boolean; equals?: unknown; contains?: unknown; greaterThan?: number;
}
```

---

## Feature specs

### 1. Deterministic OpenAPI import

Button: **"Sync from OpenAPI"** in the TopBar.

- Fetch the spec over undici (bypass TLS for `localhost` / `127.0.0.1` / `::1`)
- Hand the parsed object to `SwaggerParser.dereference()` to resolve `$ref`
- Group paths by first segment (`/api/users/...` becomes domain `api`)
- `OpenAPIGenerator` creates one `Journey` per operation, one `Step` per journey, `method` + `path` from the spec, `expectedStatus` = first declared 2xx (fallback 200), `payload` synthesized from `requestBody.schema` (example, default, type-based stub), required `queryParams` / `headers` from `parameters`, `assertions: []`

**Merge, never replace.** For each domain:
- If no suite exists, create it
- If a suite exists, keep every existing journey verbatim; append only endpoints the suite doesn't already have (keyed by `method:path`)

So re-running Sync is idempotent. To re-import an endpoint that was edited or removed, delete the journey first and Sync again.

### 2. Test execution, `TestCaseRunner`

Sequential per-journey pipeline. For each step:

1. Mark `running`, emit live update
2. Resolve `{{ctx.x}}` / `{{env.baseUrl}}` templates in path, headers, query, payload
3. Inject `Authorization: Bearer <token>` via `authManager.ensureToken()`
4. Apply TLS bypass if URL is localhost
5. HTTP call via undici
6. Evaluate `expectedStatus` match + all assertions
7. Apply any extractions that reference this step's index, populate `ctx`
8. Emit `passed` or `failed` update; on failure, remaining steps marked `skipped`

Assertions evaluate against an envelope `{ body: responseBody }`. Paths must start with `$.body.`. Operators: `exists`, `equals` (deep), `contains`, `greaterThan`.

Extractions use `from: "steps.<N>.response.<path>"` and `to: "ctx.<varName>"`.

### 3. AI features (on-demand, per-endpoint)

Both invoked via `claude -p` subprocess. No API key. Uses whatever account the Claude CLI is signed in with.

**Suggest payload.** `✨ Suggest` button in the Body tab of a step. User types a case description ("valid happy path", "missing required email"). Prompt includes: endpoint method + path, OpenAPI operation JSON, best-effort DTO source (ranked by class-name match against the operation), case description, current payload. Returns a single JSON object, lands in the Body editor, auto-saves via `UPDATE_TEST_CASE`.

**Expand cases.** `✨` icon on endpoint group headers in the sidebar. Asks Claude for one test case per response code declared in the OpenAPI operation that doesn't already have a journey in the suite. Prompt lists existing case names to avoid duplicates. Returns a JSON array. Each element becomes a new `Journey` with a single `Step`, appended, never replaces.

Failure modes:
- `claude` not on PATH, `ClaudeCliMissingError`, blocking modal with "Open install guide" link
- Empty stdout, "Claude returned no output" (usually swallowed auth prompt)
- Invalid JSON, parse error surfaces in the webview error banner

### 4. Authentication

Five strategies in `AuthManager`. All tokens live in memory only, never on disk.

| Strategy | How |
|---|---|
| `credentials` | POST `{email, password}` to `loginEndpoint`, extract token from response |
| `auto-register` | Ephemeral `qaapi_*@test.local` user via `registerEndpoint`, then login |
| `api-key` | Static key from config, injected as Bearer |
| `oauth2-client-credentials` | Standard OAuth2, with TTL cache + 30s skew refresh |
| `token-chain` | N sequential requests with `{{stepName}}` templates between them; last step's extract is the bearer token. JWT `exp` claim auto-honored for caching. Per-chain `insecureTls` flag for dev certs with untrusted chains. |
| `none` | No auth header |

`ensureToken()` is called before every test request. For OAuth2 and token-chain, it re-fetches when within 30s of expiry. Other strategies return the cached token as-is; `refresh()` re-logs in explicitly.

Token extraction falls back through common field names: `token`, `access_token`, `accessToken`, `jwt`, `idToken`, with `data.*` nesting.

### 5. Localhost TLS bypass

When the target hostname is `localhost` / `127.0.0.1` / `::1`, HTTP calls use a shared `undici.Agent` with `rejectUnauthorized: false`. Applied consistently in `TestCaseRunner`, `QAAPIController.fetchAndDereference`, and `QAAPIController.checkApiHealth`. **Never applied to remote hosts.** For remote dev certs, the user opts in via the token-chain's `insecureTls` flag.

### 6. Journey management

Sidebar hover actions on each journey:
- **▶ Run** runs just this journey
- **✎ Rename** inline edit; Enter to save, Esc to cancel
- **⧉ Duplicate** deep copy with new id, `(copy)` suffix
- **× Delete** two-click confirm pattern

Sidebar hover actions on suite rows:
- **× Delete** two-click confirm, removes the whole `.journey.json` file

Aggregate status counts on suite headers and endpoint groups: `N✓ N✗ N` (passed, failed, not-run). Zeros hidden. Recomputed from `runResults`. Running a single journey only replaces its own result, preserving others' status dots.

### 7. Editable step details

Request section has tabs: **Body** (JSON textarea, auto-saves on blur if valid JSON), **Headers** (key-value), **Query** (key-value), **Sent** (appears after a run, read-only view of what actually went out, including auto-injected Authorization). Body hidden for GET/DELETE.

Expected status code is an inline editable number input. Override Claude's guess when needed.

Response section: **Body**, **Headers** tabs.

### 8. Sharing via encrypted bundle

**Export.** Settings, Share, Export bundle. Prompts twice for a password (min 8 chars), save dialog. Bundle format: JSON with AES-256-GCM ciphertext over `{config, auth, tests}`, PBKDF2-SHA256 (210k iterations, OWASP 2023), random 16-byte salt + 12-byte IV. Tampering detected via GCM auth tag.

**Import.** Pick file, enter password. Confirmation modal before applying. Config and auth are replaced; test suites are merged by id (same `method:path` rule as Sync). Never overwrites journeys silently.

Reminder in the password prompt: send the file and password via different channels.

### 9. Activity bar integration

A dedicated activity bar icon (monochrome SVG in `media/qaapi.svg`). Clicking it opens a sidebar view that auto-launches the qaapi panel **on first visibility this session**. Closing the panel keeps it closed until the user explicitly reopens it via the welcome link in the sidebar or the command palette.

### 10. Diagnostics

`View`, `Output`, select `qaapi` shows timestamped `INFO` / `WARN` / `ERROR` lines from `Logger`. Token-chain steps log full request URL, response status, response body (truncated to 2000 chars) on failure. TLS errors get an "enable Allow insecure TLS" hint. Suggest and Expand failures log the full error.

---

## Webview message protocol

### Extension → Webview

| Type | Payload | When |
|---|---|---|
| `ENVIRONMENTS_LOADED` | `{ environments, active }` | On panel open, env switch, config update |
| `CONFIG_LOADED` | `QAAPIConfig` | Same |
| `TEST_SUITES_LOADED` | `TestSuite[]` | On open or after any suite mutation |
| `GENERATION_PROGRESS` | `{ message, progress }` | During OpenAPI Sync |
| `TEST_STEP_UPDATE` | `StepResult` | Live during test run |
| `RUN_COMPLETE` | `RunResult` | After journey finishes |
| `AUTH_CONFIG_LOADED` | `AuthConfig` | On open, after auth saved |
| `AUTH_STATUS` | `{ strategy, ready }` | After bootstrap or strategy change |
| `API_STATUS` | `{ reachable, latency? }` | After health check |
| `PAYLOAD_SUGGESTION` | `{ stepId, payload?, error? }` | After Suggest completes |
| `CASES_EXPANDED` | `{ suiteId, journeyId, added, error? }` | After Expand completes |
| `ERROR` | `{ message }` | On any error |

### Webview → Extension

| Type | Payload | Action |
|---|---|---|
| `READY` | | Webview loaded; send initial state |
| `GENERATE_TESTS` | `{ force? }` | Merge OpenAPI spec into suites |
| `RUN_TESTS` | `{ suiteId?, journeyId?, stepId? }` | Execute |
| `UPDATE_TEST_CASE` | `{ suiteId, journey }` | Persist edit |
| `DELETE_TEST_CASE` | `{ suiteId, journeyId }` | Remove journey from suite |
| `DELETE_SUITE` | `{ suiteId }` | Remove whole .journey.json |
| `SET_ENVIRONMENT` | `{ name }` | Switch active env |
| `SET_AUTH` | `AuthConfig` | Update auth |
| `UPDATE_CONFIG` | `QAAPIConfig` | Update config |
| `CANCEL_GENERATION` | | Kill active Claude CLI subprocess |
| `OPEN_SETTINGS` | | Open VSCode settings |
| `EXPORT_BUNDLE` | | Password prompt + save dialog |
| `IMPORT_BUNDLE` | | Open dialog + password + confirm + merge |
| `SUGGEST_PAYLOAD` | `{ suiteId, journeyId, stepId, description }` | Claude body suggestion |
| `EXPAND_CASES` | `{ suiteId, journeyId }` | Claude adds journeys for this endpoint |

---

## UI design

Dark theme tuned to VSCode's chrome. All colors map to VSCode theme variables with dark fallbacks (see `webview/src/index.css`).

```
┌────────────────────────────────────────────────────────────┐
│ TopBar: [qaapi] env ▾ • API:● • Auth:● …  [Sync] [Run All] │
├────────────────────┬───────────────────────────────────────┤
│ Sidebar            │ MainPanel                             │
│ ▼ api   2✓ 1✗ 8    │ Journey name  [▶ Run]                 │
│   ▼ POST /api/x ✨  │ ┌─ Step 1  POST /api/x     ●passed ─┐ │
│     ● 200 happy    │ │ expected: [200]  actual: 200 ✓     │ │
│     ● 400 empty    │ │ Request: Body ▾ Headers Query Sent │ │
│     ● 404 missing  │ │   ┌─ textarea with { "field": … } ┐│ │
│   ▶ GET  /api/x    │ │   └────────────────────────────── ┘│ │
│ ▼ cases 0✓ 0✗ 3    │ │ Response: Body ▾ Headers            │ │
│                    │ └────────────────────────────────────┘ │
└────────────────────┴───────────────────────────────────────┘
```

**Fonts:** VSCode editor font for code/paths, VSCode UI font for labels.

---
