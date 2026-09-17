import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractLastUserImages,
  buildHarnessPrompt,
  collectToolCalls,
  unwrapCursorToolCall,
  thinkingParams,
  cursorModelParams,
  setKnownModelIds,
  resolveModelId,
  runCursorTurn,
  resolveCursorApiKey,
  fallbackModels,
  CURSOR_API,
  CURSOR_COMPAT_SOURCE_ID,
  createCursorCompatApiProvider,
  configureCursorRipgrepPath,
  acquireWorkspaceLease,
  releaseWorkspaceLease,
  getActiveWorkspaceLease,
  __resetWorkspaceLeaseManagerForTests,
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

test("extractLastUserImages returns images from the last user message", () => {
  const images = extractLastUserImages({
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
  assert.equal(images?.length, 1);
  assert.equal(images?.[0].data, "base64data");
});

test("extractLastUserImages is undefined for string content", () => {
  const images = extractLastUserImages({
    messages: [{ role: "user", content: "do the thing" }],
  });
  assert.equal(images, undefined);
});

test("buildHarnessPrompt puts pi's system prompt and history in front of Cursor", () => {
  const prompt = buildHarnessPrompt({
    systemPrompt: "Be a lazy senior.",
    messages: [
      { role: "user", content: "read pkg" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "ok" },
          {
            type: "toolCall",
            id: "c1",
            name: "read",
            arguments: { path: "package.json" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read",
        isError: false,
        content: [{ type: "text", text: "{}" }],
      },
    ],
  });
  assert.match(prompt, /Use only the tools provided/);
  assert.match(prompt, /Be a lazy senior/);
  assert.match(prompt, /\[user\]\nread pkg/);
  assert.match(prompt, /\[tool_call read c1\]/);
  assert.match(prompt, /\[tool_result read c1\]/);
  assert.ok(
    prompt.indexOf("Be a lazy senior") < prompt.indexOf("[user]"),
    "pi system prompt must precede conversation",
  );
});

test("collectToolCalls reads Cursor tool_use blocks", () => {
  const calls = collectToolCalls([
    { type: "text", text: "hi" },
    { type: "tool_use", id: "c1", name: "bash", input: { command: "ls" } },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "c1");
  assert.equal(calls[0].name, "bash");
  assert.equal(calls[0].arguments.command, "ls");
});

test("unwrapCursorToolCall maps MCP calls onto pi tool names", () => {
  const call = unwrapCursorToolCall(
    "CallMcpTool",
    {
      toolName: "read",
      arguments: { path: "package.json" },
    },
    "c1",
    new Set(["read"]),
  );
  assert.equal(call?.name, "read");
  assert.equal(call?.arguments.path, "package.json");
  assert.equal(
    unwrapCursorToolCall("GetMcpTools", {}, "c2", new Set(["read"])),
    null,
  );
  assert.equal(
    unwrapCursorToolCall("shell", { command: "rm -rf /" }, "c3", new Set(["read"])),
    null,
  );
});

test("thinkingParams maps pi reasoning onto Cursor model params", () => {
  const model = {
    cursorParameters: [
      {
        id: "reasoning_effort",
        displayName: "Reasoning",
        values: [{ value: "low" }, { value: "high" }],
      },
    ],
  };
  assert.deepEqual(thinkingParams(model, "high"), [
    { id: "reasoning_effort", value: "high" },
  ]);
  assert.equal(thinkingParams(model, "off"), undefined);
  assert.equal(thinkingParams({}, "high"), undefined);
});

test("cursorModelParams disables fast for a non-fast model", () => {
  const model = {
    id: "grok-4.6",
    cursorParameters: [
      {
        id: "reasoning_effort",
        displayName: "Reasoning",
        values: [{ value: "low" }, { value: "high" }],
      },
      {
        id: "fast",
        displayName: "Fast mode",
        values: [{ value: "true" }, { value: "false" }],
      },
    ],
  };

  assert.deepEqual(cursorModelParams(model, "high"), [
    { id: "reasoning_effort", value: "high" },
    { id: "fast", value: "false" },
  ]);
});

test("cursorModelParams preserves an explicit fast model selection", () => {
  const model = {
    id: "grok-4.6-fast",
    cursorParameters: [
      {
        id: "reasoning_effort",
        displayName: "Reasoning",
        values: [{ value: "low" }, { value: "high" }],
      },
      {
        id: "fast",
        displayName: "Fast mode",
        values: [{ value: "true" }, { value: "false" }],
      },
    ],
  };

  assert.deepEqual(cursorModelParams(model, "high"), [
    { id: "reasoning_effort", value: "high" },
  ]);
});

test("cursorModelParams disables fast for a parameter-less non-fast model", () => {
  assert.deepEqual(cursorModelParams({ id: "grok-4.6" }, undefined), [
    { id: "fast", value: "false" },
  ]);
});

test("cursorModelParams omits unsupported false values", () => {
  const model = {
    id: "grok-4.6",
    cursorParameters: [
      {
        id: "fast",
        displayName: "Fast mode",
        values: [{ value: "true" }],
      },
    ],
  };

  assert.equal(cursorModelParams(model, undefined), undefined);
});

test("cursor streams expose a pi-ai compat registration", () => {
  const stream = () => "stream";
  const registration = createCursorCompatApiProvider({
    stream,
    streamSimple: stream,
  });

  assert.equal(CURSOR_COMPAT_SOURCE_ID, "pi-cursor-auth");
  assert.equal(registration.api, CURSOR_API);
  assert.equal(registration.stream, stream);
  assert.equal(registration.streamSimple, stream);
});

test("fallbackModels are complete pi Model objects", () => {
  const models = fallbackModels();
  assert.ok(models.length > 0);
  assert.equal(models[0].id, "composer-2.5");
  for (const model of models) {
    assert.equal(model.provider, "cursor");
    assert.equal(model.api, "cursor-sdk");
    assert.equal(model.baseUrl, "https://cursor.com");
    assert.equal(typeof model.id, "string");
    assert.equal(model.reasoning, true);
  }
});

test("resolveModelId maps Auto and composer thinking suffixes to composer-2.5", () => {
  setKnownModelIds(["composer-2.5", "grok-4.6"]);
  assert.equal(resolveModelId("composer-2.5:high"), "composer-2.5");
  assert.equal(resolveModelId("composer-2.5:medium"), "composer-2.5");
  assert.equal(resolveModelId("composer-2.5"), "composer-2.5");
  assert.equal(resolveModelId("auto-smart"), "composer-2.5");
  assert.equal(resolveModelId("auto"), "composer-2.5");
  assert.equal(resolveModelId("auto:high"), "composer-2.5");
  assert.equal(resolveModelId("default"), "composer-2.5");
  assert.equal(resolveModelId("default:high"), "composer-2.5");
  assert.equal(resolveModelId("not-a-real-model"), "composer-2.5");
  assert.equal(resolveModelId("grok-4.6"), "grok-4.6");
  assert.equal(resolveModelId("grok-4.6:high"), "grok-4.6:high");
});

test("thinkingParams does not send effort for composer-2.5", () => {
  const model = {
    id: "composer-2.5",
    cursorParameters: [
      {
        id: "effort",
        displayName: "Effort",
        values: [{ value: "low" }, { value: "high" }],
      },
      {
        id: "fast",
        displayName: "Fast",
        values: [{ value: "false" }, { value: "true" }],
      },
    ],
  };
  assert.equal(thinkingParams(model, "high"), undefined);
  assert.equal(thinkingParams({ ...model, id: "composer-2.5:high" }, "high"), undefined);
  assert.deepEqual(cursorModelParams(model, "high"), [
    { id: "fast", value: "false" },
  ]);
});

test("configureCursorRipgrepPath preserves an explicit SDK path", () => {
  const env = { CURSOR_RIPGREP_PATH: "/tmp/rg" };
  assert.equal(configureCursorRipgrepPath(env), "/tmp/rg");
  assert.equal(env.CURSOR_RIPGREP_PATH, "/tmp/rg");
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
    deps: { createStream: () => stream, calculateCost: () => {} },
  });
  await stream.closed;
  const error = stream.events.find((e) => e.type === "error");
  assert.ok(error, "expected an error event");
  assert.match(error.error.errorMessage, /No Cursor API key/);
});

test("runCursorTurn maps composer-2.5:high and Auto aliases to composer-2.5", async () => {
  setKnownModelIds(["composer-2.5", "grok-4.6"]);
  const stream = fakeStream();
  let created: any;
  const createAgent = async (opts: any) => {
    created = opts;
    return {
      send: async () => ({
        stream: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "ok" }] },
          };
        },
        cancel: async () => {},
        wait: async () => ({ status: "finished" }),
      }),
      close: () => {},
    };
  };

  runCursorTurn({
    model: { id: "composer-2.5:high", api: "cursor-sdk", provider: "cursor" },
    context: { messages: [{ role: "user", content: "hi" }] },
    options: { reasoning: "high" },
    apiKey: "test-key",
    deps: { createStream: () => stream, calculateCost: () => {}, createAgent },
  });
  await stream.closed;
  assert.equal(created.model.id, "composer-2.5");
  assert.deepEqual(created.model.params, [{ id: "fast", value: "false" }]);
});

