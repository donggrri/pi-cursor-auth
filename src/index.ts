import {
  createAssistantMessageEventStream,
  calculateCost,
} from "@earendil-works/pi-ai";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

import {
  CURSOR_PROVIDER_ID,
  CURSOR_API_KEY_PLACEHOLDER,
  resolveCursorApiKey,
  discoverCursorModels,
  fallbackModels,
  setKnownModelIds,
  runCursorTurn,
  dropAgent,
} from "./cursor-core.js";

function safeReadStoredKey(provider: string): string | undefined {
  try {
    const cred = readStoredCredential(provider);
    return cred?.type === "api_key" ? cred.key : undefined;
  } catch {
    return undefined;
  }
}

function authJsonPath(): string {
  const dir = process.env.PI_CODING_AGENT_DIR
    ? join(process.env.PI_CODING_AGENT_DIR, "auth.json")
    : join(homedir(), ".pi", "agent", "auth.json");
  return dir;
}

export function writeCursorKey(key: string): void {
  const path = authJsonPath();
  let data: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }
  data[CURSOR_PROVIDER_ID] = { type: "api_key", key };
  const dir = path.slice(0, path.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

function resolveKey(options: any): string | undefined {
  return resolveCursorApiKey(options?.apiKey, {
    env: process.env.CURSOR_API_KEY,
    stored: safeReadStoredKey(CURSOR_PROVIDER_ID),
  });
}

export default async function (pi: any) {
  let currentSessionKey = "anon";

  const streamSimple = (model: any, context: any, options?: any) =>
    runCursorTurn({
      model,
      context,
      options,
      apiKey: resolveKey(options),
      sessionKey: currentSessionKey,
      deps: { createStream: createAssistantMessageEventStream, calculateCost },
    });

  function registerCursorProvider(models: any[]) {
    setKnownModelIds(models.map((m) => m.id));
    pi.registerProvider(CURSOR_PROVIDER_ID, {
      name: "Cursor",
      baseUrl: "https://cursor.com",
      apiKey: CURSOR_API_KEY_PLACEHOLDER,
      api: "cursor-sdk",
      models,
      streamSimple,
    });
  }

  // Initial model catalog: live if a key is already available, else fallback.
  const startupKey = resolveCursorApiKey(undefined, {
    env: process.env.CURSOR_API_KEY,
    stored: safeReadStoredKey(CURSOR_PROVIDER_ID),
  });
  const live = await discoverCursorModels(startupKey);
  const models = live.length ? live : fallbackModels();
  registerCursorProvider(models);

  pi.on("session_start", (_event: any, ctx: any) => {
    currentSessionKey =
      ctx?.sessionManager?.getSessionFile?.() ?? ctx?.sessionId ?? "anon";
  });

  pi.on("session_before_compact", () => {
    dropAgent(currentSessionKey);
  });

  pi.registerCommand("cursor-auth", {
    description: "Store your Cursor SDK API key for pi (env, arg, or prompt)",
    handler: async (args: string, ctx: any) => {
      let key = (args || "").trim() || process.env.CURSOR_API_KEY;
      if (!key && ctx?.ui?.input) {
        key = (await ctx.ui.input("Paste your Cursor API key:")).trim();
      }
      if (!key) {
        ctx?.ui?.notify("No Cursor API key provided.", "warning");
        return;
      }
      writeCursorKey(key);
      dropAgent(currentSessionKey);
      ctx?.ui?.notify(
        "Cursor API key saved. Run /cursor-refresh-models to load the live catalog.",
        "info",
      );
    },
  });

  pi.registerCommand("cursor-refresh-models", {
    description:
      "Re-discover the live Cursor model catalog with the current key",
    handler: async (_args: string, ctx: any) => {
      const key = resolveKey({ apiKey: CURSOR_API_KEY_PLACEHOLDER });
      const refreshed = await discoverCursorModels(key);
      if (!refreshed.length) {
        ctx?.ui?.notify(
          "No Cursor key configured or discovery failed.",
          "warning",
        );
        return;
      }
      registerCursorProvider(refreshed);
      ctx?.ui?.notify(
        `Cursor catalog refreshed with ${refreshed.length} models.`,
        "info",
      );
    },
  });
}
