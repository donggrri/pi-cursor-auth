import { Agent, Cursor } from "@cursor/sdk";

export const CURSOR_PROVIDER_ID = "cursor";
export const CURSOR_API_KEY_PLACEHOLDER = "pi-cursor-auth-placeholder";

// Model id aliases -> real Cursor model ids.
const MODEL_ALIASES: Record<string, string> = {
  "auto-smart": "default",
  auto: "default",
};

// Known model ids registered with pi (discovered live + fallback). Used to map
// unknown requested ids (e.g. the user's saved "auto-smart") to a valid one.
const knownModelIds = new Set<string>(["default"]);

export function setKnownModelIds(ids: string[]): void {
  knownModelIds.clear();
  for (const id of ids) knownModelIds.add(id);
  knownModelIds.add("default");
}

function resolveModelId(requested: string): string {
  if (MODEL_ALIASES[requested]) return MODEL_ALIASES[requested];
  return knownModelIds.has(requested) ? requested : "default";
}

// ---------------------------------------------------------------------------
// Key resolution
// ---------------------------------------------------------------------------

export function resolveCursorApiKey(
  raw: string | undefined,
  opts: { env?: string | undefined; stored?: string | undefined } = {},
): string | undefined {
  if (raw && raw !== CURSOR_API_KEY_PLACEHOLDER) return raw.trim() || undefined;
  const envKey = opts.env?.trim();
  if (envKey) return envKey;
  return opts.stored?.trim() || undefined;
}

// ---------------------------------------------------------------------------
// Prompt extraction
// ---------------------------------------------------------------------------

export function extractUserPrompt(context: any): {
  text: string;
  images?: any[];
} {
  const messages: any[] = context?.messages ?? [];
  let lastUser: any = null;
  for (const m of messages) if (m?.role === "user") lastUser = m;
  if (!lastUser) return { text: "" };

  const content = lastUser.content;
  if (typeof content === "string") return { text: content };

  const textParts: string[] = [];
  const images: any[] = [];
  for (const block of content ?? []) {
    if (block?.type === "text") textParts.push(block.text ?? "");
    else if (block?.type === "image") {
      images.push({ data: block.data, mimeType: block.mimeType });
    }
  }
  return {
    text: textParts.join("\n"),
    images: images.length ? images : undefined,
  };
}

// ---------------------------------------------------------------------------
// Model discovery
// ---------------------------------------------------------------------------

function toPiModel(m: any): any {
  return {
    id: m.id,
    name: m.displayName || m.id,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 64000,
  };
}

