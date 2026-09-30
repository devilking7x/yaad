import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

/** Resolve the skills dir robustly no matter the CWD (repo root or server/). */
function resolveSkillsDir(): string {
  const raw = process.env.SKILLS_DIR ?? "./skills";
  if (path.isAbsolute(raw)) return raw;
  const here = path.dirname(fileURLToPath(import.meta.url)); // src/ or dist/
  const candidates = [
    path.resolve(process.cwd(), raw),
    path.resolve(process.cwd(), "..", raw),
    path.resolve(here, "..", "..", raw), // dist/ or src/ -> repo root
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isDirectory()) return c;
    } catch {
      /* try next */
    }
  }
  return path.resolve(process.cwd(), raw);
}

export const config = {
  nebiusApiKey: process.env.NEBIUS_API_KEY ?? "",
  nebiusBaseUrl: (process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1").replace(/\/+$/, ""),
  reasoningModel: process.env.NEBIUS_REASONING_MODEL ?? "",
  fastModel: process.env.NEBIUS_FAST_MODEL ?? "",
  tavilyApiKey: process.env.TAVILY_API_KEY ?? "",
  // --- SerpApi (alternate web-search backend; SerpApi India Hackathon 2026) ---
  // When SERPAPI_API_KEY is set, Yaad's `web_search` tool uses SerpApi instead
  // of Tavily. SERPAPI_MOCK=1 returns labeled canned results for testing.
  serpapiApiKey: process.env.SERPAPI_API_KEY ?? "",
  serpapiMock: (process.env.SERPAPI_MOCK ?? "") === "1",
  embeddingModel: process.env.NEBIUS_EMBEDDING_MODEL ?? "",
  visionModel: process.env.NEBIUS_VISION_MODEL ?? "",
  // Optional per-1M-token prices (USD) for the cost meter — copy from Token Factory pricing.
  // When unset, spend.ts uses conservative fallbacks so the daily cap still works.
  priceInputPer1M: Number(process.env.NEBIUS_PRICE_INPUT_PER_1M ?? 0),
  priceOutputPer1M: Number(process.env.NEBIUS_PRICE_OUTPUT_PER_1M ?? 0),
  priceEmbedPer1M: Number(process.env.NEBIUS_PRICE_EMBED_PER_1M ?? 0),
  autoRemember: (process.env.YAAD_AUTO_REMEMBER ?? "1") === "1",
  port: Number(process.env.PORT ?? 8787),
  memoryDir: expandHome(process.env.MEMORY_DIR ?? "~/.yaad"),
  skillsDir: resolveSkillsDir(),
  // Optional shared secret: when set, every /api/* call (except /api/health)
  // must send `Authorization: Bearer <token>`. Web UI reads VITE_API_TOKEN.
  apiToken: process.env.YAAD_API_TOKEN ?? "",
  // Comma-separated allowed origins, or "*" (default) for open dev mode.
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  // Daily spend cap in USD (0 = no cap). Blocks chat when reached.
  dailyCapUsd: Number(process.env.YAAD_DAILY_CAP_USD ?? 0),
  // Per-IP daily demo budget in USD (0 = no per-IP cap). Stops one visitor
  // from eating the whole daily budget on the public demo link.
  ipDailyCapUsd: Number(process.env.YAAD_IP_DAILY_CAP_USD ?? 0.15),
};

export function assertConfigured(): void {
  if (!config.nebiusApiKey) throw new Error("NEBIUS_API_KEY is not set");
  if (!config.reasoningModel) throw new Error("NEBIUS_REASONING_MODEL is not set — list your key's models at GET $NEBIUS_BASE_URL/models");
  if (!config.fastModel) throw new Error("NEBIUS_FAST_MODEL is not set — list your key's models at GET $NEBIUS_BASE_URL/models");
}

// Re-export for convenience in error messages
export { req };
