# AGENTS.md

This is a [pi](https://pi.dev) extension. It registers a `cursor` provider with pi's `createProvider()` API. Cursor is used as a **model** inside pi's harness: pi owns tools, extensions, and the agent loop.

Do not re-enable Cursor's built-in file/shell tools. Surface model tool calls as pi `toolCall` events so pi-lens, ponytail, and other extensions stay in the loop. Do not depend on other Cursor provider packages.

## Layout

- `src/index.ts` — pi extension: `createProvider`, `/login` via `envApiKeyAuth`, `/cursor-auth`, `/cursor-refresh-models`
- `src/cursor-core.ts` — key resolution, harness prompt, model discovery, `runCursorTurn` (inject `createStream` / `createAgent` for tests)
- `test/cursor.test.ts` — unit tests plus a live Cursor integration test (skipped unless `CURSOR_API_KEY` is set)

## Commands

```bash
npm install
npm run check            # tsc --noEmit
npm test                 # unit tests; live test needs CURSOR_API_KEY
pi install ./            # load this checkout as a local pi package
```

Live test:

```bash
export CURSOR_API_KEY="crsr_..."
npm test
```

## Rules

- Keep the provider small. New behavior belongs in `cursor-core.ts` if it is testable without pi.
- Register a complete pi-ai `Provider` (`createProvider` + `envApiKeyAuth` + `fetchModels`). Do not use the legacy `{ api, streamSimple, models }` config form.
- Each `streamSimple` call is one model round-trip, not a Cursor agent loop. Pass pi's system prompt, messages, and tools. Intercept Cursor custom-tool/MCP calls and emit pi `toolCall` events. Drop Cursor host tools (`shell`, `read`, …) that are not in `context.tools`.
- Stream Cursor chunks into **one** pi text block per turn (words must be joined with spaces).
- Unknown model ids (including `auto-smart`) map to `cursor/default`.
- API key order: `options.apiKey` from pi auth, then `CURSOR_API_KEY`.
- Do not commit secrets (`.env`, `.cursor-key`, keys in `auth.json`).
- Public docs live in `README.md`. Follow pi's real CLI (`pi install npm:…`, `pi uninstall`, `/login`, `/model` + Ctrl+S).
