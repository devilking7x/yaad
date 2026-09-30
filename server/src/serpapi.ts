import { config } from "./config.js";
import { webSearch as tavilyWebSearch, type SearchHit } from "./tavily.js";

// SerpApi web-search backend for Yaad's `web_search` agent tool.
// Built for the SerpApi India Hackathon 2026 (serpapi.com) — "meaningful
// SerpApi usage": Yaad's live web-search layer runs on SerpApi when a key is
// configured, otherwise the existing Tavily behavior is used unchanged.
//
// Auth: SERPAPI_API_KEY (private key from your serpapi.com dashboard — never
// commit it, never paste it in chat). Sent as the `api_key` query parameter
// on GET https://serpapi.com/search.json per SerpApi's public docs.
// Response shape used: organic_results[].title / .link / .snippet.
//
// Mock mode: SERPAPI_MOCK=1 returns 3 canned results clearly labeled [MOCK]
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

export function serpapiMockOn(): boolean {
  return config.serpapiMock;
}

/** True when a real SerpApi key is configured (mock mode excluded). */
export function serpapiConfigured(): boolean {
  return !config.serpapiMock && config.serpapiApiKey.length > 0;
}

/** Which backend the `web_search` tool will use right now. */
export function searchBackendName(): "serpapi" | "serpapi-mock" | "tavily" {
  if (config.serpapiMock) return "serpapi-mock";
  if (config.serpapiApiKey) return "serpapi";
  return "tavily";
}

/**
 * Live SerpApi Google-search call. Returns hits in Tavily's SearchHit shape
 * so the rest of the agent pipeline stays backend-agnostic.
 */
export async function searchSerpApi(query: string, maxResults = 5): Promise<SearchHit[]> {
  if (config.serpapiMock) {
    // Mock path: deterministic canned results, clearly labeled. No network.
    return MOCK_RESULTS.slice(0, maxResults);
  }
  if (!config.serpapiApiKey) throw new Error("SERPAPI_API_KEY is not set");
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    api_key: config.serpapiApiKey,
    num: String(Math.max(1, Math.min(10, maxResults))),
  });
  const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`SerpApi ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    error?: string;
    organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  if (data.error) throw new Error(`SerpApi error: ${data.error}`);
  return (data.organic_results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title ?? "",
    url: r.link ?? "",
    snippet: (r.snippet ?? "").slice(0, 400),
  }));
}

/**
 * Backend dispatcher for the agent's `web_search` tool.
 * SERPAPI_API_KEY set (or SERPAPI_MOCK=1) -> SerpApi; otherwise the existing
 * Tavily behavior runs exactly as before. Default unchanged: nothing breaks.
 */
export async function webSearch(query: string, maxResults = 5): Promise<SearchHit[]> {
  if (config.serpapiMock || config.serpapiApiKey) return searchSerpApi(query, maxResults);
  return tavilyWebSearch(query, maxResults);
}
