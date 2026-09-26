import { atomicWriteFile } from "./fsutil.js";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { createMutex } from "./mutex.js";
import { embed } from "./nebius.js";

// Local persistent memory store (JSON file).
// Interface mirrors the agent-memory-notes MCP server tools:
// memory_add / list / search / get / update / delete / export
//
// 2026-grade retrieval: multi-signal hybrid (dense embeddings + keyword +
// entity match) fused with Reciprocal Rank Fusion (k=60) — the current
// consensus best practice. Bi-temporal versioning (validFrom/validTo):
// outdated facts are *superseded*, never silently overwritten, so "main ab
// Delhi me hun" retires the old "Mumbai" memory instead of contradicting it.

export interface Memory {
  id: string;
  text: string;
  tags: string[];
  entities: string[]; // extracted entity names, lowercase ("priya", "mumbai")
  createdAt: string;
  updatedAt: string;
  validFrom: string; // bi-temporal: when this fact became true
  validTo: string | null; // null = currently valid; set when superseded
  supersededBy?: string; // id of the memory that replaced this one
  embedding?: number[];
}

function storePath(): string {
  fs.mkdirSync(config.memoryDir, { recursive: true });
  return path.join(config.memoryDir, "memories.json");
}

function load(): Memory[] {
  try {
    const arr = JSON.parse(fs.readFileSync(storePath(), "utf-8")) as Memory[];
    // Normalize pre-temporal entries.
    for (const m of arr) {
      if (!m.validFrom) m.validFrom = m.createdAt;
      if (m.validTo === undefined) m.validTo = null;
      if (!m.entities) m.entities = [];
    }
    return arr;
  } catch {
    return [];
  }
}

/** Only currently-valid memories (not superseded). */
export function currentMems(): Memory[] {
  return load().filter((m) => m.validTo === null);
}

function save(mems: Memory[]): void {
  atomicWriteFile(storePath(), JSON.stringify(mems, null, 2), "utf-8");
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

const withLock = createMutex();

/** Coerce unknown input into a clean string array — brain imports and tool
 *  args are attacker-influenced, and a non-array `tags` would crash search
 *  (`.join` on a string). Defense in depth at the write path. */
function cleanStrArr(v: unknown, max = 10): string[] {
  const arr = Array.isArray(v) ? v : [];
  return arr
    .map((x) => String(x ?? "").toLowerCase().trim())
    .filter(Boolean)
    .slice(0, max);
}

// Deterministic fallback: the extractor model sometimes returns no entities
// (empty array), which leaves the knowledge graph permanently empty. Proper
// nouns in the fact text are a reliable signal — people, places, orgs, pets.
const ENTITY_STOPWORDS = new Set([
  "user", "users", "assistant", "the", "a", "an", "this", "that",
]);
function heuristicEntities(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b([A-Z][a-zA-Z]{2,})\b/g)) {
    const w = m[1].toLowerCase();
    if (!ENTITY_STOPWORDS.has(w) && !out.includes(w)) out.push(w);
    if (out.length >= 6) break;
  }
  return out;
}

export async function memoryAdd(text: string, tags: string[] = [], entities: string[] = []): Promise<Memory> {
  return withLock(async () => {
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
    const now = new Date().toISOString();
    const mem: Memory = {
      id: uid(),
      text: String(text).slice(0, 2000),
      tags: cleanStrArr(tags, 8),
      // Fallback: never store a memory with zero entities when the text
      // names proper nouns — the knowledge graph depends on entities.
      entities: (() => {
        const e = cleanStrArr(entities, 10);
        return e.length ? e : heuristicEntities(String(text));
      })(),
      createdAt: now,
      updatedAt: now,
      validFrom: now,
      validTo: null,
      ...(embedding ? { embedding } : {}),
    };
    mems.push(mem);
    // M7 fix: memories.json must not grow unbounded. Cap at 5000; evict the
    // oldest SUPERSEDED memories first (bi-temporal history that's already
    // retired), only then the oldest valid ones. Historical recall across
    // 5000 memories is more than enough for a personal AI.
    const MAX_MEMORIES = 5000;
    if (mems.length > MAX_MEMORIES) {
      const over = mems.length - MAX_MEMORIES;
      const idxOldestFirst = mems
        .map((m, i) => ({ i, dead: m.validTo !== null && m.validTo !== undefined }))
        .sort((a, b) => Number(b.dead) - Number(a.dead) || mems[a.i].createdAt.localeCompare(mems[b.i].createdAt));
      const drop = new Set(idxOldestFirst.slice(0, over).map((x) => x.i));
      const kept = mems.filter((_, i) => !drop.has(i));
      mems.length = 0;
      mems.push(...kept);
    }
    save(mems);
    return mem;
  });
}

