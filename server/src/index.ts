import cors from "cors";
import express from "express";
import { runAgent } from "./agent.js";
import { assertConfigured, config } from "./config.js";
import { memoryDelete, memoryExport, memoryGet, memoryList } from "./memory.js";
import { listModels } from "./nebius.js";
import { listSkills } from "./skills.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "yaad",
    nebius: { baseUrl: config.nebiusBaseUrl, reasoningModel: config.reasoningModel, fastModel: config.fastModel },
    tavily: Boolean(config.tavilyApiKey),
  });
});

// List models your Token Factory key can reach — use this to pick model IDs.
app.get("/api/models", async (_req, res) => {
  try {
    res.json(await listModels());
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    assertConfigured();
    const { message, history } = req.body as { message?: string; history?: Array<{ role: string; content: string }> };
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Body must include { message: string }" });
      return;
    }
    const safeHistory = (history ?? []).filter((m) => ["user", "assistant"].includes(m.role));
    const result = await runAgent(message, safeHistory as never);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get("/api/memories", (_req, res) => res.json(memoryList()));
app.get("/api/memories/export", (_req, res) => res.json(memoryExport()));
app.get("/api/memories/:id", (req, res) => {
  const mem = memoryGet(req.params.id);
  if (!mem) res.status(404).json({ error: "Not found" });
  else res.json(mem);
});
app.delete("/api/memories/:id", (req, res) => {
  if (!memoryDelete(req.params.id)) res.status(404).json({ error: "Not found" });
  else res.json({ deleted: true });
});

app.get("/api/skills", (_req, res) => res.json(listSkills()));

app.listen(config.port, () => {
  console.log(`Yaad server on http://localhost:${config.port}`);
  try {
    assertConfigured();
    console.log(`Brain: ${config.reasoningModel} (reasoning) / ${config.fastModel} (fast) via ${config.nebiusBaseUrl}`);
  } catch (e) {
    console.warn(`Not fully configured: ${(e as Error).message}`);
  }
});
