import cors from "cors";
import express from "express";
import { runAgent, runAgentStream } from "./agent.js";
import { assertConfigured, config } from "./config.js";
import { memoryAdd, memoryDelete, memoryExport, memoryGet, memoryList } from "./memory.js";
import { listModels } from "./nebius.js";
import { addReminder, completeReminder, deleteReminder, listReminders } from "./reminders.js";
import {
  appendSessionMessages,
  createSession,
  deleteSession,
  getSession,
  listSessions,
} from "./sessions.js";
import { getSettings, setSettings } from "./settings.js";
import { installSkill, listSkills } from "./skills.js";
import { logSecurity, safeError, securityHeaders } from "./security.js";
import { todaySpendUsd } from "./spend.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // correct req.ip behind the serverless proxy
app.use(securityHeaders);
app.use(
  cors(
    config.corsOrigin === "*"
      ? undefined
      : { origin: config.corsOrigin.split(",").map((s) => s.trim()) }
  )
);
app.use(express.json({ limit: "4mb" })); // images ride along as data URLs (2MB cap enforced per-image)

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
  logSecurity("auth-failed", `${req.method} ${req.path}`, req.ip);
  res.status(401).json({ error: "Unauthorized — set the API token" });
});

// In-memory rate limiter: protects your Nebius credits on a public demo.
// Each limiter gets its own counter map so chat/API budgets stay independent.
function rateLimit(max: number, windowMs: number, label: string) {
  const hits = new Map<string, number[]>();
  // Hygiene: expired buckets are swept every minute and the map is capped,
  // so a flood of unique IPs can't grow memory without bound.
  setInterval(() => {
    const now = Date.now();
    for (const [ip, arr] of hits) {
      const fresh = arr.filter((t) => now - t < windowMs);
      if (fresh.length) hits.set(ip, fresh);
      else hits.delete(ip);
    }
    if (hits.size > 10_000) {
      let drop = hits.size - 10_000;
      for (const ip of hits.keys()) {
        hits.delete(ip);
        if (--drop <= 0) break;
      }
    }
  }, 60_000).unref();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      logSecurity("rate-limit", `${label} ${req.method} ${req.path}`, ip);
      res.status(429).json({ error: "Bahut tez! Thoda ruk ke try karo." });
      return;
    }
    arr.push(now);
    hits.set(ip, arr);
    next();
  };
}
const chatLimit = rateLimit(30, 60_000, "chat"); // 30 chat turns / minute / IP
const apiLimit = rateLimit(300, 60_000, "api"); // 300 API calls / minute / IP (backstop)
app.use("/api", apiLimit);

// --- Chat input validation ----------------------------------------------------
// Unbounded inputs = unbounded token bills. Caps keep the public demo safe.
const MAX_MSG = 12_000;
const MAX_HISTORY = 60;
const MAX_IMAGE = 2_000_000; // ~1.5MB data URL

function validateChatInput(body: {
  message?: unknown;
  history?: unknown;
  image?: unknown;
}): string | null {
  const { message, history, image } = body;
  if (!message || typeof message !== "string") return "Body must include { message: string }";
  if (message.length > MAX_MSG) return `Message bahut lamba hai (${MAX_MSG} chars max)`;
  if (history !== undefined) {
    if (!Array.isArray(history)) return "history must be an array";
    if (history.length > MAX_HISTORY) return `History bahut lambi hai (${MAX_HISTORY} turns max)`;
    for (const m of history) {
      if (typeof m?.content === "string" && m.content.length > MAX_MSG) {
        return "History me ek message bahut lamba hai";
      }
    }
  }
  if (image !== undefined && (typeof image !== "string" || image.length > MAX_IMAGE)) {
    return "Tasveer bahut badi hai (2MB max)";
  }
  return null;
}

// List models your Token Factory key can reach — use this to pick model IDs.
app.get("/api/models", async (_req, res) => {
  try {
    res.json(await listModels());
  } catch (e) {
    res.status(502).json({ error: safeError(e) });
  }
});

