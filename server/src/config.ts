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
  port: Number(process.env.PORT ?? 8787),
  memoryDir: expandHome(process.env.MEMORY_DIR ?? "~/.yaad"),
  skillsDir: resolveSkillsDir(),
};

export function assertConfigured(): void {
  if (!config.nebiusApiKey) throw new Error("NEBIUS_API_KEY is not set");
  if (!config.reasoningModel) throw new Error("NEBIUS_REASONING_MODEL is not set — list your key's models at GET $NEBIUS_BASE_URL/models");
  if (!config.fastModel) throw new Error("NEBIUS_FAST_MODEL is not set — list your key's models at GET $NEBIUS_BASE_URL/models");
}

// Re-export for convenience in error messages
export { req };
