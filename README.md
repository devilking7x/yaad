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

**Extras for the demo:** 🎙 voice input (hi-IN), 💰 per-turn + session token/cost meter.

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

## License

MIT — see [LICENSE](LICENSE).
