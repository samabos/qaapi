# QAAPI — VSCode Extension Architecture

> AI-powered API integration testing. Combines OpenAPI specs with source code intelligence to generate tests that find real bugs, not just happy paths.

---

## Core Differentiator

OpenAPI tells QAAPI **what** endpoints exist. Source code tells QAAPI **how** they behave — validation rules, role guards, error conditions, entity relationships. Combined with Claude AI, this produces test cases that reflect real application logic.

---

## Process Model

No backend. No sidecar. Everything runs inside the VSCode Extension Host (Node.js). The Webview panel (React) is a stateless UI layer communicating via `postMessage`.

```
VSCode Extension Host (Node.js)
├── SourceParser        regex patterns on source code → business logic context
├── OpenAPIParser       swagger-parser → endpoints, schemas, security schemes
├── AIGenerator         Claude API → TestSuite JSON (OpenAPI + source combined)
├── AuthManager         bootstrap tokens for each role before test runs
├── DAGRunner           execute journeys step-by-step, JSONPath chaining
├── FileStore           .qaapi/ folder read/write per repo
└── QAAPIController     orchestrates all of the above
        ↕ postMessage
Webview (React + Tailwind)   — stateless, display only
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Extension Host | TypeScript + VSCode Extension API | Core runtime, file I/O |
| HTTP Client | undici | Fast lightweight Node.js HTTP |
| OpenAPI Parsing | swagger-parser | Dereference + validate OpenAPI 2/3 |
| Source Parsing | Regex pattern matching (not Tree-sitter for MVP) | Simpler, sufficient for extracting guards/validators |
| AI Generation | Anthropic SDK — `claude-sonnet-4-20250514` | Test case + payload generation |
| JSONPath | jsonpath-plus | Step output extraction + assertion evaluation |
| Webview UI | React + Tailwind CSS | Panel rendered inside VSCode |
| Persistence | `.qaapi/` folder via `vscode.workspace.fs` | Per-repo, git-committable |

---

## File Structure

```
qaapi/                          ← extension root
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts            ← activate(), registers commands
│   ├── types.ts                ← all shared types + message protocol
│   ├── extension/
│   │   ├── QAAPIController.ts  ← orchestrates everything
│   │   └── PanelManager.ts     ← creates/manages webview panel
│   ├── ai/
│   │   └── AIGenerator.ts      ← calls Claude API
│   ├── parser/
│   │   └── SourceParser.ts     ← extracts business logic from source
│   ├── runner/
│   │   ├── DAGRunner.ts        ← executes journeys
│   │   └── AuthManager.ts      ← auth bootstrapping
│   └── store/
│       └── FileStore.ts        ← .qaapi/ read/write
└── webview/
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    └── src/
        ├── main.tsx            ← entry, acquireVsCodeApi()
        ├── App.tsx             ← state management + message bridge
        ├── types.ts            ← mirror of src/types.ts
        ├── index.css           ← design tokens, dark theme
        └── components/
            ├── TopBar.tsx      ← env switcher, API status, generate/run buttons
            ├── Sidebar.tsx     ← suite/journey navigation tree
            └── MainPanel.tsx   ← journey detail, live step results, assertions

project-repo/                   ← developer's repo (target being tested)
└── .qaapi/
    ├── qaapi.config.json       ← environments, openApiPath, sourcePaths
    ├── auth.config.json        ← auth strategy + credentials per role
    └── tests/
        ├── users.journey.json
        └── orders.journey.json
```

---

## Data Model

### QAAPIConfig — `qaapi.config.json`

```json
{
  "environments": {
    "local":   { "baseUrl": "http://localhost:3000" },
    "staging": { "baseUrl": "https://staging.api.example.com" }
  },
  "activeEnvironment": "local",
  "openApiPath": "http://localhost:3000/api-docs/json",
  "sourcePaths": ["src/modules", "src/controllers"]
}
```

Auto-detect OpenAPI spec in order:
1. Fetch from running API (`baseUrl/api-docs/json`, `baseUrl/swagger.json`, `baseUrl/openapi.yaml`)
2. Fall back to file in repo root (`swagger.json`, `openapi.yaml`, `docs/api.yaml`)

### AuthConfig — `auth.config.json`

```json
{
  "strategy": "credentials",
  "credentials": {
    "admin":  { "email": "admin@example.com",  "password": "..." },
    "member": { "email": "member@example.com", "password": "..." }
  },
  "loginEndpoint": "/auth/login",
  "registerEndpoint": "/auth/register"
}
```

### TestSuite — `{domain}.journey.json`

```typescript
interface TestSuite {
  id: string;           // domain name e.g. "users"
  name: string;
  journeys: Journey[];
  generatedAt: string;
  sourceHash: string;   // md5 of source files — detect when to regenerate
}

