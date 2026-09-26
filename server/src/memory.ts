import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { embed } from "./nebius.js";

// Local persistent memory store (JSON file).
// Interface mirrors the agent-memory-notes MCP server tools:
// memory_add / list / search / get / update / delete / export
//
// Search is semantic when embeddings are available (Nebius /v1/embeddings),
// with keyword fallback — so it works with or without an API key.

export interface Memory {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  embedding?: number[];
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

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export async function memoryAdd(text: string, tags: string[] = []): Promise<Memory> {
  let embedding: number[] | undefined;
  try {
    if (config.nebiusApiKey && config.embeddingModel) {
      const [vec] = await embed([text]);
      embedding = vec;
    }
  } catch {
    /* store without embedding; keyword search still works */
  }
  const mems = load();
  const mem: Memory = {
    id: uid(),
    text,
    tags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(embedding ? { embedding } : {}),
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

export async function memoryUpdate(id: string, text: string, tags?: string[]): Promise<Memory | undefined> {
  const mems = load();
  const mem = mems.find((m) => m.id === id);
  if (!mem) return undefined;
  mem.text = text;
  if (tags) mem.tags = tags;
  mem.updatedAt = new Date().toISOString();
  try {
    if (config.nebiusApiKey && config.embeddingModel) {
      const [vec] = await embed([text]);
      mem.embedding = vec;
    }
  } catch {
    /* keep old embedding */
  }
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

function keywordSearch(mems: Memory[], query: string, limit: number, exclude: Set<string>): Memory[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return mems
    .filter((m) => !exclude.has(m.id))
    .map((m) => {
      const hay = `${m.text} ${m.tags.join(" ")}`.toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += t.length > 4 ? 2 : 1;
      return { m, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.m);
}

/**
 * Hybrid recall: semantic (cosine over embeddings) first, then keyword
 * matches to fill up. Works fully offline when no embedding model is set.
 */
export async function memorySearch(query: string, limit = 5): Promise<Memory[]> {
  const mems = load();
  const picked: Memory[] = [];
  const seen = new Set<string>();

  try {
    if (config.nebiusApiKey && config.embeddingModel && query.trim()) {
      const [q] = await embed([query]);
      const ranked = mems
        .filter((m) => m.embedding && m.embedding.length)
        .map((m) => ({ m, s: cosine(q, m.embedding!) }))
        .filter((x) => x.s > 0.2)
        .sort((a, b) => b.s - a.s);
      for (const r of ranked.slice(0, limit)) {
        picked.push(r.m);
        seen.add(r.m.id);
      }
    }
  } catch {
    /* fall through to keyword */
  }

  if (picked.length < limit) {
    picked.push(...keywordSearch(mems, query, limit - picked.length, seen));
  }
  return picked.slice(0, limit);
}

export function memoryExport(): Memory[] {
  return load();
}
