# qaapi

**API integration testing, inside VSCode.** Import your endpoints from an OpenAPI spec, edit requests inline, run with auth injected, and optionally use AI on-demand to fill in realistic payloads or expand coverage across response codes.

Think Postman meets your IDE.

![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)

## Why qaapi

- **No context switch.** Tests live in `.qaapi/` inside your repo. Git-committable, shareable.
- **OpenAPI-first.** One click imports every endpoint. Merge-based, so your edits are never overwritten.
- **Editable like Postman.** Body, headers, query params, expected status, all tabs, all auto-saved.
- **Auth that isn't painful.** Five strategies built in, including a `token-chain` for multi-hop OAuth-then-exchange flows with JWT-expiry-aware caching.
- **Optional AI, on-demand.** `✨ Suggest` fills a realistic body for a case you describe. `✨ Expand cases` generates one test per response code the endpoint declares (400, 404, 409, etc.), grounded in your DTOs. Off by default; click when you want it.
- **Share safely.** Export your whole `.qaapi/` as an AES-256 encrypted bundle; import on a teammate's machine with a password.

## Features

| | |
|---|---|
| **Sync from OpenAPI** | Imports / merges all endpoints from a spec URL or file. Never destroys user edits. |
| **Inline request editor** | Body (JSON textarea), Headers, Query, Expected status, all editable, auto-saved. |
| **Sent tab** | After a run, see exactly what went out, including the auto-injected `Authorization` header. |
| **Auth strategies** | `credentials`, `auto-register`, `api-key`, `oauth2-client-credentials`, `token-chain` (custom multi-step flows). |
| **Localhost TLS bypass** | Self-signed dev certs on `localhost` / `127.0.0.1` just work. Remote hosts verify normally. |
| **Suggest payload** | Describe your case ("missing email", "happy path") and AI returns a grounded JSON body. |
| **Expand cases** | One click per endpoint and new journeys appear for every declared response code the suite doesn't already cover. |
| **Aggregate status** | Sidebar shows `N✓ N✗` pass/fail counts per suite and per endpoint group. |
| **Encrypted bundles** | Export/import `.qaapi/` with a password for safe sharing. |

## Install

**From the VSCode Marketplace:** search for **"qaapi"**.

Or install via CLI:
```bash
code --install-extension qaapi.qaapi
```

## Quick start

1. Open the qaapi icon on the activity bar. The main panel opens automatically.
2. Click the gear icon, **Settings**, then set:
   - **Base URL**: where your API runs
   - **OpenAPI / Swagger URL**: e.g. `http://localhost:3000/api-docs/json`
   - **Authentication**: pick a strategy and fill in the fields
3. Click **Sync from OpenAPI**. Journeys populate in the sidebar.
4. Click any journey, edit the Body tab, then click **▶ Run**.
5. (Optional) Hover an endpoint group and click **✨** to generate extra test cases for declared response codes.

## Project layout in your repo

```
.qaapi/
├── qaapi.config.json          # environments + OpenAPI URL
├── auth.config.json           # auth strategy + config
└── tests/
    ├── users.journey.json     # one TestSuite per domain
    └── orders.journey.json
```

Commit this to git. Share it with your team. The encrypted bundle feature is for anything containing secrets (`auth.config.json`).

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

Quick fork and run:

```bash
git clone https://github.com/SamsonMaborukoje/qaapi
cd qaapi
npm install
cd webview && npm install && cd ..
npm run build
# Open in VSCode and press F5 to launch the Extension Development Host
```

Architecture overview: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Code conventions: [CLAUDE.md](CLAUDE.md).

## License

MIT. See [LICENSE](LICENSE).
