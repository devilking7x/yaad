import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

// Chat sessions: every conversation is saved, listed, and reloadable.
// This is what makes Yaad feel like a real product, not a demo.

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
}

function dir(): string {
  const d = path.join(config.memoryDir, "sessions");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Session ids come from the URL — never let them escape the sessions dir. */
function safeId(id: string): string {
  if (!/^ses_[a-z0-9]{4,16}_[a-z0-9]{2,8}$/.test(id)) throw new Error("Invalid session id");
  return id;
}

const uid = (): string =>
  `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

function read(id: string): ChatSession | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir(), `${safeId(id)}.json`), "utf-8")) as ChatSession;
  } catch {
    return undefined;
  }
}

function write(s: ChatSession): void {
  fs.writeFileSync(path.join(dir(), `${s.id}.json`), JSON.stringify(s, null, 2), "utf-8");
}

export function createSession(title: string, messages: SessionMessage[]): ChatSession {
  const s: ChatSession = {
    id: uid(),
    title: title.slice(0, 60) || "New chat",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages,
  };
  write(s);
  return s;
}

export function listSessions(): Omit<ChatSession, "messages">[] {
  return fs
    .readdirSync(dir())
    .filter((f) => f.endsWith(".json"))
    .map((f) => read(path.basename(f, ".json")))
    .filter((s): s is ChatSession => !!s)
    .map(({ messages, ...rest }) => rest)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getSession(id: string): ChatSession | undefined {
  return read(id);
}

export function appendSessionMessages(id: string, messages: SessionMessage[]): ChatSession | undefined {
  const s = read(id);
  if (!s) return undefined;
  s.messages.push(...messages);
  // M6 fix: stored history must not grow unbounded (one long chat = ever-growing
  // JSON file + prompt payloads bloated with stale context). Keep the last 200;
  // long-term memory (memory.ts) is where durable facts live.
  if (s.messages.length > 200) s.messages = s.messages.slice(-200);
  s.updatedAt = new Date().toISOString();
  write(s);
  return s;
}

export function deleteSession(id: string): boolean {
  try {
    fs.unlinkSync(path.join(dir(), `${safeId(id)}.json`));
    return true;
  } catch {
    return false;
  }
}
