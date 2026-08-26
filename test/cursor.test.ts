import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractUserPrompt,
  setKnownModelIds,
  runCursorTurn,
  resolveCursorApiKey,
} from "../src/cursor-core.ts";

function fakeStream() {
  const events: any[] = [];
  let resolveClosed: () => void;
  const closed = new Promise<void>((r) => (resolveClosed = r));
  return {
    events,
    closed,
    push: (e: any) => events.push(e),
    end: () => resolveClosed(),
  };
}

test("extractUserPrompt handles string content", () => {
  const { text, images } = extractUserPrompt({
    messages: [
      { role: "assistant", content: "hi" },
      { role: "user", content: "do the thing" },
    ],
  });
  assert.equal(text, "do the thing");
  assert.equal(images, undefined);
});

test("extractUserPrompt handles block content + images", () => {
  const { text, images } = extractUserPrompt({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", mimeType: "image/png", data: "base64data" },
        ],
      },
    ],
  });
  assert.equal(text, "look");
  assert.equal(images?.length, 1);
  assert.equal(images?.[0].data, "base64data");
});

test("extractUserPrompt returns empty when no user message", () => {
  const { text } = extractUserPrompt({
    messages: [{ role: "assistant", content: "hi" }],
  });
  assert.equal(text, "");
});

test("resolveCursorApiKey prefers explicit key over placeholder/env/stored", () => {
  assert.equal(
    resolveCursorApiKey("real-key", { env: "env-key", stored: "stored-key" }),
    "real-key",
  );
  assert.equal(
    resolveCursorApiKey("pi-cursor-auth-placeholder", {
      env: "env-key",
      stored: "stored-key",
    }),
    "env-key",
  );
  assert.equal(
    resolveCursorApiKey(undefined, { stored: "stored-key" }),
    "stored-key",
  );
  assert.equal(
    resolveCursorApiKey(undefined, { env: "", stored: "" }),
    undefined,
  );
});

test("runCursorTurn errors without an API key", async () => {
  setKnownModelIds(["default"]);
  const stream = fakeStream();
  runCursorTurn({
    model: { id: "default", api: "cursor-sdk", provider: "cursor" },
    context: { messages: [{ role: "user", content: "hi" }] },
    apiKey: undefined,
    sessionKey: "k1",
    deps: { createStream: () => stream, calculateCost: () => {} },
  });
  await stream.closed;
  const error = stream.events.find((e) => e.type === "error");
  assert.ok(error, "expected an error event");
  assert.match(error.error.errorMessage, /No Cursor API key/);
});

test("runCursorTurn maps unknown model id to default", async () => {
  // No key -> we only verify the mapping doesn't crash before the key check.
  setKnownModelIds(["default", "claude-opus-5"]);
  const stream = fakeStream();
  runCursorTurn({
    model: { id: "auto-smart", api: "cursor-sdk", provider: "cursor" },
    context: { messages: [{ role: "user", content: "hi" }] },
    apiKey: undefined,
    sessionKey: "k2",
    deps: { createStream: () => stream, calculateCost: () => {} },
  });
  await stream.closed;
  // If it reached the key check, mapping succeeded without throwing.
  const error = stream.events.find((e) => e.type === "error");
  assert.match(error.error.errorMessage, /No Cursor API key/);
});

// Live integration test: requires CURSOR_API_KEY in the environment.
test("runCursorTurn streams a real Cursor response into ONE text block with spaces", {
  skip: !process.env.CURSOR_API_KEY,
  timeout: 180_000,
}, async () => {
  setKnownModelIds(["default"]);
  const stream = fakeStream();
  runCursorTurn({
    model: {
      id: "default",
      api: "cursor-sdk",
      provider: "cursor",
      maxTokens: 64000,
    },
    context: {
      messages: [
        {
          role: "user",
          content:
            "Write a single sentence of at least six words about the weather.",
        },
      ],
    },
    apiKey: process.env.CURSOR_API_KEY,
    sessionKey: "live",
    deps: { createStream: () => stream, calculateCost: () => {} },
  });
  await stream.closed;

  const error = stream.events.find((e) => e.type === "error");
  assert.ok(!error, `unexpected error: ${error?.error?.errorMessage}`);

  const startCount = stream.events.filter(
    (e) => e.type === "text_start",
  ).length;
  const endCount = stream.events.filter((e) => e.type === "text_end").length;
  assert.equal(
    startCount,
    1,
    "expected exactly one text block start (not per-word)",
  );
  assert.equal(
    endCount,
    1,
    "expected exactly one text block end (not per-word)",
  );

  const done = stream.events.find((e) => e.type === "done");
  assert.ok(done, "expected done event");
  const textBlocks = done.message.content.filter((c: any) => c.type === "text");
  assert.equal(
    textBlocks.length,
    1,
    "expected a single accumulated text block",
  );
  assert.ok(
    textBlocks[0].text.includes(" "),
    "expected words joined with spaces",
  );
  assert.ok(
    done.message.usage.totalTokens > 0,
    "expected non-zero token usage",
  );
});
