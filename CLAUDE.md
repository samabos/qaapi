# QAAPI — Claude Guide

VSCode extension that generates and runs API integration tests by combining OpenAPI specs with source-code intelligence. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full spec — it is the single source of truth.

## Process model

No backend, no sidecar. Everything runs in the VSCode Extension Host (Node.js). The webview is a stateless React UI that talks to the host via `postMessage`.

- Extension host: [src/](src/) — TypeScript, compiled with `tsc` to [out/](out/)
- Webview: [webview/](webview/) — React + Tailwind + Vite, built separately

## Layout

- [src/extension.ts](src/extension.ts) — `activate()`, registers commands
- [src/types.ts](src/types.ts) — shared types + webview message protocol
- [src/extension/QAAPIController.ts](src/extension/QAAPIController.ts) — orchestrates everything
- [src/extension/PanelManager.ts](src/extension/PanelManager.ts) — webview panel lifecycle
- [src/ai/AIGenerator.ts](src/ai/AIGenerator.ts) — Claude API calls for test generation
- [src/parser/SourceParser.ts](src/parser/SourceParser.ts) — regex extraction of guards/validators/DTOs
- [src/runner/DAGRunner.ts](src/runner/DAGRunner.ts) — sequential journey execution with JSONPath chaining
- [src/runner/AuthManager.ts](src/runner/AuthManager.ts) — role auth bootstrap
- [src/store/FileStore.ts](src/store/FileStore.ts) — `.qaapi/` read/write
- [webview/src/App.tsx](webview/src/App.tsx) — webview state + message bridge
- [webview/src/types.ts](webview/src/types.ts) — mirror of `src/types.ts`; keep them in sync

## Commands

- `npm run compile` — tsc build of extension host
- `npm run watch` — tsc watch mode
- `npm run build:webview` — build the webview bundle
- `npm run build` — both

Use F5 in VSCode to launch the Extension Development Host for manual testing.

## Conventions

- **Types first.** [src/types.ts](src/types.ts) defines the message protocol and data model (`TestSuite`, `Journey`, `Step`, `Assertion`, `Extraction`). Webview types must mirror it.
- **Regex over AST.** `SourceParser` uses regex patterns (not Tree-sitter) for MVP. See ARCHITECTURE §Feature 1 for the pattern list.
- **Source context cap:** 60k chars before sending to Claude.
- **AI model:** `claude-sonnet-4-20250514`. Generation is idempotent — hash source files with md5 and compare to `sourceHash` on existing suite; preserve manual edits.
- **Secrets:** Anthropic key stored in `vscode.secrets`, never on disk. Auth tokens in-memory only.
- **Template vars** in journeys: `{{ctx.varName}}` and `{{env.baseUrl}}` resolved at execution time.
- **Failure semantics:** failed step halts journey; remaining steps marked `skipped`.

## Target-repo layout

Tests for the developer's repo live in `.qaapi/` at that repo's root:

- `qaapi.config.json` — environments, `openApiPath`, `sourcePaths`
- `auth.config.json` — credentials per role
- `tests/{domain}.journey.json` — one `TestSuite` per domain

## Non-goals (MVP)

No browser automation, no remote backend, no CI/CD integration, no parallel role execution, no multi-repo support. Don't add these without discussion.
