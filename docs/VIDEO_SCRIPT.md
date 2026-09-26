# Yaad — Demo Video Script (≤ 3 min)

Target: Nebius x NVIDIA Global AI Hackathon judges. Voiceover in Roman Hindi
(user's voice), **English subtitles burned in**. Screen-record the live app at
https://devilking7x.github.io/yaad/ (backend must be deployed before recording).
Background music: subtle lo-fi, low volume. Pace: fast, no dead air.

## Shot list

### 0:00–0:12 — Hook
- **Show:** black screen → Yaad logo/gold UI fades in.
- **Say:** *"AI assistants sab kuch bhool jaate hain. Yaad nahi bhoolta. Ye hai Yaad —
  tumhara personal AI jo tumhe yaad rakhta hai — NVIDIA Nemotron ke dimaag ke saath,
  Nebius par chalta hua."*
- Subtitle the English translation.

### 0:12–0:40 — The memorable moment: Mumbai → Delhi
- **Show:** chat. Type: *"mera ghar Mumbai me hai"*. Yaad saves it (memory toast).
  Then type: *"nahi yaar, ab main Delhi shift ho gaya"*. Then ask: *"mera ghar kahan hai?"*
- **Show:** Yaad answers **Delhi**, memory panel shows Mumbai crossed as 📜 purani.
- **Say:** *"Purani yaad delete nahi hoti — retire hoti hai. Bi-temporal memory.
  Isiliye Yaad kabhi confuse nahi hota: ab kya sach hai, aur pehle kya tha."*

### 0:40–1:00 — Dreaming + proactive nudge
- **Show:** tap 💤 "Sapne dekho" → "sapne dekh raha hun…" → ✨ insight appears.
- **Show:** a reminder nudge toast popping: *"yaad dilaya"*.
- **Say:** *"Raat ko Yaad sapne dekhta hai — tumhari yaadon se naye insights nikalta hai.
  Aur subah khud yaad dilata hai. Tumhe puchhna nahi padta."*

### 1:00–1:20 — Self-improving skills
- **Show:** Skills tab → drafts inbox → a drafted SKILL.md → **Approve** → becomes active skill.
- **Say:** *"Ye sabse wild part hai: Yaad apne liye khud skills likhta hai.
  Maine nahi likha — usne seekha, usne banaya, maine sirf approve kiya."*

### 1:20–1:45 — Speed: parallel tools + code execution
- **Show:** ask *"47 * 183 kitna hota hai, aur aaj se 45 din baad kaunsi date hogi?"*
  → both computed instantly via `run_code`. Show the "socha" reasoning block.
- **Show:** two tool calls firing in parallel (status hints).
- **Say:** *"Grok-style parallel tool calls, sandboxed code execution — hisaab lagana,
  dates nikalna, data badalna — guess nahi, compute."*

### 1:45–2:15 — Background research + deep research (Tavily)
- **Show:** *"AI agents 2026 par research karke background me bata dena"*
  → Yaad: *"ho jayega to bata dunga"* → you keep chatting → 🔍 nudge *"Research taiyaar"*
  → Jobs tab → summary + cited sources.
- **Say:** *"Lambi research background me chalti hai. Tum ruko mat — Yaad khud batayega.
  Har claim ke saath source. Powered by Tavily."*

### 2:15–2:40 — Knowledge graph
- **Show:** Memory tab → 🕸 Graph → golden entity graph → click a node → memories filter.
- **Say:** *"Aur ye hai tumhara dimaag — visual. Har entity, har connection."*

### 2:40–3:00 — Stack + close
- **Show:** architecture cards overlay: NVIDIA Nemotron (reasoning + fast routing) ·
  Nebius Token Factory · Tavily (search + extract) · MCP server · PWA.
- **Say:** *"Yaad — jo bhoolta nahi. Built for the Nebius x NVIDIA hackathon.
  Personal AI track. Try it — link description me."*
- **End card:** repo URL + "Star ⭐ if Yaad remembered something about you."

## Recording checklist
- [ ] Backend deployed on Nebius Serverless, `VITE_API_URL` set, chat actually works live
- [ ] Seed 8–10 demo memories beforehand (Mumbai→Delhi pair, chai, gym, metro…)
- [ ] One dream insight + one skill draft pre-generated for the recording
- [ ] Browser notifications ALLOWED (nudge shots)
- [ ] 1080p, system audio off, mic on, quiet room
- [ ] Keep raw footage — Devpost allows re-upload
