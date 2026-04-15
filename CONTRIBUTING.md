# Contributing to qaapi

Thanks for your interest. Keeping this short. The full design rationale is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and code conventions in [CLAUDE.md](CLAUDE.md).

## Dev setup

```bash
git clone https://github.com/SamsonMaborukoje/qaapi
cd qaapi
npm install
cd webview && npm install && cd ..
npm run build
```

Open the repo in VSCode, press **F5** to launch the Extension Development Host.

### Dev loop

- **Extension host changes:** `npm run watch` in one terminal. Reload the dev host window with `Ctrl+R` after each rebuild.
- **Webview changes:** `npm run build:webview` after each change, then `Ctrl+R` in the dev host.
- **Changes to `package.json` or `media/`:** fully close the dev host and re-F5. Icons and contributes are cached at host startup.
- **Debugging logs:** `View`, `Output`, select `qaapi` in the dev host.

## What we accept

- Bug fixes, especially around auth edge cases, template resolution, and spec quirks.
- New auth strategies in `src/runner/AuthManager.ts`, with a matching `AuthConfig` type.
- Parser improvements, richer DTO/source grounding in `src/parser/SourceParser.ts` helps the AI features.
- UI polish, accessibility, keyboard nav, clearer error states.
- Docs fixes.

## What we're cautious about

Please open an issue first for:

- New AI providers (we deliberately ship Claude CLI only today, see CLAUDE.md for why).
- Full-suite AI generation (previously removed, low hit rate). AI should stay targeted and on-demand.
- Role-based test matrix (removed; single-user for now).
- Browser automation, external backends, CI/CD runners, these are **non-goals** per the architecture.
- Destructive file operations or schema migrations, bundle or suite format changes need discussion.

## Ground rules

- **Types first.** Add the type to [src/types.ts](src/types.ts) and mirror it in [webview/src/types.ts](webview/src/types.ts). The mirror is checked by consumers, so both must stay aligned.
- **Non-destructive by default.** Anything that writes `.qaapi/` must not overwrite user edits silently. Merge, append, or prompt.
- **No secrets on disk we don't have to.** Tokens stay in memory. Credentials live in `auth.config.json` today, a known gap (see the bundle-export flow for the secure-share path).
- **Localhost TLS bypass is scoped.** Automatic only for `localhost` / `127.0.0.1` / `::1`. Never apply to remote hosts implicitly, use `insecureTls` opt-in on `token-chain` for dev endpoints with untrusted chains.
- **Stay deterministic where we can.** AI should be opt-in per action, never silently applied to user work.
- **No emoji in source** unless the user-visible string already has one (e.g. the `✨` buttons).

## PR checklist

Before opening:

- [ ] `npm run build` succeeds (extension + webview)
- [ ] Manual smoke test: open the dev host, run an existing journey, verify no regressions
- [ ] Types in `src/types.ts` and `webview/src/types.ts` still match
- [ ] New behavior documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) if it's user-facing or changes a message type
- [ ] Commit messages explain *why*, not just *what*

## Reporting issues

Include:

- VSCode version and OS
- qaapi version
- Steps to reproduce (config plus a minimal spec snippet if relevant)
- Full contents of `View`, `Output`, `qaapi` for the run that failed
- Screenshots for UI issues

Redact any credentials before pasting logs.

## Security

Please report security issues privately rather than in public issues. Open a GitHub security advisory or email the maintainer.

## License

By contributing, you agree that your work will be released under the [MIT License](LICENSE).
