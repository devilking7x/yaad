const API = import.meta.env.VITE_API_URL ?? "";

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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
}

export const api = {
  health: () => req("/api/health"),
  chat: (message: string, history: Array<{ role: string; content: string }>): Promise<ChatTurn> =>
    req("/api/chat", { method: "POST", body: JSON.stringify({ message, history }) }),
  memories: (): Promise<Memory[]> => req("/api/memories"),
  deleteMemory: (id: string) => req(`/api/memories/${id}`, { method: "DELETE" }),
  skills: (): Promise<Skill[]> => req("/api/skills"),
};
