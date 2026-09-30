import { config } from "./config.js";
import { webSearch as tavilyWebSearch, type SearchHit } from "./tavily.js";

// SerpApi web-search backend for Yaad's `web_search` and `news_search` agent tools.
// Built for the SerpApi India Hackathon 2026 (serpapi.com) — "meaningful
// SerpApi usage": Yaad's live web-search layer runs on SerpApi when a key is
// configured, otherwise the existing Tavily behavior is used unchanged.
//
// Auth: SERPAPI_API_KEY (private key from your serpapi.com dashboard — never
// commit it, never paste it in chat). Sent as the `api_key` query parameter
// on GET https://serpapi.com/search.json per SerpApi's public docs.
// Response shapes used: organic_results[].title / .link / .snippet (google
// engine) and news_results[].title / .link / .snippet (google_news engine).
//
// Degradation chain: SerpApi -> Tavily fallback -> clean error. Every step is
// logged server-side, and the agent is told which backend served the request
// (`SearchOutcome.backend`), so it can say so honestly.
//
// Result cache: in-memory TTL cache (5 min) keyed by backend+engine+query,
// so repeated queries don't burn API quota. Cache hits are logged and flagged
// (`SearchOutcome.cached`).
//
// Mock mode: SERPAPI_MOCK=1 returns canned results clearly labeled [MOCK]
// so the wiring can be tested end-to-end without spending a real API call.
// MOCK RESULTS ARE NOT REAL SEARCH RESULTS — never present them as such.

const MOCK_RESULTS: SearchHit[] = [
  {
    title: "[MOCK] SerpApi — Google Search API documentation",
    url: "https://serpapi.com/search-api",
    snippet:
      "[MOCK RESULT — not a real search hit] SerpApi's Google Search API returns JSON " +
      "results including organic_results with title, link and snippet fields. Auth is a " +
      "private api_key query parameter.",
  },
  {
    title: "[MOCK] SerpApi India Hackathon 2026 — official page",
    url: "https://serpapi.github.io/serpapi-india-hackathon-2026/",
    snippet:
      "[MOCK RESULT — not a real search hit] Hackathon page describing tracks, prizes and " +
      "rules for the SerpApi India Hackathon 2026.",
  },
  {
    title: "[MOCK] Yaad — personal AI that remembers (GitHub)",
    url: "https://github.com/devilking7x/yaad",
    snippet:
      "[MOCK RESULT — not a real search hit] Yaad's repository: Express + TypeScript " +
      "server with an agentic chat loop, persistent memory, skills and web search.",
  },
];

const MOCK_NEWS: SearchHit[] = [
  {
    title: "[MOCK] (TechWire) SerpApi launches structured search API for AI agents",
    url: "https://serpapi.com/blog/mock-news-1",
    snippet:
      "[MOCK RESULT — not a real news hit] Fictional headline used to test the " +
      "news_search tool wiring. Real mode returns live Google News results.",
  },
  {
    title: "[MOCK] (DevDaily) Hackathon season: AI search integrations take center stage",
    url: "https://serpapi.com/blog/mock-news-2",
    snippet:
      "[MOCK RESULT — not a real news hit] Fictional headline used to test the " +
      "news_search tool wiring. Real mode returns live Google News results.",
  },
  {
    title: "[MOCK] (AgentPost) Personal AI assistants add live news tools",
    url: "https://serpapi.com/blog/mock-news-3",
    snippet:
      "[MOCK RESULT — not a real news hit] Fictional headline used to test the " +
      "news_search tool wiring. Real mode returns live Google News results.",
  },
];

const QUERY_MAX_LEN = 500;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_ENTRIES = 200;
const REQUEST_TIMEOUT_MS = 60_000;

interface CacheEntry {
  expires: number;
  hits: SearchHit[];
}

const cache = new Map<string, CacheEntry>();

function cacheKey(backend: string, kind: string, query: string, maxResults: number): string {
  return `${backend}:${kind}:${query.trim().toLowerCase()}:${maxResults}`;
}

function cacheGet(key: string): SearchHit[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.hits;
}

function cacheSet(key: string, hits: SearchHit[]): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Evict the oldest-inserted entry (Map preserves insertion order).
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, hits });
}

/** Test/dev helper: clears the in-memory search cache. */
export function clearSearchCache(): void {
  cache.clear();
}

/** Trim + cap query length so overlong/unicode input can't break the request. */
function cleanQuery(query: string): string {
  return query.trim().slice(0, QUERY_MAX_LEN);
}

/** Never let the private key appear in a thrown/logged message. */
function redactKey(text: string): string {
  const key = config.serpapiApiKey;
  return key ? text.split(key).join("[REDACTED]") : text;
}

export function serpapiMockOn(): boolean {
  return config.serpapiMock;
}

/** True when a real SerpApi key is configured (mock mode excluded). */
export function serpapiConfigured(): boolean {
  return !config.serpapiMock && config.serpapiApiKey.length > 0;
}

/** Which backend the `web_search` tool prefers right now (before fallback). */
export function searchBackendName(): "serpapi" | "serpapi-mock" | "tavily" {
  if (config.serpapiMock) return "serpapi-mock";
  if (config.serpapiApiKey) return "serpapi";
  return "tavily";
}

