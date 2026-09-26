import { config } from "./config.js";

// Minimal OpenAI-compatible chat client for Nebius Token Factory.
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

export interface ChatResult {
  message: ChatMessage;
  model: string;
}

const MAX_RETRIES = 4;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function chatComplete(opts: {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  temperature?: number;
  maxTokens?: number;
}): Promise<ChatResult> {
  const url = `${config.nebiusBaseUrl}/chat/completions`;
  const body = {
    model: opts.model,
    messages: opts.messages,
    ...(opts.tools ? { tools: opts.tools } : {}),
    temperature: opts.temperature ?? 0.7,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.nebiusApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        choices: Array<{ message: ChatMessage }>;
        model: string;
      };
      const message = data.choices?.[0]?.message;
      if (!message) throw new Error("Token Factory returned no choices");
      return { message, model: data.model ?? opts.model };
    }

    // Retry on rate limits and transient server errors
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`Token Factory ${res.status}: ${await res.text().catch(() => "")}`);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw new Error(`Token Factory ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  throw lastErr;
}

/** Proxy helper: list models available to this key (used by /api/models). */
export async function listModels(): Promise<unknown> {
  const res = await fetch(`${config.nebiusBaseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.nebiusApiKey}` },
  });
  if (!res.ok) throw new Error(`Token Factory ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
