import { config } from "./config.js";

// Minimal OpenAI-compatible client for Nebius Token Factory.
// Docs: https://docs.tokenfactory.nebius.com — base URL https://api.tokenfactory.nebius.com/v1

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatResult {
  message: ChatMessage;
  model: string;
  usage?: Usage;
}

const MAX_RETRIES = 4;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.nebiusApiKey}`,
  };
}

async function postJson(path: string, body: unknown, attempt = 0): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${config.nebiusBaseUrl}${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    // Network error / timeout — retry with backoff like a 5xx.
    if (attempt < MAX_RETRIES - 1) {
      await sleep(1000 * 2 ** attempt);
      return postJson(path, body, attempt + 1);
    }
    throw new Error(`Token Factory unreachable: ${(e as Error).message}`.slice(0, 300));
  }
  if (res.ok) return res;
  if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES - 1) {
    await sleep(1000 * 2 ** attempt);
    return postJson(path, body, attempt + 1);
  }
  throw new Error(`Token Factory ${res.status}: ${(await res.text()).slice(0, 500)}`);
}

export async function chatComplete(opts: {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  temperature?: number;
  maxTokens?: number;
}): Promise<ChatResult> {
  const res = await postJson("/chat/completions", {
    model: opts.model,
    messages: opts.messages,
    ...(opts.tools ? { tools: opts.tools } : {}),
    temperature: opts.temperature ?? 0.7,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  });
  const data = (await res.json()) as {
    choices: Array<{ message: ChatMessage }>;
    model: string;
    usage?: Usage;
  };
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error("Token Factory returned no choices");
  return { message, model: data.model ?? opts.model, usage: data.usage };
}

// --- Streaming ---------------------------------------------------------------

export interface StreamChunk {
  /** Text delta (may be empty). */
  delta: string;
  /** Reasoning delta (Nemotron reasoning models), may be empty. */
  thinking?: string;
  /** Final assembled message, present exactly once at the end. */
  message?: ChatMessage;
  usage?: Usage;
  model: string;
}

interface AccToolCall {
  id: string;
  name: string;
  args: string;
}

/** Streaming chat completions. Yields text deltas live, then the full message. */
export async function* chatStream(opts: {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  temperature?: number;
  maxTokens?: number;
}): AsyncGenerator<StreamChunk> {
  const res = await postJson("/chat/completions", {
    model: opts.model,
    messages: opts.messages,
    ...(opts.tools ? { tools: opts.tools } : {}),
    temperature: opts.temperature ?? 0.7,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    stream: true,
    stream_options: { include_usage: true },
  });

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  let thinking = "";
  let model = opts.model;
  let usage: Usage | undefined;
  const acc = new Map<number, AccToolCall>();

  const flush = (): StreamChunk[] => {
    const out: StreamChunk[] = [];
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.model) model = json.model;
      if (json.usage) usage = json.usage;
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content) {
        content += delta.content;
        out.push({ delta: delta.content, model });
      }
      // Reasoning trace (Nemotron reasoning-class models). Shown in the UI's "thinking" block.
      if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
        thinking += delta.reasoning_content;
        out.push({ delta: "", thinking: delta.reasoning_content, model });
      }
      for (const tc of delta.tool_calls ?? []) {
        const i: number = tc.index ?? 0;
        const cur = acc.get(i) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        acc.set(i, cur);
      }
    }
    return out;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buf += decoder.decode(value, { stream: true });
      for (const c of flush()) yield c;
    }
    if (done) break;
  }
  buf += decoder.decode();
  for (const c of flush()) yield c;

  const toolCalls: ToolCall[] = [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => ({
      id: t.id,
      type: "function" as const,
      function: { name: t.name, arguments: t.args },
    }))
    .filter((t) => t.function.name);

  yield {
    delta: "",
    message: {
      role: "assistant",
      content,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
    usage,
    model,
  };
}

// --- Embeddings (semantic memory) ---------------------------------------------

export async function embed(texts: string[]): Promise<number[][]> {
  if (!config.embeddingModel) throw new Error("NEBIUS_EMBEDDING_MODEL is not set");
  const res = await postJson("/embeddings", { model: config.embeddingModel, input: texts });
  const data = (await res.json()) as {
    data: Array<{ index: number; embedding: number[] }>;
  };
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/** Proxy helper: list models available to this key (used by /api/models). */
export async function listModels(): Promise<unknown> {
  const res = await fetch(`${config.nebiusBaseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.nebiusApiKey}` },
  });
  if (!res.ok) throw new Error(`Token Factory ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
