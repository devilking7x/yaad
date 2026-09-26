const API = import.meta.env.VITE_API_URL ?? "";
const TOKEN = import.meta.env.VITE_API_TOKEN ?? "";

function authHeaders(): Record<string, string> {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

export interface Memory {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
}

export interface Skill {
  name: string;
  description: string;
  when: string;
}

export interface ChatTurn {
  reply: string;
  model: string;
  steps: number;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  costUsd: number | null;
}

export type StreamEvent =
  | { type: "token"; token: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string }
  | { type: "done"; reply: string; model: string; steps: number; usage: ChatTurn["usage"]; costUsd: number | null }
  | { type: "error"; error: string };

/** Streaming chat over SSE (POST). Calls onEvent for token/tool/done/error. */
export async function chatStream(
  message: string,
  history: Array<{ role: string; content: string }>,
  onEvent: (e: StreamEvent) => void,
  image?: string
): Promise<void> {
  const res = await fetch(`${API}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ message, history, ...(image ? { image } : {}) }),
  });
  if (!res.ok || !res.body) {
    throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const dispatch = () => {
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const eventMatch = part.match(/^event:\s*(.+)$/m);
      const dataMatch = part.match(/^data:\s*([\s\S]+)$/m);
      if (!eventMatch || !dataMatch) continue;
      const type = eventMatch[1].trim();
      let data: any;
      try {
        data = JSON.parse(dataMatch[1]);
      } catch {
        continue;
      }
      if (type === "token") onEvent({ type: "token", token: data.token ?? "" });
      else if (type === "thinking") onEvent({ type: "thinking", text: data.text ?? "" });
      else if (type === "tool") onEvent({ type: "tool", name: data.name ?? "" });
      else if (type === "done")
        onEvent({
          type: "done",
          reply: data.reply ?? "",
          model: data.model ?? "",
          steps: data.steps ?? 0,
          usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          costUsd: data.costUsd ?? null,
        });
      else if (type === "error") onEvent({ type: "error", error: data.error ?? "Stream error" });
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      buf += decoder.decode(value, { stream: true });
      dispatch();
    }
    if (done) break;
  }
  buf += decoder.decode();
  dispatch();
}

export interface Reminder {
  id: string;
  text: string;
  remindAt: string;
  createdAt: string;
  done: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSessionFull extends ChatSession {
  messages: Array<{ role: string; content: string }>;
}

export const api = {
  health: () => req("/api/health"),
  chat: (message: string, history: Array<{ role: string; content: string }>): Promise<ChatTurn> =>
    req("/api/chat", { method: "POST", body: JSON.stringify({ message, history }) }),
  memories: (): Promise<Memory[]> => req("/api/memories"),
  deleteMemory: (id: string) => req(`/api/memories/${id}`, { method: "DELETE" }),
  skills: (): Promise<Skill[]> => req("/api/skills"),
  installSkill: (name: string, url: string) =>
    req("/api/skills/install", { method: "POST", body: JSON.stringify({ name, url }) }),
  reminders: {
    list: (): Promise<Reminder[]> => req("/api/reminders"),
    done: (id: string) => req(`/api/reminders/${id}/done`, { method: "POST" }),
    remove: (id: string) => req(`/api/reminders/${id}`, { method: "DELETE" }),
  },
  sessions: {
    list: (): Promise<ChatSession[]> => req("/api/sessions"),
    create: (title: string, messages: Array<{ role: string; content: string }>): Promise<ChatSession> =>
      req("/api/sessions", { method: "POST", body: JSON.stringify({ title, messages }) }),
    get: (id: string): Promise<ChatSessionFull> => req(`/api/sessions/${id}`),
    append: (id: string, messages: Array<{ role: string; content: string }>) =>
      req(`/api/sessions/${id}/messages`, { method: "POST", body: JSON.stringify({ messages }) }),
    remove: (id: string) => req(`/api/sessions/${id}`, { method: "DELETE" }),
  },
};
