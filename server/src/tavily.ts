import { config } from "./config.js";

// Tavily web search — also our entry for the "Best Use of Tavily" prize.

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearch(query: string, maxResults = 5): Promise<SearchHit[]> {
  if (!config.tavilyApiKey) throw new Error("TAVILY_API_KEY is not set");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: config.tavilyApiKey,
      query,
      max_results: maxResults,
      search_depth: "advanced",
      include_answer: false,
    }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    results: Array<{ title: string; url: string; content: string }>;
  };
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: (r.content ?? "").slice(0, 400),
  }));
}