test("runCursorTurn emits pi toolCall events, passes fast params, and does not enable Cursor tools", async () => {
  setKnownModelIds(["default"]);
  const stream = fakeStream();
  let created: any;
  const createAgent = async (opts: any) => {
    created = opts;
    return {
      send: async () => ({
        stream: async function* () {
          yield {
            type: "assistant",
            message: {
              content: [{ type: "text", text: "Reading package.json now." }],
            },
          };
          yield {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "c1",
                  name: "read",
                  input: { path: "package.json" },
                },
              ],
            },
          };
        },
        cancel: async () => {},
        wait: async () => ({ status: "cancelled" }),
      }),
      close: () => {},
    };
  };

  runCursorTurn({
    model: {
      id: "default",
      api: "cursor-sdk",
      provider: "cursor",
      cursorParameters: [
        {
          id: "fast",
          displayName: "Fast mode",
          values: [{ value: "true" }, { value: "false" }],
        },
      ],
    },
    context: {
      systemPrompt: "Use pi tools.",
      messages: [{ role: "user", content: "read package.json" }],
      tools: [
        {
          name: "read",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
          },
        },
      ],
    },
    apiKey: "test-key",
    deps: {
      createStream: () => stream,
      calculateCost: () => {},
      createAgent,
    },
  });
  await stream.closed;

  assert.deepEqual(created.model.params, [{ id: "fast", value: "false" }]);
  assert.deepEqual(created.tools, ["mcp"]);
  assert.equal(typeof created.local.customTools.read.execute, "function");
  assert.deepEqual(created.local.settingSources, []);

  const error = stream.events.find((e) => e.type === "error");
  assert.ok(!error, `unexpected error: ${error?.error?.errorMessage}`);
  const done = stream.events.find((e) => e.type === "done");
  assert.equal(done.reason, "toolUse");
  const toolCalls = done.message.content.filter((c: any) => c.type === "toolCall");
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].name, "read");
  assert.equal(toolCalls[0].arguments.path, "package.json");
  assert.ok(
    stream.events.some((e) => e.type === "toolcall_end"),
    "expected toolcall_end",
  );
});

