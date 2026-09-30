import { config } from "./config.js";

// Qloo Taste Intelligence client for Yaad's `taste_recommend` agent tool.
// Built for the Qloo Agent Hackathon 2026 — "meaningful Qloo API usage":
// Yaad's agent pulls taste-graph recommendations (Qloo's 250M+ entity graph:
// movies, music, dining, fashion, books, podcasts) through Qloo's Insights API.
//
// Auth: QLOO_API_KEY (private key from dashboard.qloo.com — never commit it,
// never paste it in chat). Sent as the `X-Api-Key` request header per Qloo's
// docs/SDK. Base URL: QLOO_API_URL (default https://hackathon.api.qloo.com/v2,
// the hackathon environment; production is https://api.qloo.com/v2).
// Endpoints used:
//   GET  {host}/search?query=...&limit=N   -> entity lookup (host root, no /v2)
//   POST {base}/insights                    -> recommendations
//     body: { "filter.type": "urn:entity:movie",
//             "signal.interests.entities": "id1,id2",
//             "filter.location.query": "Pune",
//             "limit": 8 }
// Response shape used: results.entities[] -> name / entity_id / properties.
//
// Mock mode: QLOO_MOCK=1 returns canned results clearly labeled [MOCK] so the
// wiring can be tested end-to-end without a real API key.
// MOCK RESULTS ARE NOT REAL QLOO DATA — never present them as such.

export interface TasteHit {
  name: string;
  entityId: string;
  category: string;
  description: string;
  popularity: number;
}

const CATEGORY_URNS: Record<string, string> = {
  movie: "urn:entity:movie",
  music: "urn:entity:artist",
  artist: "urn:entity:artist",
  restaurant: "urn:entity:place",
  food: "urn:entity:place",
  place: "urn:entity:place",
  dining: "urn:entity:place",
  fashion: "urn:entity:brand",
  brand: "urn:entity:brand",
  book: "urn:entity:book",
  podcast: "urn:entity:podcast",
};

const MOCK_HITS: TasteHit[] = [
  {
    name: "[MOCK] Dune: Part Two",
    entityId: "mock-entity-1",
    category: "movie",
    description:
      "[MOCK RESULT — not real Qloo data] Epic sci-fi sequel: spice, sandworms and a messiah arc.",
    popularity: 0.98,
  },
  {
    name: "[MOCK] Interstellar",
    entityId: "mock-entity-2",
    category: "movie",
    description:
      "[MOCK RESULT — not real Qloo data] Space-time epic about love, gravity and a dying Earth.",
    popularity: 0.97,
  },
  {
    name: "[MOCK] The Midnight Diner, Pune",
    entityId: "mock-entity-3",
    category: "restaurant",
    description:
      "[MOCK RESULT — not real Qloo data] Cozy late-night spot serving comfort food and filter coffee.",
    popularity: 0.91,
  },
  {
    name: "[MOCK] A. R. Rahman",
    entityId: "mock-entity-4",
    category: "music",
    description:
      "[MOCK RESULT — not real Qloo data] Oscar-winning composer blending Indian classical with electronic.",
    popularity: 0.96,
  },
];

export function qlooMockOn(): boolean {
  return config.qlooMock;
}

/** True when a real Qloo key is configured (mock mode excluded). */
export function qlooConfigured(): boolean {
  return !config.qlooMock && config.qlooApiKey.length > 0;
}

/** Which backend the `taste_recommend` tool will use right now. */
export function tasteBackendName(): "qloo" | "qloo-mock" | "none" {
  if (config.qlooMock) return "qloo-mock";
  if (config.qlooApiKey) return "qloo";
  return "none";
}

function qlooHeaders(): Record<string, string> {
  return { "X-Api-Key": config.qlooApiKey, accept: "application/json" };
}

function mapEntity(e: Record<string, unknown>, category: string): TasteHit {
  const props = (e.properties ?? {}) as Record<string, unknown>;
  const desc =
    (props.short_description as string) ||
    (props.description as string) ||
    "";
  return {
    name: String(e.name ?? "Untitled"),
    entityId: String(e.entity_id ?? ""),
    category,
    description: desc.slice(0, 300),
    popularity: typeof e.popularity === "number" ? e.popularity : 0,
  };
}

/** Resolve a free-text query to Qloo entity ids (used as insight signals). */
async function searchEntities(query: string, limit = 5): Promise<string[]> {
  const host = config.qlooApiUrl.replace(/\/v2\/?$/, "");
  const res = await fetch(
    `${host}/search?query=${encodeURIComponent(query)}&limit=${limit}`,
    { headers: qlooHeaders(), signal: AbortSignal.timeout(30_000) }
  );
  if (!res.ok)
    throw new Error(`Qloo search ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    results?: { entities?: Array<Record<string, unknown>> };
    entities?: Array<Record<string, unknown>>;
  };
  const entities = data.results?.entities ?? data.entities ?? [];
  return entities
    .map((e) => String(e.entity_id ?? ""))
    .filter(Boolean);
}

/** Live Qloo Insights call — taste-graph recommendations. */
async function insightsRecommend(
  body: Record<string, unknown>,
  category: string,
  maxResults: number
): Promise<TasteHit[]> {
  const res = await fetch(`${config.qlooApiUrl}/insights`, {
    method: "POST",
    headers: { ...qlooHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, limit: maxResults }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok)
    throw new Error(`Qloo insights ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    results?: { entities?: Array<Record<string, unknown>> };
    entities?: Array<Record<string, unknown>>;
  };
  const entities = data.results?.entities ?? data.entities ?? [];
  return entities.slice(0, maxResults).map((e) => mapEntity(e, category));
}

/**
 * Taste-graph recommendations for the agent's `taste_recommend` tool.
 * Flow: search the query -> entity ids -> insights with those as interest
 * signals (+ optional location). Falls back to un-signalled insights when
 * the search yields nothing.
 */
export async function tasteRecommend(
  query: string,
  category = "movie",
  location = "",
  maxResults = 8
): Promise<TasteHit[]> {
  if (config.qlooMock) {
    // Mock path: deterministic canned results, clearly labeled. No network.
    const cat = category.toLowerCase();
    const hits = MOCK_HITS.filter((h) => h.category === cat);
    return (hits.length ? hits : MOCK_HITS).slice(0, maxResults);
  }
  if (!config.qlooApiKey)
    throw new Error(
      "QLOO_API_KEY is not set — add your Qloo API key (dashboard.qloo.com) to enable taste recommendations"
    );
  const cat = category.toLowerCase();
  const urn = CATEGORY_URNS[cat] ?? CATEGORY_URNS.movie;
  const n = Math.max(1, Math.min(10, maxResults));

  let entityIds: string[] = [];
  try {
    entityIds = await searchEntities(query, 5);
  } catch {
    // Search failed (bad key, network) — fall through to un-signalled
    // insights; if the key is bad the insights call will surface the error.
  }

  const body: Record<string, unknown> = { "filter.type": urn };
  if (entityIds.length > 0) body["signal.interests.entities"] = entityIds.join(",");
  if (location.trim()) body["filter.location.query"] = location.trim();
  return insightsRecommend(body, cat, n);
}