interface Journey {
  id: string;
  name: string;
  description: string;
  roles: string[];
  steps: Step[];
  extractions: Extraction[];  // output → input mappings between steps
}

interface Step {
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;               // supports {{ctx.varName}} templates
  payload?: Record<string, unknown>;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  expectedStatus: Record<string, number>;  // { admin: 201, member: 403, guest: 401 }
  assertions: Assertion[];
}

interface Extraction {
  from: string;   // "steps.0.response.body.id"
  to: string;     // "ctx.userId"
}

interface Assertion {
  path: string;           // JSONPath e.g. "$.body.id"
  exists?: boolean;
  equals?: unknown;
  contains?: unknown;
  greaterThan?: number;
}
```

---

## Feature Specs

### 1. Test Case Generation

**Input to Claude (per domain):**
- Full OpenAPI spec for that domain's endpoints
- Source code excerpts: route handlers, guards, validators, DTOs, role enums
- Existing test cases (if any) — to avoid overwriting manual edits

**Source parsing — regex patterns (not AST for MVP):**
```
@Roles(), @RequireRoles()              → role guards
@IsEmail, @MinLength, @IsEnum, etc.    → validation rules  
throw new ForbiddenException(...)      → error conditions
throw new NotFoundException(...)       → error conditions
if (condition) throw/return            → business logic branches
class *Guard implements CanActivate    → auth guards
class *Dto / *Input / *Body            → request shapes
enum *Role* / const *Role*             → role constants
```
Cap extracted source context at **60k characters** before sending to Claude.

**Claude output — JSON matching TestSuite schema directly:**
- Journey definitions per logical user flow
- Realistic payloads (enums, formats, required fields respected)
- Edge case variants: missing required fields, wrong types, forbidden roles
- JSONPath extraction mappings between chained steps
- Expected status codes per role per step

**Generation is idempotent:**
- Hash source files (md5) and compare to `sourceHash` in existing suite
- Only regenerate suites where source has changed
- Preserve manual edits on unchanged suites

**AI Prompt strategy:**
- Feed Claude one domain at a time (all `/users` endpoints together)
- Include service layer code for that domain
- Request JSON output matching TestSuite schema — no intermediate format
- Model: `claude-sonnet-4-20250514`

---

### 2. Journey Chaining (DAG Runner)

Steps execute sequentially. Each step's response is available to extract values for subsequent steps via JSONPath.

```
Step 1: POST /auth/login
  → extracts: steps.0.response.body.token  → ctx.token
  → extracts: steps.0.response.body.user.id → ctx.userId

Step 2: POST /orders  (body uses {{ctx.userId}})
  → extracts: steps.1.response.body.orderId → ctx.orderId

Step 3: GET /orders/{{ctx.orderId}}
  → asserts: $.body.status equals "pending"
```

**Execution rules:**
- Mutable context object per journey run
- Template variables `{{ctx.varName}}` and `{{env.baseUrl}}` resolved at execution time
- Failed step → remaining steps marked `skipped`, journey halts
- Failed extraction → journey halts with clear error identifying which step/path failed

---

### 3. Role-Based Test Matrix

Every journey runs across all its defined roles. Each role has its own auth context and expected status codes per step.

| Role | Auth Context | Expected Status | Purpose |
|---|---|---|---|
| admin | Admin JWT | 201 Created | Verify admin can create |
| member | Member JWT | 403 Forbidden | Verify members blocked |
| guest | No token | 401 Unauthorized | Verify unauth rejected |

Roles auto-detected from source: `@Roles()` decorators, role middleware, `*Role*` enum files. Developer can also define roles manually in `qaapi.config.json`.

All roles run in sequence per journey (parallel post-MVP).

---

### 4. Auth Bootstrapping

Before any test run, establish tokens for all roles. Try strategies in priority order:

| Priority | Strategy | How |
|---|---|---|
| 1 | Provided credentials | `auth.config.json` credentials per role → POST to `loginEndpoint` |
| 2 | Auto-register | POST to `registerEndpoint`, create ephemeral user with `qaapi_` prefix |
| 3 | API key | Static key from `auth.config.json` injected as Bearer token |
| 4 | No auth | Guest role — run unauthenticated |

**Session rules:**
- Tokens stored **in memory only** — never written to disk
- Auto-refresh on 401 response (re-login with same credentials)
- Ephemeral users prefixed `qaapi_` for easy manual cleanup
- Token extraction tries common field names: `token`, `access_token`, `accessToken`, `jwt`, `idToken`, nested `data.token`

---

### 5. Environment Management

Named environments in `qaapi.config.json`. Active environment sets `baseUrl` for all requests.

**API Health Check — before every run:**
- Ping `baseUrl` with 3 second timeout
- If unreachable → show warning with environment name
- If `package.json` dev script detected → offer to auto-start the API
- Show live status indicator in UI (green dot = reachable, red = offline)

---

### 6. Anthropic API Key

Prompted on first use. Stored securely in `vscode.secrets` (VSCode encrypted credential store — never touches disk in plaintext).

```typescript
// Store
await context.secrets.store('qaapi.anthropicKey', apiKey);