test("runCursorTurn unwraps Cursor MCP tool calls into pi tool names", async () => {
  setKnownModelIds(["default"]);
  const stream = fakeStream();
  const createAgent = async () => ({
    send: async () => ({
      stream: async function* () {
        yield {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "c1",
                name: "CallMcpTool",
                input: {
                  toolName: "read",
                  arguments: { path: "package.json" },
                },
              },
            ],
          },
        };
      },
      cancel: async () => {},
      wait: async () => ({ status: "cancelled" }),
    }),
    close: () => {},
  });

  runCursorTurn({
    model: { id: "default", api: "cursor-sdk", provider: "cursor" },
    context: {
      systemPrompt: "Use pi tools.",
      messages: [{ role: "user", content: "read package.json" }],
      tools: [
        {
          name: "read",
          description: "Read a file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
    },
    apiKey: "test-key",
    deps: {
      createStream: () => stream,
      calculateCost: () => {},
      createAgent,
    },
  });
  await stream.closed;

  const done = stream.events.find((e) => e.type === "done");
  assert.equal(done.reason, "toolUse");
  const toolCalls = done.message.content.filter((c: any) => c.type === "toolCall");
  assert.equal(toolCalls[0].name, "read");
  assert.equal(toolCalls[0].arguments.path, "package.json");
});