// Curated fallback so /model shows something even before a key is configured.
const FALLBACK_MODELS: any[] = [
  toPiModel({ id: "default", displayName: "Cursor Default" }),
  toPiModel({ id: "claude-opus-5", displayName: "Claude Opus 5" }),
  toPiModel({ id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" }),
  toPiModel({ id: "grok-4.6", displayName: "Grok 4.6" }),
  toPiModel({ id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" }),
];

export function fallbackModels(): any[] {
  return FALLBACK_MODELS;
}

export async function discoverCursorModels(
  apiKey: string | undefined,
): Promise<any[]> {
  if (!apiKey) return [];
  try {
    const models = await Cursor.models.list({ apiKey });
    return (models ?? []).map(toPiModel);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Agent pool (session-scoped reuse for multi-turn continuity)
// ---------------------------------------------------------------------------

interface PooledAgent {
  agent: any;
  modelId: string;
  apiKey: string;
}

const agentPool = new Map<string, PooledAgent>();

async function getOrCreateAgent(
  sessionKey: string,
  modelId: string,
  apiKey: string,
  cwd: string,
): Promise<any> {
  const existing = agentPool.get(sessionKey);
  if (existing && existing.modelId === modelId && existing.apiKey === apiKey) {
    return existing.agent;
  }
  const agent = await Agent.create({
    model: { id: modelId },
    apiKey,
    local: { cwd },
  });
  agentPool.set(sessionKey, { agent, modelId, apiKey });
  return agent;
}

export function dropAgent(sessionKey: string): void {
  const pooled = agentPool.get(sessionKey);
  if (pooled) {
    try {
      pooled.agent.close?.();
    } catch {
      /* ignore */
    }
    agentPool.delete(sessionKey);
  }
}

// ---------------------------------------------------------------------------
// Streaming run
// ---------------------------------------------------------------------------

interface TurnDeps {
  createStream: () => any;
  calculateCost: (model: any, usage: any) => void;
}

function makeInitialMessage(model: any): any {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

function applyUsage(
  output: any,
  tokenUsage: any,
  model: any,
  calculateCost: any,
): void {
  if (!tokenUsage) return;
  output.usage.input = tokenUsage.inputTokens ?? 0;
  output.usage.output = tokenUsage.outputTokens ?? 0;
  output.usage.cacheRead = tokenUsage.cacheReadTokens ?? 0;
  output.usage.cacheWrite = tokenUsage.cacheWriteTokens ?? 0;
  output.usage.totalTokens =
    tokenUsage.totalTokens ??
    output.usage.input +
      output.usage.output +
      output.usage.cacheRead +
      output.usage.cacheWrite;
  try {
    calculateCost(model, output.usage);
  } catch {
    /* ignore cost calc errors */
  }
}

// Cursor's SDK emits the assistant message once per token/word (each with a
// single text block), and thinking similarly. Opening a new pi block per chunk
// makes pi render each word on its own line, so we accumulate into one block and
// only emit _start once and _end after the stream completes.
function makeBlockAppenders(output: any, stream: any) {
  let openTextIdx = -1;
  let openText = "";
  let openThinkIdx = -1;
  let openThink = "";

  const closeThinking = () => {
    if (openThinkIdx === -1) return;
    stream.push({
      type: "thinking_end",
      contentIndex: openThinkIdx,
      content: openThink,
      partial: output,
    });
    openThinkIdx = -1;
  };
  const closeText = () => {
    if (openTextIdx === -1) return;
    stream.push({
      type: "text_end",
      contentIndex: openTextIdx,
      content: openText,
      partial: output,
    });
    openTextIdx = -1;
  };

  const appendThinking = (chunk: string) => {
    if (!chunk) return;
    if (openThinkIdx === -1) {
      output.content.push({ type: "thinking", thinking: "" });
      openThinkIdx = output.content.length - 1;
      stream.push({
        type: "thinking_start",
        contentIndex: openThinkIdx,
        partial: output,
      });
    }
    openThink += chunk;
    output.content[openThinkIdx].thinking = openThink;
    stream.push({
      type: "thinking_delta",
      contentIndex: openThinkIdx,
      delta: chunk,
      partial: output,
    });
  };

  const appendText = (text: string) => {
    if (!text) return;
    if (openThinkIdx !== -1) closeThinking();
    if (openTextIdx === -1) {
      output.content.push({ type: "text", text: "" });
      openTextIdx = output.content.length - 1;
      stream.push({
        type: "text_start",
        contentIndex: openTextIdx,
        partial: output,
      });
    }
    openText += text;
    output.content[openTextIdx].text = openText;
    stream.push({
      type: "text_delta",
      contentIndex: openTextIdx,
      delta: text,
      partial: output,
    });
  };

  return { appendThinking, appendText, closeThinking, closeText };
}

export function runCursorTurn(opts: {
  model: any;
  context: any;
  options?: any;
  apiKey: string | undefined;
  sessionKey?: string;
  deps: TurnDeps;
}): any {
  const { model, context, options, apiKey, sessionKey = "anon", deps } = opts;
  const stream = deps.createStream();

  (async () => {
    const output = makeInitialMessage(model);
    const blocks = makeBlockAppenders(output, stream);
    stream.push({ type: "start", partial: output });

    if (!apiKey) {
      output.stopReason = "error";
      output.errorMessage =
        "No Cursor API key. Set CURSOR_API_KEY, run /login, or use /cursor-auth.";
      stream.push({ type: "error", reason: "error", error: output });
      stream.end(output);
      return;
    }

    const modelId = resolveModelId(model.id);
    try {
      const agent = await getOrCreateAgent(
        sessionKey,
        modelId,
        apiKey,
        process.cwd(),
      );
      const { text, images } = extractUserPrompt(context);
      const userMessage = images?.length ? { text, images } : text;

      const run = await agent.send(userMessage, {});
      for await (const msg of run.stream()) {
        if (msg?.type === "thinking") {
          blocks.appendThinking(msg.text);
        } else if (msg?.type === "assistant") {
          for (const block of msg.message?.content ?? []) {
            if (block?.type === "text") blocks.appendText(block.text);
            // Cursor executes its own tools; do not re-expose tool_use to pi.
          }
        } else if (msg?.type === "usage") {
          applyUsage(output, msg.usage, model, deps.calculateCost);
        }
      }
      blocks.closeThinking();
      blocks.closeText();

      const result = await run.wait();
      if (result?.usage)
        applyUsage(output, result.usage, model, deps.calculateCost);

      if (result?.status === "finished") {
        output.stopReason = "stop";
        stream.push({ type: "done", reason: "stop", message: output });
      } else if (result?.status === "cancelled") {
        output.stopReason = "aborted";
        output.errorMessage = result.error?.message || "Cursor run cancelled";
        stream.push({ type: "error", reason: "aborted", error: output });
      } else {
        output.stopReason = "error";
        output.errorMessage = result?.error?.message || "Cursor run failed";
        stream.push({ type: "error", reason: "error", error: output });
      }
    } catch (err) {
      dropAgent(sessionKey);
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = err instanceof Error ? err.message : String(err);
      stream.push({ type: "error", reason: output.stopReason, error: output });
    } finally {
      stream.end(output);
    }
  })();

  return stream;
}
