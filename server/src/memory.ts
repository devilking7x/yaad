import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

// Local persistent memory store (JSON file).
// Interface mirrors the agent-memory-notes MCP server tools:
// memory_add / list / search / get / update / delete / export

export interface Memory {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

function storePath(): string {
  fs.mkdirSync(config.memoryDir, { recursive: true });
  return path.join(config.memoryDir, "memories.json");
}

function load(): Memory[] {
  try {
    return JSON.parse(fs.readFileSync(storePath(), "utf-8")) as Memory[];
  } catch {
    return [];
  }
}

function save(mems: Memory[]): void {
  fs.writeFileSync(storePath(), JSON.stringify(mems, null, 2), "utf-8");
}

function uid(): string {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function memoryAdd(text: string, tags: string[] = []): Memory {
  const mems = load();
  const mem: Memory = {
    id: uid(),
    text,
    tags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  mems.push(mem);
  save(mems);
  return mem;
}

export function memoryList(): Memory[] {
  return load().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function memoryGet(id: string): Memory | undefined {
  return load().find((m) => m.id === id);
}

export function memoryUpdate(id: string, text: string, tags?: string[]): Memory | undefined {
  const mems = load();
  const mem = mems.find((m) => m.id === id);
  if (!mem) return undefined;
  mem.text = text;
  if (tags) mem.tags = tags;
  mem.updatedAt = new Date().toISOString();
  save(mems);
  return mem;
}

export function memoryDelete(id: string): boolean {
  const mems = load();
  const next = mems.filter((m) => m.id !== id);
  if (next.length === mems.length) return false;
  save(mems);
  return true;
}

/** Keyword-ranked recall. v0: lexical; upgrade path = embeddings via Nebius /v1/embeddings. */
export function memorySearch(query: string, limit = 5): Memory[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = load().map((m) => {
    const hay = `${m.text} ${m.tags.join(" ")}`.toLowerCase();
    let score = 0;
    for (const t of terms) if (hay.includes(t)) score += t.length > 4 ? 2 : 1;
    return { m, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.m);
}

export function memoryExport(): Memory[] {
  return load();
}