export type SearchBackend = "serpapi" | "serpapi-mock" | "tavily" | "tavily-fallback";

export interface SearchOutcome {
  /** Which backend actually served this request (after any fallback). */
  backend: SearchBackend;
  /** True when the hits came from the in-memory cache (no API call spent). */
  cached: boolean;
  hits: SearchHit[];
}

type SearchKind = "web" | "news";

/**
 * Low-level SerpApi call. Throws sanitized errors (never leaks the key) on
 * auth failures, rate limits, timeouts, network errors and malformed JSON.
 */
async function callSerpApi(kind: SearchKind, query: string, maxResults: number): Promise<SearchHit[]> {
  if (config.serpapiMock) {
    // Mock path: deterministic canned results, clearly labeled. No network.
    return (kind === "news" ? MOCK_NEWS : MOCK_RESULTS).slice(0, maxResults);
  }
  const key = config.serpapiApiKey;
  if (!key) throw new Error("SERPAPI_API_KEY is not set");
  const q = cleanQuery(query);
  if (!q) throw new Error("Search query is empty");
  const params = new URLSearchParams({
    engine: kind === "news" ? "google_news" : "google",
    q,
    api_key: key,
    num: String(Math.max(1, Math.min(10, maxResults))),
  });
  let res: Response;
  try {
    res = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`SerpApi request failed: ${redactKey(e instanceof Error ? e.message : String(e))}`);
  }
  if (!res.ok) {
    throw new Error(`SerpApi ${res.status}: ${redactKey((await res.text()).slice(0, 300))}`);
  }
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error("SerpApi returned malformed JSON");
  }
  if (data?.error) throw new Error(`SerpApi error: ${redactKey(String(data.error)).slice(0, 300)}`);
  const items = kind === "news" ? data.news_results : data.organic_results;
  return (items ?? []).slice(0, maxResults).map((r: any) => ({
    title: String(r.title ?? ""),
    url: String(r.link ?? ""),
    snippet: String(r.snippet ?? "").slice(0, 400),
  }));
}

/**
 * Search with the degradation chain: SerpApi -> Tavily fallback -> clean
 * error. Every step is logged; the outcome tells the agent which backend
 * served the request and whether it was a cache hit.
 */
async function searchWithMeta(kind: SearchKind, query: string, maxResults: number): Promise<SearchOutcome> {
  const q = cleanQuery(query);
  if (!q) throw new Error("Search query is empty");
  const wantSerpApi = config.serpapiMock || config.serpapiApiKey.length > 0;
  const primary: SearchBackend = config.serpapiMock ? "serpapi-mock" : "serpapi";

  if (wantSerpApi) {
    const key = cacheKey(primary, kind, q, maxResults);
    const cached = cacheGet(key);
    if (cached) {
      console.log(`[search] cache HIT kind=${kind} backend=${primary} q=${q.slice(0, 60)}`);
      return { backend: primary, cached: true, hits: cached };
    }
    try {
      const hits = await callSerpApi(kind, q, maxResults);
      cacheSet(key, hits);
      return { backend: primary, cached: false, hits };
    } catch (e) {
      // Degradation: SerpApi failed — fall back to Tavily (general web
      // search for the news kind too; the backend label says so honestly).
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[search] SerpApi (${kind}) failed: ${msg}. Falling back to Tavily.`);
    }
  }

  const fallback: SearchBackend = wantSerpApi ? "tavily-fallback" : "tavily";
  const tkey = cacheKey("tavily", kind, q, maxResults);
  const tcached = cacheGet(tkey);
  if (tcached) {
    console.log(`[search] cache HIT kind=${kind} backend=${fallback} q=${q.slice(0, 60)}`);
    return { backend: fallback, cached: true, hits: tcached };
  }
  try {
    const hits = await tavilyWebSearch(q, maxResults);
    cacheSet(tkey, hits);
    return { backend: fallback, cached: false, hits };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[search] Tavily (${kind}) also failed: ${msg}.`);
    throw new Error(
      wantSerpApi ? `Web search failed on both SerpApi and Tavily: ${msg}` : msg,
    );
  }
}

/**
 * Backend dispatcher for the agent's `web_search` tool.
 * SERPAPI_API_KEY set (or SERPAPI_MOCK=1) -> SerpApi with Tavily fallback;
 * otherwise the existing Tavily behavior runs exactly as before.
 * Default unchanged: nothing breaks.
 */
export async function webSearch(query: string, maxResults = 5): Promise<SearchHit[]> {
  return (await searchWithMeta("web", query, maxResults)).hits;
}

/** `web_search` with backend/cached metadata for the agent. */
export async function webSearchWithMeta(query: string, maxResults = 5): Promise<SearchOutcome> {
  return searchWithMeta("web", query, maxResults);
}

/** News vertical: SerpApi Google News (mock-labeled in mock mode). */
export async function newsSearch(query: string, maxResults = 5): Promise<SearchHit[]> {
  return (await searchWithMeta("news", query, maxResults)).hits;
}

/** `news_search` with backend/cached metadata for the agent. */
export async function newsSearchWithMeta(query: string, maxResults = 5): Promise<SearchOutcome> {
  return searchWithMeta("news", query, maxResults);
}