test("runCursorTurn disables Cursor tools when pi has none", async () => {
  setKnownModelIds(["default"]);
  const stream = fakeStream();
  let created: any;
  const createAgent = async (opts: any) => {
    created = opts;
    return {
      send: async () => ({
        stream: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Sunny and calm today." }] },
          };
        },
        cancel: async () => {},
        wait: async () => ({
          status: "finished",
          usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
        }),
      }),
      close: () => {},
    };
  };

  runCursorTurn({
    model: { id: "default", api: "cursor-sdk", provider: "cursor" },
    context: { messages: [{ role: "user", content: "weather?" }] },
    apiKey: "test-key",
    deps: {
      createStream: () => stream,
      calculateCost: () => {},
      createAgent,
    },
  });
  await stream.closed;

  assert.deepEqual(created.tools, []);
  assert.equal(created.local.customTools, undefined);
  const done = stream.events.find((e) => e.type === "done");
  assert.equal(done.reason, "stop");
  assert.equal(done.message.content[0].text, "Sunny and calm today.");
});

test("runCursorTurn consumes rejected SDK cancellation promises", async () => {
  setKnownModelIds(["default"]);
  const stream = fakeStream();
  const controller = new AbortController();
  controller.abort();
  let cancelled = false;
  const createAgent = async () => ({
    send: async () => ({
      stream: async function* () {},
      cancel: () => {
        cancelled = true;
        return Promise.reject(new DOMException("This operation was aborted", "AbortError"));
      },
      wait: async () => ({ status: "cancelled" }),
    }),
    close: () => {},
  });

  runCursorTurn({
    model: { id: "default", api: "cursor-sdk", provider: "cursor" },
    context: { messages: [{ role: "user", content: "hi" }] },
    options: { signal: controller.signal },
    apiKey: "test-key",
    deps: { createStream: () => stream, calculateCost: () => {}, createAgent },
  });
  await stream.closed;

  assert.equal(cancelled, true);
  assert.equal(stream.events.find((e) => e.type === "error")?.reason, "aborted");
});

function sdkNestedAbortThrow() {
  const parent = new AbortController();
  const clone = new AbortController();
  parent.signal.addEventListener(
    "abort",
    () => clone.abort(parent.signal.reason),
    { once: true },
  );
  clone.signal.addEventListener(
    "abort",
    () => {
      throw (
        clone.signal.reason ||
        new DOMException("This operation was aborted", "AbortError")
      );
    },
    { once: true },
  );
  parent.abort();
}