// Retrieve
const key = await context.secrets.get('qaapi.anthropicKey');
```

Validate format on input: must start with `sk-ant-`.

---

## Webview Message Protocol

### Extension → Webview

| Type | Payload | When |
|---|---|---|
| `ENVIRONMENTS_LOADED` | `{ environments, active }` | On panel open or env change |
| `TEST_SUITES_LOADED` | `TestSuite[]` | On open or after generation |
| `GENERATION_PROGRESS` | `{ message, progress: 0-100 }` | During AI generation |
| `TEST_STEP_UPDATE` | `StepResult` | Live during test run |
| `RUN_COMPLETE` | `RunResult` | After journey finishes |
| `AUTH_STATUS` | `{ strategy, user?, ready }` | After auth bootstrap |
| `API_STATUS` | `{ reachable, latency? }` | On health check |
| `ERROR` | `{ message }` | On any error |

### Webview → Extension

| Type | Payload | Action |
|---|---|---|
| `READY` | — | Webview loaded, send initial state |
| `GENERATE_TESTS` | `{ force?: boolean }` | Trigger AI generation |
| `RUN_TESTS` | `{ suiteId?, journeyId?, role? }` | Execute tests |
| `UPDATE_TEST_CASE` | `{ suiteId, journey }` | Persist manual edit |
| `DELETE_TEST_CASE` | `{ suiteId, journeyId }` | Remove from file |
| `SET_ENVIRONMENT` | `{ name }` | Switch active env |
| `SET_AUTH` | `AuthConfig` | Update auth config |
| `OPEN_SETTINGS` | — | Open VSCode settings |

---

## UI Design

**Theme:** Dark, developer-focused. CSS variables for all colors.

```css
--bg: #0d1117          /* page background */
--surface: #161b22     /* cards, panels */
--surface2: #1c2333    /* inputs, code blocks */
--border: #30363d
--text: #e6edf3
--text-muted: #7d8590
--accent: #2f81f7      /* primary blue */
--green: #3fb950       /* passed */
--red: #f85149         /* failed */
--yellow: #d29922      /* warning */
```

**Layout:**
```
┌─────────────────────────────────────────────┐
│ TopBar: logo | env dropdown | API status dot | generate btn | run all btn │
├──────────────┬──────────────────────────────┤
│ Sidebar      │ Main Panel                   │
│              │                              │
│ ▶ users      │ Journey name + description   │
│   ● create   │ Role filter dropdown         │
│   ● fetch    │                              │
│ ▶ orders     │ Steps list (method + path)   │
│              │ Live status per step         │
│              │                              │
│              │ Latest run results           │
│              │ Response body (expandable)   │
│              │ Assertions pass/fail         │
│              │ Extracted values             │
│              │                              │
│              │ Chain mappings (from → to)   │
└──────────────┴──────────────────────────────┘
```

**Fonts:** IBM Plex Mono for code/paths, Inter for UI text.

---

## MVP Build Phases

| Phase | Scope | Deliverable |
|---|---|---|
| 1 | OpenAPI parsing → AI generation → single step execution → results UI | Working extension, generates and runs basic tests |
| 2 | Journey chaining (DAG runner) + JSONPath extraction + live streaming | Multi-step flows with live execution view |
| 3 | Auth bootstrapping (all strategies) + role matrix | Role-aware tests with auto-auth |
| 4 | Source code parsing + edge case enrichment | Business-logic-aware generation |

---

## Non-Goals (MVP)

- No browser automation — API testing only
- No remote backend — all logic local in extension host
- No CI/CD integration — post-MVP
- No test coverage reporting — post-MVP
- No parallel role execution — sequential for MVP
- No multi-repo management — one workspace at a time

---

*This is the single source of truth. All implementation decisions reference this document. Deviations require discussion and update before proceeding.*
