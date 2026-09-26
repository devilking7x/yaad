# Architecture

## Components

```
┌─────────────┐      ┌──────────────┐      ┌──────────────────────────────┐
│  web/       │      │  server/     │      │  Nebius Token Factory        │
│  React chat │─────▶│  Express API │─────▶│  /v1/chat/completions        │
│  :5173      │ /api │  :8787       │      │  Nemotron models             │
└─────────────┘      └──────┬───────┘      └──────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ memory/  │  │ skills/  │  │ Tavily   │
        │ JSON     │  │ *.md     │  │ search   │
        │ ~/.yaad  │  │ packs    │  │ API      │
        └──────────┘  └──────────┘  └──────────┘
```

## Request flow (`POST /api/chat`)

1. `index.ts` validates input, calls `runAgent(message, history)`.
2. `agent.ts` recalls top-5 memories (`memorySearch`) and injects them into the system prompt
   together with the skill catalog.
3. Model routing: short/simple turns → `NEBIUS_FAST_MODEL` (e.g. Nemotron 3 Nano);
   long histories or complex asks → `NEBIUS_REASONING_MODEL` (e.g. Nemotron 3 Super/Ultra).
4. Tool loop (max 6 steps) with OpenAI-style function calling:
   - `remember(text, tags)` → `memoryAdd`
   - `recall(query)` → `memorySearch`
   - `web_search(query)` → Tavily
   - `run_skill(name)` → returns the skill pack's instructions; the agent follows them
5. Final assistant message returned with `{ reply, model, steps }`.

## Memory

File-backed JSON store (`~/.yaad/memories.json`), same 7-op interface as the
agent-memory-notes MCP server (`memory_add/list/search/get/update/delete/export`).
v0 search is keyword-ranked; the upgrade path is embeddings via Nebius
`POST /v1/embeddings` + cosine similarity, without changing the interface.

Privacy: the store lives on the user's machine. Nothing is sent to Nebius except
the current prompt (required for inference) — no training, no retention.

## Skills

Markdown packs in `skills/` with a front-matter header (`name`, `description`, `when`).
The agent sees the catalog in its system prompt and loads a pack's instructions via
`run_skill`. This mirrors the Agent Skill Studio format so packs are portable.

## Deployment

- **Web UI** → GitHub Pages (`.github/workflows/deploy-pages.yml`), served from `/yaad/`.
  `VITE_API_URL` points it at the server.
- **Server** → local for dev; Nebius Serverless Endpoints/Jobs for the public demo
  (satisfies the "runs on Nebius" requirement alongside Token Factory inference).