app.post("/api/chat", chatLimit, async (req, res) => {
  const bad = validateChatInput(req.body);
  if (bad) {
    res.status(400).json({ error: bad });
    return;
  }
  try {
    assertConfigured();
    const { message, history, image, forceReasoning } = req.body as {
      message: string;
      history?: Array<{ role: string; content: string }>;
      image?: string;
      forceReasoning?: boolean;
    };
    const safeHistory = (history ?? []).filter((m) => ["user", "assistant"].includes(m.role));
    const result = await runAgent(message, safeHistory as never, { image, forceReasoning });
    res.json(result);
  } catch (e) {
    const msg = safeError(e);
    if (msg.includes("budget")) logSecurity("budget-block", msg, req.ip);
    res.status(500).json({ error: msg });
  }
});

// Streaming chat: server-sent events (token | tool | done | error).
app.post("/api/chat/stream", chatLimit, async (req, res) => {
  const bad = validateChatInput(req.body);
  if (bad) {
    res.status(400).json({ error: bad });
    return;
  }
  try {
    assertConfigured();
  } catch (e) {
    res.status(500).json({ error: safeError(e) });
    return;
  }
  const { message, history, image, forceReasoning } = req.body as {
    message: string;
    history?: Array<{ role: string; content: string }>;
    image?: string;
    forceReasoning?: boolean;
  };
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
    await runAgentStream(message, safeHistory as never, (e) => send(e.type, e), { image, forceReasoning });
  } catch (e) {
    const msg = safeError(e);
    if (msg.includes("budget")) logSecurity("budget-block", msg, req.ip);
    send("error", { error: msg });
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
    const msg = safeError(e);
    logSecurity("skill-install-failed", msg, req.ip);
    res.status(400).json({ error: msg });
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
    if (text.length > 500) {
      res.status(400).json({ error: "Reminder text bahut lamba hai (500 chars max)" });
      return;
    }
    res.json(addReminder(text, remindAt));
  } catch (e) {
    res.status(400).json({ error: safeError(e) });
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

const MAX_STORED_MSG = 12_000; // mirrors the chat input cap
function cleanSessionMessages(messages: Array<{ role: string; content: string }> | undefined) {
  return (messages ?? [])
    .filter((m) => ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, MAX_STORED_MSG) }));
}

app.post("/api/sessions", (req, res) => {
  const { title, messages } = req.body as { title?: string; messages?: Array<{ role: string; content: string }> };
  res.json(createSession(String(title ?? "New chat").slice(0, 120), cleanSessionMessages(messages)));
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
  const clean = cleanSessionMessages(messages);
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

// --- Settings ---------------------------------------------------------------

app.get("/api/settings", (_req, res) => {
  res.json({ ...getSettings(), todaySpendUsd: todaySpendUsd() });
});

const MAX_INSTRUCTIONS = 2_000;
app.post("/api/settings", (req, res) => {
  const { customInstructions } = req.body as { customInstructions?: string };
  const text = String(customInstructions ?? "");
  if (text.length > MAX_INSTRUCTIONS) {
    res.status(400).json({ error: `Instructions bahut lambi hain (${MAX_INSTRUCTIONS} chars max)` });
    return;
  }
  res.json(setSettings(text));
});

// --- Brain backup: export/import everything ----------------------------------

app.get("/api/brain/export", (_req, res) => {
  res.json({
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    memories: memoryExport(),
    reminders: listReminders(),
    sessions: listSessions(),
  });
});

app.post("/api/brain/import", (req, res) => {
  try {
    const { settings, memories, reminders } = req.body as {
      settings?: { customInstructions?: string };
      memories?: Array<{ text: string; tags?: string[] }>;
      reminders?: Array<{ text: string; remindAt: string }>;
    };
    let restored = 0;
    if (settings?.customInstructions) {
      setSettings(settings.customInstructions);
      restored++;
    }
    // Import via the normal write paths so embeddings/validation apply.
    // Caps: 500 memories + 200 reminders, texts truncated — a hostile or
    // accidental giant backup can't DoS the server.
    (async () => {
      for (const m of (memories ?? []).slice(0, 500)) {
        if (m.text) {
          await memoryAdd(String(m.text).slice(0, 2000), m.tags ?? ["imported"]);
          restored++;
        }
      }
      for (const r of (reminders ?? []).slice(0, 200)) {
        try {
          if (r.text && r.remindAt) {
            addReminder(String(r.text).slice(0, 500), r.remindAt);
            restored++;
          }
        } catch {
          /* skip bad dates */
        }
      }
    })()
      .then(() => res.json({ ok: true, restored }))
      .catch((e) => res.status(500).json({ error: safeError(e) }));
  } catch (e) {
    res.status(400).json({ error: safeError(e) });
  }
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
