# AGENTS.md

This is a [pi](https://pi.dev) extension. It registers a `cursor` provider backed by `@cursor/sdk`. Cursor's agent runs its own tools; this plugin relays thinking, text, and usage into pi.

Do not re-implement Cursor's agent loop or surface Cursor's internal tool calls in pi. Do not install alongside [`pi-cursor-sdk`](https://www.npmjs.com/package/pi-cursor-sdk) — both register `cursor`.

## Layout

- `src/index.ts` — pi extension: provider registration, session-scoped agent reuse, `/cursor-auth`, `/cursor-refresh-models`
- `src/cursor-core.ts` — key resolution, prompt extraction, model discovery, `runCursorTurn` (inject `createStream` for tests)
- `test/cursor.test.ts` — unit tests plus a live Cursor integration test (skipped unless `CURSOR_API_KEY` is set)

## Commands

```bash
pnpm install
pnpm check               # tsc --noEmit
pnpm test                # unit tests; live test needs CURSOR_API_KEY
pi install ./            # load this checkout as a local pi package
```

Live test:

```bash
export CURSOR_API_KEY="crsr_..."
pnpm test
```

## Rules

- Keep the provider small. New behavior belongs in `cursor-core.ts` if it is testable without pi.
- Stream Cursor chunks into **one** pi text block per turn (words must be joined with spaces).
- Unknown model ids (including `auto-smart`) map to `cursor/default`.
- API key order: explicit key (not the placeholder), then `CURSOR_API_KEY`, then `~/.pi/agent/auth.json`.
- Do not commit secrets (`.env`, `.cursor-key`, keys in `auth.json`).
- Public docs live in `README.md`. Follow pi's real CLI (`pi install npm:…`, `pi uninstall`, `/login`, `/model` + Ctrl+S). Use **pnpm** for install, test, and check in this repo.
