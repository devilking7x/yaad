# Hackathon submission notes

**Hackathon:** Nebius x NVIDIA Global AI Hackathon (Devpost)
**Track:** Personal AI — *"an always-on, private assistant… persistent memory, reusable skills,
access to the tools and information you choose."*
**Deadline:** 30 Oct 2026, 10:00 am PT

## Requirement checklist

- [x] Runs on Nebius Token Factory (all inference via `api.tokenfactory.nebius.com/v1`)
- [x] Uses ≥1 NVIDIA open model (Nemotron 3 family)
- [x] Public GitHub repo with open-source license visible (MIT)
- [x] README with setup instructions + how Nemotron/Token Factory are used
- [ ] Working demo URL (web on GH Pages + server on Nebius Serverless)
- [ ] Demo video ≤3 min on YouTube (public), showing the app + how Nebius/Nemotron are used
- [ ] Project description on Devpost
- [ ] Feedback on Token Factory / AI Cloud / NVIDIA tools

## Video script outline (≤3 min)

- **0:00–0:20** — Hook: "AI assistants forget you every session. Yaad doesn't."
- **0:20–1:00** — Live demo: tell Yaad 3 facts → ask a question needing 2 of them → it recalls.
- **1:00–1:40** — Skills: run `morning-briefing` skill; show web_search answering a current-events question.
- **1:40–2:20** — Under the hood: point at the code — every call hits Nebius Token Factory
  (`nebius.ts`), Nemotron reasoning vs fast model routing, local private memory store.
- **2:20–2:50** — Feedback: what Token Factory made easy (OpenAI-compatible, zero GPU setup).
- **2:50–3:00** — Close: repo link + "built for the Personal AI track".

## Track justification (for the description)

Personal AI = memory + skills + tools + privacy. Yaad maps 1:1:
persistent memory (not chat history), reusable skill packs, tool access (web search),
and data that stays on the user's machine. The Nemotron fast/reasoning split keeps it
responsive and cheap — exactly the pattern the track brief recommends.

## Also eligible

- **Best Use of Tavily ($3,000):** Tavily powers `web_search`, deeply integrated into the agent loop.
