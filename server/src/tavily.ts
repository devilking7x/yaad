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
    signal: AbortSignal.timeout(90_000),
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
 * Deep research pipeline v2 — orchestrator-worker fan-out:
 * 1. Planner (fast model) breaks the question into 2-4 focused sub-queries.
 * 2. Each sub-query runs an advanced Tavily search IN PARALLEL.
 * 3. Top pages per thread are extracted in parallel.
 * 4. A synthesizer merges everything into one cited answer.
 * This is the canonical 2026 agentic pattern (Anthropic orchestrator-worker).
 */
export async function deepResearch(query: string): Promise<{ summary: string; sources: string[] }> {
  // 1. Plan: decompose into sub-queries
  let subQueries: string[] = [query];
  try {
    const { message } = await chatComplete({
      model: config.fastModel,
      temperature: 0.3,
      maxTokens: 300,
      messages: [
        {
          role: "system",
          content:
            "Break a research question into 2-4 focused sub-questions that together cover it fully. " +
            "Reply with ONLY a JSON array of strings. No other text.",
        },
        { role: "user", content: query },
      ],
    });
    const parsed = JSON.parse(message.content ?? "[]") as unknown;
    if (Array.isArray(parsed) && parsed.length >= 2) {
      subQueries = parsed.filter((s): s is string => typeof s === "string" && s.trim().length > 5).slice(0, 4);
      if (!subQueries.length) subQueries = [query];
    }
  } catch {
    /* single-thread fallback */
  }

  // 2. Fan out: parallel advanced searches (context-isolated workers)
  const searches = await Promise.all(
    subQueries.map(async (sq) => {
      try {
        const data = await tavilyRaw("/search", {
          query: sq,
          search_depth: "advanced",
          max_results: 5,
          chunks_per_source: 3,
          include_answer: false,
        });
        return { sq, results: (data.results ?? []) as Array<{ title: string; url: string; content: string }> };
      } catch {
        return { sq, results: [] as Array<{ title: string; url: string; content: string }> };
      }
    })
  );

  // 3. Collect unique top URLs and extract them in parallel
  const seen = new Set<string>();
  const topUrls: string[] = [];
  for (const s of searches) {
    for (const r of s.results.slice(0, 2)) {
      if (r.url && !seen.has(r.url)) {
        seen.add(r.url);
        topUrls.push(r.url);
      }
    }
  }

  let extracts = "";
  try {
    const ex = await tavilyRaw("/extract", {
      urls: topUrls.slice(0, 6),
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

  const snippets = searches
    .map((s) => `SUB-QUESTION: ${s.sq}\n` + s.results.map((r) => `- ${r.title} (${r.url}): ${(r.content ?? "").slice(0, 400)}`).join("\n"))
    .join("\n\n");

  // 4. Synthesize
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
          `RESEARCH QUESTION: ${query}\n\nTHREAD RESULTS:\n${snippets}\n\n` +
          (extracts ? `EXTRACTED PAGES:\n${extracts}` : "No full-page extracts available."),
      },
    ],
  });
  return { summary: (message.content as string) ?? "", sources: topUrls.slice(0, 6) };
}