test("runCursorTurn swallows SDK abort-listener throws during subagent handoff", async () => {
  setKnownModelIds(["composer-2.5", "default"]);
  const stream = fakeStream();
  const leaked: unknown[] = [];
  const onUncaught = (err: unknown) => {
    leaked.push(err);
  };
  process.on("uncaughtException", onUncaught);

  let cancelled = false;
  const createAgent = async () => ({
    send: async () => ({
      stream: async function* () {
        yield {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "c1",
                name: "subagent",
                input: { agent: "worker", task: "do Tpack" },
              },
            ],
          },
        };
        await new Promise((r) => setTimeout(r, 80));
      },
      cancel: () => {
        cancelled = true;
        sdkNestedAbortThrow();
        return Promise.resolve();
      },
      wait: async () => ({ status: "cancelled" }),
    }),
    close: () => sdkNestedAbortThrow(),
  });

  try {
    runCursorTurn({
      model: { id: "composer-2.5", api: "cursor-sdk", provider: "cursor" },
      context: {
        messages: [{ role: "user", content: "run worker" }],
        tools: [
          {
            name: "subagent",
            description: "Spawn a subagent",
            parameters: { type: "object", properties: {} },
          },
        ],
      },
      apiKey: "test-key",
      deps: { createStream: () => stream, calculateCost: () => {}, createAgent },
    });
    await stream.closed;
    await new Promise((r) => setTimeout(r, 40));
  } finally {
    process.removeListener("uncaughtException", onUncaught);
  }

  assert.equal(cancelled, true);
  assert.equal(stream.events.find((e) => e.type === "done")?.reason, "toolUse");
  assert.equal(
    leaked.filter(
      (err) =>
        err instanceof Error &&
        (err.name === "AbortError" || err.message === "This operation was aborted"),
    ).length,
    0,
    "AbortError must not reach uncaughtException during tool handoff",
  );
});

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

test("acquireWorkspaceLease reuses lease when apiKey and cwd are identical", async () => {
  __resetWorkspaceLeaseManagerForTests();
  let prewarmCount = 0;
  let releaseCount = 0;
  const prewarmFn = async () => {
    prewarmCount++;
    return async () => {
      releaseCount++;
    };
  };

  await acquireWorkspaceLease({ apiKey: "test-key-1", cwd: "/test/path/a", prewarmFn });
  await acquireWorkspaceLease({ apiKey: "test-key-1", cwd: "/test/path/a", prewarmFn });

  assert.equal(prewarmCount, 1, "prewarmFn should only be called once for identical key and cwd");
  assert.equal(releaseCount, 0, "release should not be called when reusing lease");
  assert.deepEqual(getActiveWorkspaceLease(), { apiKey: "test-key-1", cwd: "/test/path/a" });
});

test("acquireWorkspaceLease releases existing lease and acquires new one when apiKey or cwd changes", async () => {
  __resetWorkspaceLeaseManagerForTests();
  const events: string[] = [];

  const createPrewarm = (id: string) => async () => {
    events.push(`prewarm:${id}`);
    return async () => {
      events.push(`release:${id}`);
    };
  };

  // Initial lease
  await acquireWorkspaceLease({
    apiKey: "key-a",
    cwd: "/path/1",
    prewarmFn: createPrewarm("lease-1"),
  });
  assert.deepEqual(getActiveWorkspaceLease(), { apiKey: "key-a", cwd: "/path/1" });
  assert.deepEqual(events, ["prewarm:lease-1"]);

  // Change cwd
  await acquireWorkspaceLease({
    apiKey: "key-a",
    cwd: "/path/2",
    prewarmFn: createPrewarm("lease-2"),
  });
  assert.deepEqual(getActiveWorkspaceLease(), { apiKey: "key-a", cwd: "/path/2" });
  assert.deepEqual(events, ["prewarm:lease-1", "release:lease-1", "prewarm:lease-2"]);

  // Change apiKey
  await acquireWorkspaceLease({
    apiKey: "key-b",
    cwd: "/path/2",
    prewarmFn: createPrewarm("lease-3"),
  });
  assert.deepEqual(getActiveWorkspaceLease(), { apiKey: "key-b", cwd: "/path/2" });
  assert.deepEqual(events, [
    "prewarm:lease-1",
    "release:lease-1",
    "prewarm:lease-2",
    "release:lease-2",
    "prewarm:lease-3",
  ]);
});

