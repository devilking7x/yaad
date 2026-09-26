import { config } from "./config.js";
import { chatComplete } from "./nebius.js";

// Tavily web layer — our entry for the "Best Use of Tavily" prize.
// Uses three Tavily APIs: /search (advanced depth), /extract (page reading),
// and a deep_research pipeline (search -> extract -> synthesize).

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

async function tavilyRaw(path: string, body: Record<string, unknown>): Promise<any> {
  if (!config.tavilyApiKey) throw new Error("TAVILY_API_KEY is not set");
  const res = await fetch(`https://api.tavily.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: config.tavilyApiKey, ...body }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function webSearch(query: string, maxResults = 5): Promise<SearchHit[]> {
  const data = await tavilyRaw("/search", {
    query,
    max_results: maxResults,
    search_depth: "advanced",
    include_answer: false,
  });
  return (data.results ?? []).map((r: any) => ({
    title: r.title,
    url: r.url,
    snippet: (r.content ?? "").slice(0, 400),
  }));
}

/** Read a full page as clean markdown (Tavily /extract). */
export async function readPage(url: string, query = ""): Promise<string> {
  const data = await tavilyRaw("/extract", {
    urls: [url],
    query,
    extract_depth: "basic",
    format: "markdown",
  });
  const r = data.results?.[0];
  if (!r?.raw_content) throw new Error("Tavily could not extract that URL");
  return (r.raw_content as string).slice(0, 8000);
}

/**
 * Deep research pipeline: advanced search -> extract top pages ->
 * synthesize a cited answer with the fast model. For complex,
 * multi-source questions where one search isn't enough.
 */
export async function deepResearch(query: string): Promise<{ summary: string; sources: string[] }> {
  const search = await tavilyRaw("/search", {
    query,
    search_depth: "advanced",
    max_results: 8,
    chunks_per_source: 3,
    include_answer: "advanced",
  });
  const results: Array<{ title: string; url: string; content: string }> = search.results ?? [];
  const topUrls = results.slice(0, 3).map((r) => r.url);

  let extracts = "";
  try {
    const ex = await tavilyRaw("/extract", {
      urls: topUrls,
      query,
      extract_depth: "advanced",
      format: "markdown",
    });
    extracts = (ex.results ?? [])
      .map((r: any) => `--- SOURCE: ${r.url}\n${((r.raw_content as string) ?? "").slice(0, 6000)}`)
      .join("\n\n");
  } catch {
    /* search snippets alone are still useful */
  }

  const snippets = results
    .map((r) => `- ${r.title} (${r.url}): ${(r.content ?? "").slice(0, 500)}`)
    .join("\n");

  const { message } = await chatComplete({
    model: config.fastModel,
    temperature: 0.3,
    maxTokens: 1500,
    messages: [
      {
        role: "system",
        content:
          "You are a research synthesizer. Answer the question thoroughly and structurally, " +
          "with specific names, numbers and dates. Cite sources inline as [title](url). " +
          "If sources disagree, say so.",
      },
      {
        role: "user",
        content:
          `RESEARCH QUESTION: ${query}\n\nSEARCH RESULTS:\n${snippets}\n\n` +
          (extracts ? `EXTRACTED PAGES:\n${extracts}` : "No full-page extracts available."),
      },
    ],
  });
  return { summary: (message.content as string) ?? "", sources: topUrls };
}
