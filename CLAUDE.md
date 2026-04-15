# qaapi, Claude Guide

VSCode extension for API integration testing: imports endpoints from OpenAPI, lets the user edit bodies/headers/params inline, runs them with auth injected, and uses the Claude CLI on-demand to fill payloads or expand coverage.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full spec. Single source of truth.

## Process model

Extension host (Node.js) plus webview (React). No backend, no sidecar. Webview is stateless UI; host owns all state. They communicate via `postMessage`.

- Extension host: [src/](src/), TypeScript, compiled with `tsc` to [out/](out/)
- Webview: [webview/](webview/), React 19 + Tailwind + Vite, built separately

## Layout

- [src/extension.ts](src/extension.ts), `activate()`, commands, activity bar launcher
- [src/types.ts](src/types.ts), shared types + message protocol (webview mirror must stay in sync)
- [src/Logger.ts](src/Logger.ts), VSCode Output channel "qaapi"
- [src/extension/QAAPIController.ts](src/extension/QAAPIController.ts), all message handlers + orchestration
- [src/extension/PanelManager.ts](src/extension/PanelManager.ts), webview panel lifecycle
- [src/generator/OpenAPIGenerator.ts](src/generator/OpenAPIGenerator.ts), deterministic spec to TestSuite
- [src/ai/AIGenerator.ts](src/ai/AIGenerator.ts), spawns `claude` CLI for suggestPayload / expandCases
- [src/parser/SourceParser.ts](src/parser/SourceParser.ts), regex extraction of DTO classes (used only by AI grounding)
- [src/runner/TestCaseRunner.ts](src/runner/TestCaseRunner.ts), sequential journey execution, JSONPath chaining
- [src/runner/AuthManager.ts](src/runner/AuthManager.ts), 5 auth strategies, expiry-aware caching
- [src/store/FileStore.ts](src/store/FileStore.ts), `.qaapi/` read/write + legacy migration
- [src/crypto/bundle.ts](src/crypto/bundle.ts), AES-256-GCM encrypted export/import
- [webview/src/App.tsx](webview/src/App.tsx), webview state + message bridge + optimistic updates
- [webview/src/types.ts](webview/src/types.ts), mirror of `src/types.ts`; keep them in sync
- [webview/src/components/](webview/src/components/), TopBar, Sidebar, MainPanel, Settings, TokenChainEditor

## Commands

- `npm run compile`, tsc build of extension host
- `npm run watch`, tsc watch mode
- `npm run build:webview`, build the webview bundle
- `npm run build`, both

F5 in VSCode launches the Extension Development Host for manual testing. After `package.json` or `media/` changes, fully close the dev host and F5 again. `Ctrl+R` reload doesn't flush icon or contributes cache.

## Core conventions

- **Merge, never replace.** "Sync from OpenAPI" adds only missing endpoints (keyed by `method:path`); it never touches existing journeys. Users delete journeys to re-import them fresh.
- **AI is opt-in, per-endpoint.** No auto-generation on Sync. Two buttons: `✨ Suggest` (one payload) and `✨ Expand cases` (one journey per declared response code, skipping duplicates). Both invoke the `claude` CLI subprocess.
- **Claude CLI only.** No Anthropic SDK, no API key, no Copilot fallback. If `claude` isn't on PATH, a blocking modal surfaces an install link. We tried `vscode.lm` and reverted.
- **Single user, no role matrix.** `expectedStatus` is a number, not a role map. The `Journey.roles` field is gone. Auth bootstraps one token for the whole run.
- **Types first.** [src/types.ts](src/types.ts) defines the message protocol and data model. Webview types mirror it. Adding a message means updating both files.
- **Regex over AST.** [SourceParser](src/parser/SourceParser.ts) uses regex for DTO class definitions only. That's the only extraction AI grounding needs now; role guards, validators, and error conditions were pulled when full-suite gen was dropped.
- **Template vars** in journeys: `{{ctx.varName}}` and `{{env.baseUrl}}` resolved at execution time. For token chains: `{{stepName}}` refers to prior steps' extracted values.
- **Localhost TLS bypass** is automatic for `localhost` / `127.0.0.1` / `::1` in test runs, spec fetch, and health check. Remote hosts verify normally; per-chain `insecureTls` opt-in handles remote dev certs.
- **Failure semantics:** failed step halts the journey; remaining steps marked `skipped`.
- **Secrets:** auth tokens in-memory only. Credentials live in `.qaapi/auth.config.json` as plaintext (known gap, moving to `vscode.secrets` is separate future work).
- **Bundle sharing:** AES-256-GCM with PBKDF2-SHA256 (210k iter, 16-byte salt, 12-byte IV). Password prompted via VSCode input box; bundle file is plain JSON with base64 fields.

## Target-repo layout

Tests live in `.qaapi/` at the developer's repo root:

- `qaapi.config.json`, environments, `openApiPath`, `sourcePaths` (optional)
- `auth.config.json`, auth strategy + config
- `tests/{domain}.journey.json`, one `TestSuite` per domain (first path segment)

## Non-goals

No browser automation, no backend service, no CI/CD integration, no full-suite AI generation, no remote LM providers, no parallel execution, no multi-repo support. Don't add these without discussion.
