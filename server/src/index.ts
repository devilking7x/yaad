import cors from "cors";
import express from "express";
import { runAgent, runAgentStream } from "./agent.js";
import { assertConfigured, config } from "./config.js";
import { memoryDelete, memoryExport, memoryGet, memoryList } from "./memory.js";
import { listModels } from "./nebius.js";
import { addReminder, completeReminder, deleteReminder, listReminders } from "./reminders.js";
import {
  appendSessionMessages,
  createSession,
  deleteSession,
  getSession,
  listSessions,
} from "./sessions.js";
import { installSkill, listSkills } from "./skills.js";

const app = express();
app.use(
  cors(
    config.corsOrigin === "*"
      ? undefined
      : { origin: config.corsOrigin.split(",").map((s) => s.trim()) }
  )
);
app.use(express.json({ limit: "12mb" })); // images ride along as data URLs

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "yaad",
    nebius: { baseUrl: config.nebiusBaseUrl, reasoningModel: config.reasoningModel, fastModel: config.fastModel },
    tavily: Boolean(config.tavilyApiKey),
  });
});

// Optional shared-secret auth (set YAAD_API_TOKEN on the server). Health stays open.
app.use("/api", (req, res, next) => {
  if (!config.apiToken) return next();
  if (req.headers.authorization === `Bearer ${config.apiToken}`) return next();
  res.status(401).json({ error: "Unauthorized — set the API token" });
});

// In-memory rate limiter: protects your Nebius credits on a public demo.
const hits = new Map<string, number[]>();
function rateLimit(max: number, windowMs: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      res.status(429).json({ error: "Bahut tez! Thoda ruk ke try karo." });
      return;
    }
    arr.push(now);
    hits.set(ip, arr);
    next();
  };
}
const chatLimit = rateLimit(30, 60_000); // 30 chat turns / minute / IP

// List models your Token Factory key can reach — use this to pick model IDs.
app.get("/api/models", async (_req, res) => {
  try {
    res.json(await listModels());
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

app.post("/api/chat", chatLimit, async (req, res) => {
  try {
    assertConfigured();
    const { message, history, image } = req.body as {
      message?: string;
      history?: Array<{ role: string; content: string }>;
      image?: string;
    };
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Body must include { message: string }" });
      return;
    }
    const safeHistory = (history ?? []).filter((m) => ["user", "assistant"].includes(m.role));
    const result = await runAgent(message, safeHistory as never, { image });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Streaming chat: server-sent events (token | tool | done | error).
app.post("/api/chat/stream", chatLimit, async (req, res) => {
  try {
    assertConfigured();
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
    return;
  }
  const { message, history, image } = req.body as {
    message?: string;
    history?: Array<{ role: string; content: string }>;
    image?: string;
  };
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Body must include { message: string }" });
    return;
  }
  const safeHistory = (history ?? []).filter((m) => ["user", "assistant"].includes(m.role));

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (type: string, data: unknown): void => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  try {
    await runAgentStream(message, safeHistory as never, (e) => send(e.type, e), { image });
  } catch (e) {
    send("error", { error: (e as Error).message });
  }
  res.end();
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

app.post("/api/skills/install", async (req, res) => {
  try {
    const { name, url } = req.body as { name?: string; url?: string };
    if (!name || !url) {
      res.status(400).json({ error: "Body must include { name, url }" });
      return;
    }
    const skill = await installSkill(name, url);
    res.json({ installed: true, name: skill.name, description: skill.description });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// --- Reminders ---------------------------------------------------------------

app.get("/api/reminders", (_req, res) => {
  res.json(listReminders());
});

app.post("/api/reminders", (req, res) => {
  try {
    const { text, remindAt } = req.body as { text?: string; remindAt?: string };
    if (!text || !remindAt) {
      res.status(400).json({ error: "Body must include { text, remindAt }" });
      return;
    }
    res.json(addReminder(text, remindAt));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/reminders/:id/done", (req, res) => {
  res.json({ ok: completeReminder(req.params.id) });
});

app.delete("/api/reminders/:id", (req, res) => {
  res.json({ ok: deleteReminder(req.params.id) });
});

// --- Sessions ----------------------------------------------------------------

app.get("/api/sessions", (_req, res) => {
  res.json(listSessions());
});

app.post("/api/sessions", (req, res) => {
  const { title, messages } = req.body as { title?: string; messages?: Array<{ role: string; content: string }> };
  const clean = (messages ?? [])
    .filter((m) => ["user", "assistant"].includes(m.role))
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  res.json(createSession(title ?? "New chat", clean));
});

app.get("/api/sessions/:id", (req, res) => {
  try {
    const s = getSession(req.params.id);
    if (!s) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(s);
  } catch {
    res.status(400).json({ error: "Invalid session id" });
  }
});

app.post("/api/sessions/:id/messages", (req, res) => {
  const { messages } = req.body as { messages?: Array<{ role: string; content: string }> };
  const clean = (messages ?? [])
    .filter((m) => ["user", "assistant"].includes(m.role))
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  try {
    const s = appendSessionMessages(req.params.id, clean);
    if (!s) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: "Invalid session id" });
  }
});

app.delete("/api/sessions/:id", (req, res) => {
  res.json({ ok: deleteSession(req.params.id) });
});

app.listen(config.port, () => {
  console.log(`Yaad server on http://localhost:${config.port}`);
  try {
    assertConfigured();
    console.log(`Brain: ${config.reasoningModel} (reasoning) / ${config.fastModel} (fast) via ${config.nebiusBaseUrl}`);
  } catch (e) {
    console.warn(`Not fully configured: ${(e as Error).message}`);
  }
});