/**
 * Retire an outdated memory without deleting it: it stays in history with
 * validTo set, so "what did I believe in June?" remains answerable.
 */
export function memorySupersede(oldId: string, newId: string): boolean {
  const mems = load();
  const old = mems.find((m) => m.id === oldId);
  if (!old || old.validTo !== null) return false;
  old.validTo = new Date().toISOString();
  old.supersededBy = newId;
  old.updatedAt = old.validTo;
  save(mems);
  return true;
}

export function memoryList(): Memory[] {
  return load().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function memoryGet(id: string): Memory | undefined {
  return load().find((m) => m.id === id);
}

export async function memoryUpdate(id: string, text: string, tags?: string[]): Promise<Memory | undefined> {
  return withLock(async () => {
    const mems = load();
    const mem = mems.find((m) => m.id === id);
    if (!mem) return undefined;
    mem.text = String(text).slice(0, 2000);
    if (tags) mem.tags = cleanStrArr(tags, 8);
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
  });
}

export function memoryDelete(id: string): boolean {
  const mems = load();
  const next = mems.filter((m) => m.id !== id);
  if (next.length === mems.length) return false;
  save(next);
  return true;
}

/** Reciprocal Rank Fusion — the standard way to fuse retrieval signals. */
function rrf(rank: number, k = 60): number {
  return 1 / (k + rank);
}

function keywordRanked(pool: Memory[], query: string): Memory[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return pool
    .map((m) => {
      const hay = `${m.text} ${m.tags.join(" ")} ${m.entities.join(" ")}`.toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += t.length > 4 ? 2 : 1;
      return { m, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.m);
}

/**
 * Hybrid recall: three signals (semantic cosine, keyword, entity match)
 * fused with Reciprocal Rank Fusion. Defaults to currently-valid memories;
 * pass includeHistorical to also search superseded ones.
 */
export async function memorySearch(
  query: string,
  limit = 5,
  opts: { includeHistorical?: boolean } = {}
): Promise<Memory[]> {
  const pool = opts.includeHistorical ? load() : currentMems();
  if (!pool.length || !query.trim()) return [];

  // Signal 1: semantic (ranked by cosine — RRF handles the weighting)
  let semRanked: Memory[] = [];
  try {
    if (config.nebiusApiKey && config.embeddingModel) {
      const [q] = await embed([query]);
      semRanked = pool
        .filter((m) => m.embedding && m.embedding.length)
        .map((m) => ({ m, s: cosine(q, m.embedding!) }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.m);
    }
  } catch {
    /* fall through to keyword */
  }

  // Signal 2: keyword
  const kwRanked = keywordRanked(pool, query);

  // Signal 3: entity match — memories about entities named in the query
  const ql = query.toLowerCase();
  const entRanked = pool.filter((m) => m.entities.some((e) => e && ql.includes(e)));

  const scores = new Map<string, number>();
  for (const ranked of [semRanked, kwRanked, entRanked]) {
    ranked.forEach((m, i) => scores.set(m.id, (scores.get(m.id) ?? 0) + rrf(i)));
  }
  const byId = new Map(pool.map((m) => [m.id, m]));
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => byId.get(id)!);
}

export function memoryExport(): Memory[] {
  return load();
}
