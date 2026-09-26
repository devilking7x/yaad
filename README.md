# Yaad — your personal AI that *remembers*

> **Nebius x NVIDIA Global AI Hackathon** · Personal AI track · also targeting **Best Use of Tavily**

[![Nebius](https://img.shields.io/badge/inference-Nebius%20Token%20Factory-6C3CE0)](https://nebius.com)
[![NVIDIA](https://img.shields.io/badge/brain-NVIDIA%20Nemotron-76B900)](https://www.nvidia.com/en-us/ai/)
[![Tavily](https://img.shields.io/badge/search-Tavily-0A0A0A)](https://tavily.com)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

Yaad is an **always-on, private personal AI assistant**. It keeps a **persistent, self-correcting memory**
of you (preferences, people, decisions, routines), runs **reusable skill packs**, searches the **live web**,
and reasons with **NVIDIA Nemotron models served on Nebius Token Factory**.

Your data stays in your own memory store — never shared, never sold.

## 🎬 The one moment to remember

Tell Yaad *"main ab Delhi me hun"* — and it doesn't just learn Delhi. It **retires** the old
"Mumbai" fact into history, links the new one to your *location* entity, and if you ask tomorrow,
it answers Delhi — while still able to recall *"tum Mumbai me rehte the"* when you ask about the past.

Then tap **💤 Sapne dekho** — Yaad clusters your memories by entity, finds patterns you've never
stated outright, and wakes up with insights. *That* is a personal AI, not a chatbot.

## Demo

- **Live demo:** https://devilking7x.github.io/yaad/ *(points at your Yaad server)*
- **Demo video (≤3 min):** *coming soon*

---

## ✨ What makes Yaad advanced

### 🧠 Research-grade memory (not a vector dump)

| Capability | How Yaad does it |
|---|---|
| **Bi-temporal versioning** | Every fact carries `validFrom` / `validTo` / `supersededBy`. Contradicted facts are *retired*, never deleted — recall defaults to what's currently true, history stays queryable |
| **Hybrid recall (RRF, k=60)** | Dense embeddings (cosine) + keyword ranking + entity matching, fused with Reciprocal Rank Fusion — the 2026 consensus best practice |
| **Entity-centric** | Entities extracted at write time; memories link through people, places, projects |
| **Proactive learning** | After every turn, a background pass extracts durable facts into long-term memory (`YAAD_AUTO_REMEMBER`) |
| **Dreaming** | Sleep-time consolidation: clusters memories by entity/tag, and when ≥3 related memories exist, synthesizes higher-level `✨ insights` |

### 🤖 Agent architecture

```
you ──▶ web chat UI (SSE stream) ──▶ Yaad server ──▶ Nebius Token Factory ──▶ Nemotron
                                            │
                          ┌─────────────────┼──────────────────┐
                          ▼                 ▼                  ▼
                    memory/            skills/              Tavily
              bi-temporal JSON    markdown skill packs   live web search
                (~/.yaad)         (run_skill, install)   (web_search,
                                                         deep_research,
                                                          read_page)
```

**Two-brain routing:** the fast Nemotron model (Nano) handles tool routing and extraction;
the reasoning model (Super/Ultra) handles deep thinking and planning. One API shape,
zero GPU setup — pure Token Factory.

**Deep research v2 (orchestrator → workers):** a planner decomposes your question into
2–4 focused sub-queries → parallel Tavily advanced searches → parallel page extraction →
a single cited synthesis. Built for the **Best Use of Tavily** prize.

**Tool loop:** `remember` · `recall` · `web_search` · `deep_research` · `read_page` ·
`run_skill` · `install_skill` · `set_reminder` · `see_image` · `dream` · **`run_code`** — then a final
answer, **streamed token-by-token** over SSE with live tool-status hints. Independent tool calls in
one turn execute **in parallel** (Grok-style), not one-by-one — multi-tool answers land faster.
A **proactive engine** (`proactive.ts`) wakes Yaad up on its own: due reminders, the morning briefing
window, and fresh dream insights surface as nudges without you asking.

### 🔔 Proactive engine — Yaad waits for no one

Yaad doesn't just answer — it **wakes up on its own**. A server-side engine evaluates
every minute whether there's something worth telling you *right now*:

- ⏰ **Due reminders** — surface as toasts + browser notifications until acknowledged
- ☀️ **Morning briefing** — once a day before noon, if your brain has something to brief on
- 💤 **New dream insights** — the moment auto-dreaming synthesizes one, you're told

No model calls, no spam (seen-state is idempotent), offline-safe. And **auto-dreaming**:
when enough new memories pile up, Yaad consolidates them in the background by itself.

### 💻 Code execution — Yaad computes, never guesses

Like Codex and Grok, Yaad has a **`run_code` tool**: sandboxed JavaScript (no network,
no filesystem, 5s timeout) for math, date calculations, sorting/filtering, and verifying
logic. Ask "mere 5 stocks ka average return kya hai?" and it *runs* the numbers instead of
estimating them. The sandbox is a guardrail, not a bulletproof boundary — documented honestly
in `server/src/sandbox.ts`.

### 🌱 Self-improving: Yaad writes its own skills

When dreaming spots a **repeated workflow** in your memories (not a one-off fact), it drafts
a full SKILL.md pack for it — and drops it in a **draft inbox**. Nothing auto-installs:
you review and hit **Approve ✓** (or Discard ✕) in the Skills tab. A `✨ Naya skill taiyaar`
nudge tells you the moment one lands. Drafts are never runnable until approved — the
approval gate is the whole point.

### 🔌 MCP server — Yaad's brain, open to other agents

`pnpm mcp` starts a stdio JSON-RPC server exposing Yaad's memory to any MCP client
(Claude Code, Cursor, …):

- `yaad_memory_search` — semantic + hybrid recall over your memories
- `yaad_memory_add` — write a memory with tags/entities
- `yaad_memory_list` — browse the store
- `yaad_reminders_list` — your reminders

### 🛡 Security (audited, not assumed)

- **SSRF guard with redirect validation** — every fetch (and *every redirect hop*) is
  DNS-checked against private/loopback/link-local ranges
- **Security headers**, CORS allow-list, optional shared-secret auth (`YAAD_API_TOKEN`)
- **Per-IP rate limits** (chat 30/min, API 300/min) with memory-bounded buckets
- **Input caps everywhere** — message/history/image/session sizes, custom-instruction length
- **Prompt-injection guard** — memory, skill-pack and web content are treated as untrusted data
- **Error sanitization** — secrets redacted from every API error; audit log for security events
- `pnpm audit`: no known vulnerabilities

---

## 🚀 Quickstart

```bash
git clone https://github.com/devilking7x/yaad && cd yaad
cp .env.example .env   # fill in NEBIUS_API_KEY (+ TAVILY_API_KEY for web search)

# backend (Express, :8787)
cd server && pnpm install && pnpm dev

# frontend (Vite) — in another terminal
cd web && pnpm install && pnpm dev   # http://localhost:5173
```

Pick your model IDs with `GET /api/models` (Token Factory lists what *your* key can reach),
then set them in `.env`:

| Role | Recommended | Env var |
|---|---|---|
| Fast (routing, extraction) | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | `NEBIUS_FAST_MODEL` |
| Reasoning (deep thinking) | `nvidia/nemotron-3-super-120b-a12b` | `NEBIUS_REASONING_MODEL` |
| Vision (photo memory) | `nvidia/Nemotron-3-Nano-Omni` | `NEBIUS_VISION_MODEL` |
| Embeddings (semantic recall) | `Qwen/Qwen3-Embedding-8B` | `NEBIUS_EMBEDDING_MODEL` |

Works offline-ish too: leave embedding/vision/Tavily keys empty and Yaad falls back to
keyword recall with zero model calls for memory.

### Deploy the backend (public demo)

The static site is just the UI — the chat needs the Express server. Deploy `server/` to
[Nebius Serverless](https://nebius.com) (or any Node host), then set in the Pages build:

- `VITE_API_URL` → your server URL
- `VITE_API_TOKEN` → same value as the server's `YAAD_API_TOKEN`

---

## 🧰 API reference

| Method & path | What it does |
|---|---|
| `POST /api/chat` · `POST /api/chat/stream` | Agent turn (SSE stream variant) |
| `GET /api/models` | Model IDs your Token Factory key can reach |
| `GET /api/memories` · `GET /api/memories/:id` | List / get memories (current facts) |
| `DELETE /api/memories/:id` | Delete a memory |
| `GET /api/memories/export` | Full memory dump |
| `GET /api/skills` · `POST /api/skills/install` | List / install a skill pack from URL |
| `GET /api/skills/drafts` · `POST /api/skills/drafts/:name/approve|discard` | Self-drafted skill inbox (approval gate) |
| `GET /api/nudges` · `POST /api/nudges/seen` | Proactive nudges (reminders, briefing, insights, skill drafts) |
| `GET/POST /api/reminders` · `POST /api/reminders/:id/done` | Reminders |
| `GET/POST /api/sessions` (+ `/:id`, `/:id/messages`) | Chat session history |
| `GET/POST /api/settings` | Custom instructions + spend readout |
| `GET /api/brain/export` · `POST /api/brain/import` | One-click brain backup / restore |
| `GET /api/health` | Health + configured models |

---

## 📁 Project structure

```
yaad/
├── server/                 # Express agent backend
│   └── src/
│       ├── agent.ts        # tool loop, two-brain routing, streaming, dreaming
│       ├── memory.ts       # bi-temporal store, RRF hybrid recall, entities
│       ├── dream.ts        # sleep-time consolidation → insights
│       ├── mcp.ts          # stdio MCP server (yaad_memory_*)
│       ├── tavily.ts       # search + parallel deep research + extraction
│       ├── skills.ts       # skill-pack loader/installer (SSRF-guarded)
│       ├── nebius.ts       # Token Factory client (OpenAI-compatible, retries)
│       ├── vision.ts       # photo → description → memory
│       ├── security.ts     # SSRF guard, safeFetch, headers, audit log
│       ├── sessions.ts / reminders.ts / settings.ts / spend.ts
│       └── index.ts        # routes, auth, rate limits, validation
├── web/                    # React + Tailwind chat UI (GitHub Pages)
│   └── src/ App.tsx, api.ts, md.ts (safe markdown renderer)
├── skills/                 # bundled skill packs (e.g. morning-briefing.md)
├── docs/                   # ARCHITECTURE.md, HACKATHON.md
└── .env.example            # every knob, documented
```

## 🗺 Roadmap

- [ ] Per-user auth + isolated memory stores (today: shared-secret demo mode)
- [ ] Nebius Serverless one-click deploy config
- [ ] Memory evaluation harness (recall@k on a golden set)
- [ ] Voice-first mode (Nemotron Omni audio in/out)

## License

MIT — build on it, ship it, win with it.