test("releaseWorkspaceLease releases active lease and sets active lease to null", async () => {
  __resetWorkspaceLeaseManagerForTests();
  let releaseCalled = false;
  const prewarmFn = async () => {
    return async () => {
      releaseCalled = true;
    };
  };

  await acquireWorkspaceLease({ apiKey: "key-1", cwd: "/path/a", prewarmFn });
  assert.deepEqual(getActiveWorkspaceLease(), { apiKey: "key-1", cwd: "/path/a" });

  await releaseWorkspaceLease();
  assert.equal(releaseCalled, true, "lease release callback should be called");
  assert.equal(getActiveWorkspaceLease(), null, "active lease should be null after release");

  // Subsequent release should be safe (no-op)
  await releaseWorkspaceLease();
  assert.equal(getActiveWorkspaceLease(), null);
});

test("acquireWorkspaceLease handles prewarm error with soft fallback without throwing", async () => {
  __resetWorkspaceLeaseManagerForTests();
  const prewarmFn = async () => {
    throw new Error("SDK prewarm error");
  };

  await assert.doesNotReject(async () => {
    await acquireWorkspaceLease({ apiKey: "key-1", cwd: "/path/a", prewarmFn });
  }, "acquireWorkspaceLease should not reject on prewarm failure");

  assert.equal(getActiveWorkspaceLease(), null, "active lease should be null when prewarm fails");
});

test("acquireWorkspaceLease deduplicates concurrent calls for same key and cwd", async () => {
  __resetWorkspaceLeaseManagerForTests();
  let prewarmCount = 0;
  let resolvePrewarm!: (fn: () => Promise<void>) => void;
  const prewarmPromise = new Promise<() => Promise<void>>((r) => {
    resolvePrewarm = r;
  });

  const prewarmFn = async () => {
    prewarmCount++;
    return prewarmPromise;
  };

  const p1 = acquireWorkspaceLease({ apiKey: "key-1", cwd: "/path/a", prewarmFn });
  const p2 = acquireWorkspaceLease({ apiKey: "key-1", cwd: "/path/a", prewarmFn });

  resolvePrewarm(async () => {});
  await Promise.all([p1, p2]);

  assert.equal(prewarmCount, 1, "concurrent acquire calls should share the same prewarm promise");
  assert.deepEqual(getActiveWorkspaceLease(), { apiKey: "key-1", cwd: "/path/a" });
});

test("runCursorTurn acquires workspace lease before agent creation", async () => {
  setKnownModelIds(["default"]);
  const stream = fakeStream();
  const calls: string[] = [];
  let capturedLeaseOpts: any;

  const acquireLease = async (opts: any) => {
    calls.push("acquireLease");
    capturedLeaseOpts = opts;
  };

  const createAgent = async () => {
    calls.push("createAgent");
    return {
      send: async () => ({
        stream: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "ok" }] },
          };
        },
        cancel: async () => {},
        wait: async () => ({ status: "finished" }),
      }),
      close: () => {},
    };
  };

  runCursorTurn({
    model: { id: "default", api: "cursor-sdk", provider: "cursor" },
    context: { messages: [{ role: "user", content: "hi" }] },
    apiKey: "test-turn-key",
    deps: {
      createStream: () => stream,
      calculateCost: () => {},
      createAgent,
      acquireLease,
    },
  });
  await stream.closed;

  assert.deepEqual(calls, ["acquireLease", "createAgent"]);
  assert.equal(capturedLeaseOpts.apiKey, "test-turn-key");
  assert.equal(capturedLeaseOpts.cwd, process.cwd());
});
