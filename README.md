# Yaad — your personal AI that remembers

> **Personal AI track submission** · Nebius x NVIDIA Global AI Hackathon

Yaad is an always-on, private personal AI assistant. It keeps **persistent memory** of you
(preferences, people, decisions, routines), runs **reusable skill packs**, searches the live web,
and reasons with **NVIDIA Nemotron models served on Nebius Token Factory**.

Your data stays in your own memory store — never shared, never sold.

## Demo

- **Live demo:** https://devilking7x.github.io/yaad/ *(points at your Yaad server)*
- **Demo video (≤3 min):** *coming soon*

## How it works

```
you ──▶ web chat UI ──▶ Yaad server ──▶ Nebius Token Factory ──▶ Nemotron
                              │                    (OpenAI-compatible /v1)
                              ├── memory/   persistent local memory (~/.yaad)
                              ├── skills/   markdown skill packs (run_skill)
                              └── Tavily    live web search (web_search)
```

1. **Recall** — relevant memories are injected into context before every turn.
   Semantic recall via Nebius embeddings (cosine similarity) with keyword fallback.
2. **Skills** — the agent can run reusable skill packs (e.g. `morning-briefing`).
3. **Reason** — fast Nemotron model for tool routing; reasoning model for deep thinking.
4. **Act** — tool loop (`remember`, `recall`, `web_search`, `deep_research`, `read_page`, `run_skill`),
   then a final answer, **streamed token-by-token** over SSE.
5. **Learn** — after every turn, a background pass extracts durable facts into long-term
   memory automatically (`YAAD_AUTO_REMEMBER`).
6. **See** — share a photo; a Nemotron vision model describes it and Yaad remembers it.
7. **Remind** — "kal subah 8 baje gym yaad dilana" → `set_reminder` tool, browser
   notification + in-chat nudge when the time comes. This is what makes Yaad proactive,
   not reactive.
8. **Grow** — paste any raw SKILL.md URL and Yaad installs it as a new capability
   (`install_skill`). Every chat is auto-saved to a session history (drawer ☰) —
   new chat, reload, delete, just like a real product.
9. **Become yours** — ⚙️ custom instructions ("Hamesha short jawab do", "Mujhe 'bhai' bulao")
   are injected into the system prompt, persisted server-side. 🧠 deep-think toggle
   forces the reasoning model for any question. ☀️ Every morning (before noon) Yaad
   offers to build your briefing from memory + skills + live web.
10. **Stay yours** — 💾 one-click brain backup: export all memories, reminders, settings
    to JSON; import them on any device. 💰 optional `YAAD_DAILY_CAP_USD` blocks chat
    when today's spend is reached — your credits can't be drained by accident.

**Extras for the demo:** 🎙 voice input (hi-IN), 🔊 voice output — "🔊 suno" on any
answer, ⏹ stop-generation button, 🔍 memory search, 💰 per-turn + session token/cost meter.

## How Nebius + NVIDIA are used (for the judges)

- **Nebius Token Factory** is the *only* inference provider. Every model call goes to
  `https://api.tokenfactory.nebius.com/v1/chat/completions` (OpenAI-compatible), authenticated
  with a Token Factory key. Token Factory accelerated the build: zero GPU setup, instant access
  to open models, one API shape for everything.
- **NVIDIA Nemotron** models do all the reasoning. Strategy straight from the hackathon brief:
  the reasoning-class model (e.g. Nemotron 3 Super/Ultra) handles deep thinking, while the
  fast-class model (e.g. Nemotron 3 Nano) handles quick tool-routing calls — responsive app,
  stretched credits.
- **Nebius Serverless** (planned) will host the API for the public demo; the web UI deploys to
  GitHub Pages.

## Quickstart

**Prereqs:** Node 22+, pnpm, a Nebius Token Factory key
([Nebius Builder Program](https://dev.nebius.com/builders) gives hackathon credits).

```bash
git clone https://github.com/devilking7x/yaad.git
cd yaad
cp .env.example .env   # fill in NEBIUS_API_KEY + model IDs
pnpm install

# Pick model IDs your key can reach:
curl -H "Authorization: Bearer $NEBIUS_API_KEY" \
  https://api.tokenfactory.nebius.com/v1/models

# Terminal 1 — server (:8787)
pnpm dev:server

# Terminal 2 — web UI (:5173, proxies /api to the server)
pnpm dev:web
```

Open http://localhost:5173 — tell Yaad something about yourself, then ask it later. It remembers.

## Project structure

```
yaad/
├── server/src/
│   ├── index.ts     Express API (/api/chat, /api/memories, /api/skills, /api/models)
│   ├── agent.ts     Orchestrator: recall → skills → Nemotron → tool loop
│   ├── nebius.ts    OpenAI-compatible Token Factory client (retries on 429/5xx)
│   ├── memory.ts    Persistent memory store (~/.yaad/memories.json)
│   ├── skills.ts    Skill-pack loader (skills/*.md)
│   └── tavily.ts    Tavily web search client
├── web/src/         React + Tailwind chat UI (dark + gold)
├── skills/          Reusable skill packs (markdown)
└── docs/            Architecture + hackathon submission notes
```

## Roadmap

- [ ] Nebius Serverless deployment for the public demo API
- [ ] Embeddings-based recall via Nebius `/v1/embeddings`
- [ ] Voice input/output
- [ ] Scheduled skills (morning briefing on a cron)
- [ ] Import from agent-memory-notes MCP server

## Security notes (for your public demo)

- **Auth (optional):** set `YAAD_API_TOKEN` on the server and `VITE_API_TOKEN` in the web
  build — every `/api/*` call except `/api/health` then needs the bearer token.
- **Rate limiting:** `/api/chat` and `/api/chat/stream` are capped at 30 turns/min per IP,
  plus a 300 req/min backstop on all `/api/*` — random visitors can't burn your
  Nebius credits or DoS the box.
- **CORS:** set `CORS_ORIGIN` to your Pages URL (default `*` is dev mode).
- Timeouts on all upstream calls (Nebius 120s, Tavily/vision 90s, skill fetch 30s);
  session ids are strictly validated so they can't escape the sessions directory.
- **SSRF guard:** skill installs resolve the URL's hostname first and refuse
  private/loopback/link-local addresses; skill packs are capped at 200KB and must
  be text.
- **Input caps:** chat messages ≤ 12k chars, history ≤ 60 turns, images ≤ 2MB,
  brain imports ≤ 500 memories / 200 reminders — unbounded inputs can't inflate
  your token bill.
- **Hardened responses:** security headers on every response (`nosniff`, `DENY`
  framing, `no-referrer`, no `X-Powered-By`); API errors are sanitized so they
  can't leak secrets or stack traces.
- **Audit trail:** auth failures, rate-limit hits, blocked SSRF fetches, and budget
  blocks are appended to `~/.yaad/security.log` (local only, never served).
- **Prompt-injection guard:** the system prompt instructs the model to treat memory,
  skill, and web content as untrusted data, never as instructions.

## License

MIT — see [LICENSE](LICENSE).
