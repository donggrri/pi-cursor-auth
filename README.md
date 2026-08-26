# pi-cursor-auth

A minimal [pi](https://pi.dev) extension that lets pi use your **Cursor SDK API key**
as a model provider. See [CHANGELOG.md](CHANGELOG.md) for release notes. It registers a `cursor` provider backed by `@cursor/sdk`, resolves
your key from the environment or pi's credential store, discovers the live Cursor model
catalog, and streams Cursor's responses (thinking + text) into pi.

It is a deliberately small alternative to `pi-cursor-sdk`: one file of provider logic
plus the extension entry. Cursor's local agent executes its own tools, so this plugin
relays Cursor's final answer rather than re-implementing Cursor's agent loop.

## Install

Already installed locally for this machine via:

```bash
pi install ./            # adds this repo as a local extension package
```

To install elsewhere, copy this folder somewhere and run `pi install <path>`, or
publish it and use `pi install git:<repo>`.

> If you also have `pi-cursor-sdk` installed, remove it from your `packages` list
> (it registers the same `cursor` provider and will conflict). This plugin was built
> to replace it.

## Configure your Cursor API key

Choose one:

1. **Environment variable** (simplest):

   ```bash
   export CURSOR_API_KEY="crsr_..."
   ```

2. **`/login`** — in pi, run `/login`, pick *Use an API key*, pick *Cursor*, paste the key.
   pi stores it in `~/.pi/agent/auth.json`.
3. **`/cursor-auth`** — a command included in this extension. Run `/cursor-auth` and paste
   your key (or pass it as an argument: `/cursor-auth crsr_...`). It writes the key to
   `~/.pi/agent/auth.json` under the `cursor` entry.

After setting the key with method 2 or 3, run **`/cursor-refresh-models`** once so the
extension loads the live Cursor model catalog (the startup fallback list is small).

## Use

Your `settings.json` already has `defaultProvider: "cursor"`. With a key configured, just
talk to pi — it will route through Cursor. Pick a specific model with `/model`
(e.g. `cursor/default`, `cursor/claude-opus-5`, `cursor/gpt-5.6-sol`).

The saved `defaultModel: "auto-smart"` is not a real Cursor model id in the current SDK;
this plugin maps unknown ids (including `auto-smart`) to `cursor/default`, so it still works.

## Commands

- `/cursor-auth [key]` — store your Cursor API key.
- `/cursor-refresh-models` — re-discover the live Cursor catalog with the current key.

## How it works

- `src/cursor-core.ts` — key resolution, prompt extraction, model discovery, and the
  streaming turn (`runCursorTurn`). It takes a `createStream` factory so it is testable
  without pi (a fake stream is injected in tests).
- `src/index.ts` — the pi extension: registers the `cursor` provider, wires the key
  resolver, tracks the session so a Cursor agent is reused across follow-up turns, and
  registers the two commands.

Streaming reads from `run.stream()` (thinking / assistant text / usage) and finalizes with
`run.wait()`.

## Testing

```bash
export CURSOR_API_KEY="crsr_..."
npm test                 # unit + live integration (real Cursor call)
npm run check           # tsc --noEmit type check
```

The live test calls Cursor with your key and asserts a streamed response with token usage.

## Limitations

- Cursor's agent runs **autonomously** (it executes its own file/shell tools). This plugin
  relays Cursor's final answer and thinking; it does not surface Cursor's internal tool
  calls back into pi's tool runtime.
- The Cursor agent is scoped per pi session and reused across follow-up turns. After
  compaction or an errored run it is recreated on the next turn.
- Model context windows / costs are not pulled per-model (the SDK catalog doesn't expose
  them); costs show as $0 in usage. Token counts are accurate.
