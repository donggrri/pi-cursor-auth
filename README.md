# pi-cursor-auth

A [pi](https://pi.dev) extension that registers **Cursor** as a model provider, using your [Cursor SDK](https://cursor.com) API key.

It discovers the live Cursor model catalog, streams thinking and text into pi, and is a small alternative to [`pi-cursor-sdk`](https://www.npmjs.com/package/pi-cursor-sdk): Cursor's own agent runs its tools, and this plugin relays the final answer.

See the [changelog](https://github.com/morizkay/pi-cursor-auth/blob/main/CHANGELOG.md) for release notes. Contributor notes are in [AGENTS.md](https://github.com/morizkay/pi-cursor-auth/blob/main/AGENTS.md).

## Install

Requires [pi](https://pi.dev). Then:

```bash
pi install npm:pi-cursor-auth
```

Or from git:

```bash
pi install git:github.com/morizkay/pi-cursor-auth
```

Pin a version if you want updates to skip this package:

```bash
pi install npm:pi-cursor-auth@0.1.2
pi install git:github.com/morizkay/pi-cursor-auth@v0.1.2
```

Installs are written to `~/.pi/agent/settings.json`. Use `-l` to install for the current project (`.pi/settings.json`) instead.

If you also have [`pi-cursor-sdk`](https://www.npmjs.com/package/pi-cursor-sdk) installed, uninstall it first — both register the `cursor` provider and will conflict:

```bash
pi uninstall npm:pi-cursor-sdk
```

## Uninstall

```bash
pi uninstall npm:pi-cursor-auth
```

If you installed from git:

```bash
pi uninstall git:github.com/morizkay/pi-cursor-auth
```

Use `-l` if the package was installed in the project.

## Configure your Cursor API key

Choose one:

1. **Environment variable** (set it before starting pi):

   ```bash
   export CURSOR_API_KEY="crsr_..."
   pi
   ```

2. **`/login`** — in pi, run `/login`, choose *Use an API key*, choose *Cursor*, and paste the key. pi stores it in `~/.pi/agent/auth.json`.

3. **`/cursor-auth`** — run `/cursor-auth` and paste your key, or pass it as an argument: `/cursor-auth crsr_...`. Writes the key to `~/.pi/agent/auth.json` under the `cursor` entry.

If pi started without a key, run **`/cursor-refresh-models`** after `/login` or `/cursor-auth` so the extension loads the live Cursor catalog. The startup fallback list is small.

## Use

Pick a Cursor model with `/model` (or Ctrl+L), for example:

- `cursor/default`
- `cursor/claude-opus-5`
- `cursor/gpt-5.6-sol`

You can also start pi with a model:

```bash
pi --model cursor/default
```

To save Cursor as the startup default, select it in `/model` and press **Ctrl+S**. That writes `~/.pi/agent/settings.json`:

```json
{
  "defaultProvider": "cursor",
  "defaultModel": "default"
}
```

Unknown model ids, including `auto-smart`, are mapped to `cursor/default`.

## Commands

- `/cursor-auth [key]` — store your Cursor API key
- `/cursor-refresh-models` — re-discover the live Cursor catalog with the current key

## How it works

The extension registers a `cursor` provider backed by `@cursor/sdk`. On each turn it:

1. Resolves your API key from `CURSOR_API_KEY` or `~/.pi/agent/auth.json`
2. Reuses a Cursor agent for the current pi session (recreated after compaction or an errored run)
3. Streams thinking, assistant text, and usage from Cursor into pi

Cursor's agent executes its own tools. This plugin does not re-implement that loop or surface those tool calls in pi.

## Limitations

- Cursor's agent runs **autonomously** (file/shell tools). This plugin relays the final answer and thinking; it does not surface Cursor's internal tool calls into pi's tool runtime.
- The Cursor agent is scoped per pi session and reused across follow-up turns.
- Model context windows and costs are not available per-model from the SDK catalog, so costs show as $0 in usage. Token counts are accurate.

## Development

Clone, install, and see [AGENTS.md](https://github.com/morizkay/pi-cursor-auth/blob/main/AGENTS.md) for layout, commands, and contribution rules.

```bash
git clone https://github.com/morizkay/pi-cursor-auth.git
cd pi-cursor-auth
pnpm install
```

```bash
export CURSOR_API_KEY="crsr_..."
pnpm test                # unit + live integration (real Cursor call)
pnpm check               # tsc --noEmit
```

The live test calls Cursor with your key and asserts a streamed response with token usage. It is skipped when `CURSOR_API_KEY` is unset.

For a local pi install from a checkout:

```bash
pi install ./
```
