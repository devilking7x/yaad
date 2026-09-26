import { useEffect, useRef, useState } from "react";
import { api, chatStream, type ChatSession, type Memory, type Reminder, type Skill } from "./api";
import { renderRich } from "./md";

interface Msg {
  role: "user" | "assistant";
  content: string;
  meta?: string;
  thinking?: string;
  image?: string;
}

interface SessionUsage {
  tokens: number;
  costUsd: number | null;
}

const TOOL_LABELS: Record<string, string> = {
  remember: "yaad kar raha hun…",
  recall: "yaadein dhoondh raha hun…",
  web_search: "web pe dekh raha hun…",
  deep_research: "gehri research kar raha hun (30-60s)…",
  read_page: "page padh raha hun…",
  run_skill: "skill chala raha hun…",
  install_skill: "skill install kar raha hun…",
  set_reminder: "reminder laga raha hun…",
  see_image: "tasveer dekh raha hun…",
  dream: "sapne dekh raha hun…",
};

const QUICK_ACTIONS = [
  "Mere baare me kya yaad hai tumhe?",
  "💤 Sapne dekho aur insights batao",
  "Good morning! Mera briefing do.",
  "Aaj ki top tech news batao.",
  "Kal subah 8 baje gym yaad dilana.",
];

function shortModel(m: string): string {
  const parts = m.split("/");
  return parts[parts.length - 1] || m;
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

export default function App() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content: "Namaste! Main Yaad hun — tumhara personal AI jo tumhe yaad rakhta hai. Kuch batao apne baare me, ya kuch pucho.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [tab, setTab] = useState<"memory" | "skills" | "reminders">("memory");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [skillName, setSkillName] = useState("");
  const [skillUrl, setSkillUrl] = useState("");
  const [skillMsg, setSkillMsg] = useState("");
  const [deepThink, setDeepThink] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");
  const [todaySpend, setTodaySpend] = useState<number | null>(null);
  const [memoryQuery, setMemoryQuery] = useState("");
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [showBriefing, setShowBriefing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const brainFileRef = useRef<HTMLInputElement>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [session, setSession] = useState<SessionUsage>({ tokens: 0, costUsd: null });
  const [listening, setListening] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recogRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.health().then(() => setServerOk(true)).catch(() => setServerOk(false));
    api.memories().then(setMemories).catch(() => {});
    api.skills().then(setSkills).catch(() => {});
    api.reminders.list().then(setReminders).catch(() => {});
    api.sessions.list().then(setSessions).catch(() => {});
    api.settings
      .get()
      .then((s) => {
        setCustomInstructions(s.customInstructions ?? "");
        setTodaySpend(s.todaySpendUsd ?? null);
      })
      .catch(() => {});
    // Morning briefing nudge: once per day, before noon.
    const today = new Date().toDateString();
    if (new Date().getHours() < 12 && localStorage.getItem("yaad-briefing-date") !== today) {
      setShowBriefing(true);
    }
  }, []);

  // Reminder scheduler: poll every 30s, fire browser notification + in-chat nudge.
  useEffect(() => {
    const tick = async () => {
      try {
        const all = await api.reminders.list();
        setReminders(all.filter((r) => !r.done));
        const now = new Date().toISOString();
        for (const r of all) {
          if (r.done || r.remindAt > now) continue;
          await api.reminders.done(r.id).catch(() => {});
          if ("Notification" in window && Notification.permission === "granted") {
            try {
              new Notification("Yaad ⏰", { body: r.text });
            } catch {}
          }
          setMessages((p) => [...p, { role: "assistant", content: `⏰ **Yaad dila raha hun:** ${r.text}` }]);
        }
      } catch {}
    };
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, status]);

  const refreshMemories = () => api.memories().then(setMemories).catch(() => {});

  function toggleVoice() {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      recogRef.current?.stop();
      setListening(false);
      return;
    }
    const recog = new SR();
    recog.lang = "hi-IN";
    recog.interimResults = false;
    recog.onresult = (e: any) => {
      const text = e.results[0][0].transcript as string;
      setInput((p) => (p ? `${p} ${text}` : text));
    };
    recog.onend = () => setListening(false);
    recog.onerror = () => setListening(false);
    recogRef.current = recog;
    recog.start();
    setListening(true);
  }

  const voiceSupported =
    typeof window !== "undefined" &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  function persistTurn(userText: string, assistantText: string) {
    const turn = [
      { role: "user", content: userText },
      { role: "assistant", content: assistantText },
    ];
    if (activeSessionId) {
      api.sessions.append(activeSessionId, turn).catch(() => {});
    } else if (userText) {
      api.sessions
        .create(userText.slice(0, 60), turn)
        .then((s) => {
          setActiveSessionId(s.id);
          api.sessions.list().then(setSessions).catch(() => {});
        })
        .catch(() => {});
    }
  }

  function newChat() {
    setMessages([{ role: "assistant", content: "Nayi shuruaat ✨ Kya baat karein?" }]);
    setActiveSessionId(null);
    setDrawerOpen(false);
  }

  async function loadSession(id: string) {
    try {
      const s = await api.sessions.get(id);
      setMessages(
        s.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
      );
      setActiveSessionId(id);
      setDrawerOpen(false);
    } catch {
      alert("Session load nahi hui");
    }
  }

  async function deleteSession(id: string) {
    if (!confirm("Ye chat delete karun?")) return;
    try {
      await api.sessions.remove(id);
      setSessions((p) => p.filter((s) => s.id !== id));
      if (activeSessionId === id) newChat();
    } catch {}
  }

  async function handleInstallSkill() {
    if (!skillName.trim() || !skillUrl.trim()) {
      setSkillMsg("Naam aur URL dono chahiye");
      return;
    }
    setSkillMsg("Install ho raha hai…");
    try {
      const r = (await api.installSkill(skillName.trim(), skillUrl.trim())) as { name: string };
      setSkillMsg(`✅ '${r.name}' install ho gaya`);
      setSkillName("");
      setSkillUrl("");
      api.skills().then(setSkills).catch(() => {});
    } catch (e) {
      setSkillMsg(`❌ ${(e as Error).message}`);
    }
  }

  function stopSpeak() {
    try {
      speechSynthesis.cancel();
    } catch {}
    setSpeakingIdx(null);
  }

  /** 🔊 Voice output — Yaad jawab suna bhi sakta hai (hi-IN). */
  function speak(text: string, idx: number) {
    try {
      if (speakingIdx === idx) {
        stopSpeak();
        return;
      }
      speechSynthesis.cancel();
      const clean = text
        .replace(/```[\s\S]*?```/g, " code. ")
        .replace(/[*_`#>\[\]()|]/g, "")
        .replace(/https?:\/\/\S+/g, " link. ")
        .slice(0, 600);
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = "hi-IN";
      const v = speechSynthesis.getVoices().find((vv) => vv.lang.startsWith("hi"));
      if (v) u.voice = v;
      u.onend = () => setSpeakingIdx(null);
      u.onerror = () => setSpeakingIdx(null);
      setSpeakingIdx(idx);
      speechSynthesis.speak(u);
    } catch {}
  }

  function dismissBriefing() {
    localStorage.setItem("yaad-briefing-date", new Date().toDateString());
    setShowBriefing(false);
  }

  async function saveSettings() {
    try {
      const s = await api.settings.set(customInstructions);
      setCustomInstructions(s.customInstructions);
      alert("✅ Yaad ab tumhare hisaab se baat karega");
    } catch {
      alert("Save nahi hua — server online hai?");
    }
  }

  async function exportBrain() {
    try {
      const data = await api.brain.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `yaad-brain-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {}
  }

  function onBrainFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      try {
        const data = JSON.parse(r.result as string);
        const res = await api.brain.import(data);
        alert(`✅ ${res.restored} cheezein restore ho gayin`);
        refreshMemories();
        api.settings.get().then((s) => setCustomInstructions(s.customInstructions ?? "")).catch(() => {});
      } catch {
        alert("❌ Ye valid brain backup nahi lagta");
      }
    };
    r.readAsText(f);
    e.target.value = "";
  }

  const filteredMemories = memories.filter((m) =>
    `${m.text} ${m.tags.join(" ")}`.toLowerCase().includes(memoryQuery.toLowerCase())
  );

  function exportChat() {
    const lines = messages
      .filter((m) => m.content.trim())
      .map((m) => `## ${m.role === "user" ? "You" : "Yaad"}\n\n${m.content}\n`);
    const blob = new Blob([`# Yaad chat export — ${new Date().toLocaleString()}\n\n${lines.join("\n")}`], {
      type: "text/markdown",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "yaad-chat.md";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function send(preset?: string) {
    const text = (preset ?? input).trim();
    if (busy) return;
    if (!text && !pendingImage) return;
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    stopSpeak();
    const img = pendingImage;
    setInput("");
    setPendingImage(null);
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const userMsg: Msg = { role: "user", content: text || "(tasveer bheji)" };
    if (img) userMsg.image = img;
    setMessages((p) => [...p, userMsg, { role: "assistant", content: "" }]);
    setBusy(true);
    setStatus(img && !text ? "tasveer dekh raha hun…" : "soch raha hun…");
    const idx = messages.length + 1; // placeholder assistant message

    const patch = (fn: (m: Msg) => Msg) =>
      setMessages((p) => p.map((m, i) => (i === idx ? fn(m) : m)));

    try {
      let acc = "";
      let think = "";
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      await chatStream(text || "Is tasveer ke baare me batao aur yaad rakho.", history, (e) => {
        if (e.type === "token") {
          acc += e.token;
          patch((m) => ({ ...m, content: acc }));
          setStatus("");
        } else if (e.type === "thinking") {
          think += e.text;
          patch((m) => ({ ...m, thinking: think }));
        } else if (e.type === "tool") {
          setStatus(TOOL_LABELS[e.name] ?? `${e.name}…`);
        } else if (e.type === "done") {
          const bits = [`${shortModel(e.model)}`, `${e.steps} steps`, `${fmtTokens(e.usage.total_tokens)} tokens`];
          if (e.costUsd != null) bits.push(`$${e.costUsd.toFixed(4)}`);
          const finalReply = e.reply || acc;
          patch((m) => ({ ...m, content: finalReply, meta: bits.join(" · ") }));
          setSession((s) => ({
            tokens: s.tokens + e.usage.total_tokens,
            costUsd: s.costUsd == null && e.costUsd == null ? null : (s.costUsd ?? 0) + (e.costUsd ?? 0),
          }));
          setStatus("");
          refreshMemories();
          // Persist this turn into the active session (or create one).
          persistTurn(text, finalReply);
        } else if (e.type === "error") {
          patch((m) => ({ ...m, content: `Server se baat nahi ho payi: ${e.error}` }));
          setStatus("");
        }
      },
        img ?? undefined,
        { forceReasoning: deepThink, signal: ctrl.signal }
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        patch((m) => ({ ...m, content: m.content ? `${m.content}\n\n⏹ Rok diya.` : "⏹ Rok diya." }));
      } else {
        patch((m) => ({ ...m, content: `Server se baat nahi ho payi: ${(err as Error).message}` }));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setStatus("");
    }
  }

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 4_000_000) {
      setStatus("Tasveer 4MB se chhoti honi chahiye");
      setTimeout(() => setStatus(""), 2500);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPendingImage(reader.result as string);
    reader.readAsDataURL(f);
    e.target.value = "";
  }

  async function forget(id: string) {
    await api.deleteMemory(id).catch(() => {});
    refreshMemories();
  }

  const showWelcome = !welcomeDismissed && memories.length === 0 && messages.length <= 1;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0f" }}>
      {/* Header */}
      <header className="border-b gold-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-neutral-300 hover:text-yellow-400 text-xl leading-none"
            title="Chat history"
          >
            ☰
          </button>
          <div>
            <h1 className="text-2xl font-bold gold-text tracking-tight">Yaad</h1>
            <p className="text-xs text-neutral-400">your personal AI that remembers</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={() => setDeepThink(!deepThink)}
            title="Deep soch — hamesha reasoning model use karo"
            className={`text-base leading-none ${deepThink ? "text-yellow-400" : "text-neutral-600 hover:text-neutral-300"}`}
          >
            🧠
          </button>
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            title="Settings — Yaad ko apne hisaab se dhalo"
            className={`text-base leading-none ${settingsOpen ? "text-yellow-400" : "text-neutral-500 hover:text-neutral-300"}`}
          >
            ⚙️
          </button>
          <button onClick={exportChat} className="text-neutral-400 hover:text-yellow-400" title="Chat export (Markdown)">
            ⬇ export
          </button>
          <span
            className={`inline-block w-2 h-2 rounded-full ${serverOk === null ? "bg-yellow-500" : serverOk ? "bg-green-500" : "bg-red-500"}`}
          />
          <span className="text-neutral-400">
            {serverOk === null ? "connecting…" : serverOk ? "server online" : "server offline"}
          </span>
        </div>
      </header>

      {/* Settings popover */}
      {settingsOpen && (
        <div className="fixed top-16 right-4 z-40 w-80 max-w-[90vw] bg-neutral-950 border gold-border rounded-2xl p-4 text-sm shadow-2xl">
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold gold-text">⚙️ Yaad ko apne hisaab se dhalo</p>
            <button onClick={() => setSettingsOpen(false)} className="text-neutral-500 hover:text-yellow-400">✕</button>
          </div>
          <p className="text-xs text-neutral-500 mb-1.5">
            Custom instructions — jaise "Hamesha short jawab do" ya "Mujhe 'bhai' bulao".
          </p>
          <textarea
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            rows={3}
            placeholder="Yaad hamesha…"
            className="w-full bg-neutral-900 border gold-border rounded-xl px-3 py-2 text-xs outline-none focus:border-yellow-500 placeholder:text-neutral-600"
          />
          <button
            onClick={saveSettings}
            className="mt-2 w-full bg-yellow-600 hover:bg-yellow-500 text-black font-semibold rounded-xl py-2 text-xs"
          >
            Save instructions
          </button>
          <div className="border-t gold-border mt-3 pt-3">
            <p className="text-xs text-neutral-500 mb-2">
              💾 Brain backup — tumhari yaadein, reminders, settings. Tumhara data, tumhare paas.
            </p>
            <div className="flex gap-2">
              <button
                onClick={exportBrain}
                className="flex-1 bg-neutral-900 border gold-border rounded-xl py-1.5 text-xs text-neutral-300 hover:text-yellow-400"
              >
                ⬇ Export brain
              </button>
              <button
                onClick={() => brainFileRef.current?.click()}
                className="flex-1 bg-neutral-900 border gold-border rounded-xl py-1.5 text-xs text-neutral-300 hover:text-yellow-400"
              >
                ⬆ Import brain
              </button>
              <input ref={brainFileRef} type="file" accept="application/json" className="hidden" onChange={onBrainFile} />
            </div>
          </div>
          {todaySpend != null && (
            <p className="text-[10px] text-neutral-600 mt-3 text-center">
              Aaj ka kharch: ${todaySpend.toFixed(4)}
            </p>
          )}
        </div>
      )}

      {/* Chat history drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} />
          <div className="relative w-72 max-w-[85vw] bg-neutral-950 border-r gold-border flex flex-col">
            <div className="p-3 border-b gold-border flex items-center justify-between">
              <span className="font-semibold gold-text">Chats</span>
              <button onClick={() => setDrawerOpen(false)} className="text-neutral-500 hover:text-yellow-400">✕</button>
            </div>
            <div className="p-3">
              <button
                onClick={newChat}
                className="w-full bg-yellow-600 hover:bg-yellow-500 text-black font-semibold rounded-xl py-2 text-sm"
              >
                ＋ New chat
              </button>
            </div>
            <div className="flex-1 overflow-y-auto chat-scroll px-3 pb-3 space-y-1.5">
              {sessions.length === 0 ? (
                <p className="text-xs text-neutral-600 p-2">Abhi koi purani chat nahi.</p>
              ) : (
                sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`group flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm cursor-pointer border ${
                      activeSessionId === s.id
                        ? "bg-neutral-900 border-yellow-700 text-neutral-100"
                        : "border-transparent text-neutral-400 hover:bg-neutral-900"
                    }`}
                    onClick={() => loadSession(s.id)}
                  >
                    <span className="flex-1 truncate">{s.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(s.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-red-400 text-xs"
                      title="Delete"
                    >
                      🗑
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col md:flex-row max-w-6xl w-full mx-auto">
        {/* Chat */}
        <main className="flex-1 flex flex-col min-h-[60vh]">
          <div className="flex-1 overflow-y-auto chat-scroll px-4 py-4 space-y-3">
            {showWelcome && (
              <div className="bg-neutral-900 border gold-border rounded-2xl p-4 text-sm relative">
                <button
                  onClick={() => setWelcomeDismissed(true)}
                  className="absolute top-2 right-3 text-neutral-600 hover:text-neutral-300"
                >
                  ✕
                </button>
                <p className="gold-text font-semibold mb-1">👋 Pehli baar mile ho?</p>
                <p className="text-neutral-300 text-xs leading-relaxed">
                  Apne baare me kuch batao — naam, kaam, pasand, routine. Main sab yaad rakhunga,
                  aur agli baar khud use karunga. Try karo neeche wale chips.
                </p>
              </div>
            )}
            {showBriefing && serverOk && (
              <div className="bg-neutral-900 border gold-border rounded-2xl p-4 text-sm relative">
                <button
                  onClick={dismissBriefing}
                  className="absolute top-2 right-3 text-neutral-600 hover:text-neutral-300"
                >
                  ✕
                </button>
                <p className="gold-text font-semibold mb-1">☀️ Good morning!</p>
                <p className="text-neutral-300 text-xs leading-relaxed mb-2">
                  Aaj ki briefing bana dun — mausam, taaza khabrein, aur tumhari yaadon se priorities?
                </p>
                <button
                  onClick={() => {
                    dismissBriefing();
                    send("Good morning! Mera briefing do.");
                  }}
                  className="bg-yellow-600 hover:bg-yellow-500 text-black font-semibold rounded-xl px-4 py-1.5 text-xs"
                >
                  Briefing banao
                </button>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "text-black font-medium"
                      : "bg-neutral-900 border gold-border text-neutral-100"
                  }`}
                  style={m.role === "user" ? { background: "linear-gradient(135deg,#f6d365,#d4a017)" } : undefined}
                >
                  {m.thinking && (
                    <details className="mb-2 text-xs">
                      <summary className="cursor-pointer text-neutral-500 hover:text-yellow-400">
                        🧠 Yaad ne aise socha
                      </summary>
                      <p className="text-neutral-500 whitespace-pre-wrap mt-1 border-l-2 border-neutral-700 pl-2">
                        {m.thinking}
                      </p>
                    </details>
                  )}
                  {m.image && (
                    <img src={m.image} alt="shared" className="rounded-xl mb-2 max-h-48 object-contain" />
                  )}
                  {m.role === "assistant" ? (
                    <div
                      className="md-body"
                      dangerouslySetInnerHTML={{ __html: renderRich(m.content) }}
                    />
                  ) : (
                    <span>{m.content}</span>
                  )}
                  {m.meta && <div className="text-[10px] text-neutral-500 mt-1">{m.meta}</div>}
                  {m.role === "assistant" && m.content && !busy && (
                    <button
                      onClick={() => speak(m.content, i)}
                      title="Jawab suno"
                      className="text-xs mt-1 text-neutral-600 hover:text-yellow-400"
                    >
                      {speakingIdx === i ? "🔇 rok" : "🔊 suno"}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {busy && status && (
              <div className="flex justify-start">
                <div className="bg-neutral-900 border gold-border rounded-2xl px-4 py-2.5 text-sm text-neutral-400 animate-pulse">
                  {status}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t gold-border p-3">
            {pendingImage && (
              <div className="relative inline-block mb-2">
                <img src={pendingImage} alt="preview" className="h-20 rounded-xl border gold-border" />
                <button
                  onClick={() => setPendingImage(null)}
                  className="absolute -top-2 -right-2 bg-neutral-800 border gold-border rounded-full w-6 h-6 text-xs"
                >
                  ✕
                </button>
              </div>
            )}
            {!busy && messages.length <= 3 && (
              <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
                {QUICK_ACTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="shrink-0 text-xs bg-neutral-900 border gold-border rounded-full px-3 py-1.5 text-neutral-300 hover:border-yellow-500"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
              <button
                onClick={() => fileRef.current?.click()}
                title="Tasveer bhejo — Yaad yaad rakhega"
                className="rounded-xl px-3 py-2.5 text-sm border gold-border bg-neutral-900 text-neutral-300"
              >
                📷
              </button>
              {voiceSupported && (
                <button
                  onClick={toggleVoice}
                  title="Voice input"
                  className={`rounded-xl px-3 py-2.5 text-sm border gold-border ${listening ? "bg-red-900 text-red-200" : "bg-neutral-900 text-neutral-300"}`}
                >
                  {listening ? "●" : "🎙"}
                </button>
              )}
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder={listening ? "Bol rahe ho… sun raha hun" : "Yaad se kuch kaho…"}
                className="flex-1 bg-neutral-900 border gold-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-yellow-500 placeholder:text-neutral-600"
              />
              {busy ? (
                <button
                  onClick={() => abortRef.current?.abort()}
                  title="Jawab rok do"
                  className="rounded-xl px-5 py-2.5 text-sm font-semibold bg-red-950 text-red-200 border border-red-800"
                >
                  ⏹ Rok
                </button>
              ) : (
                <button
                  onClick={() => send()}
                  disabled={!input.trim() && !pendingImage}
                  className="rounded-xl px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg,#f6d365,#d4a017)" }}
                >
                  Bhej
                </button>
              )}
            </div>
            <p className="text-[10px] text-neutral-600 mt-2 text-center">
              Powered by NVIDIA Nemotron on Nebius Token Factory · memory stays on your machine
              {session.tokens > 0 && (
                <span>
                  {" "}· session: {fmtTokens(session.tokens)} tokens
                  {session.costUsd != null && ` · $${session.costUsd.toFixed(4)}`}
                </span>
              )}
            </p>
          </div>
        </main>

        {/* Side panel */}
        <aside className="md:w-80 border-t md:border-t-0 md:border-l gold-border flex flex-col max-h-[40vh] md:max-h-none">
          <div className="flex border-b gold-border">
            {(
              [
                ["memory", `Memory (${memories.length})`],
                ["skills", `Skills (${skills.length})`],
                ["reminders", `Reminders (${reminders.length})`],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider ${
                  tab === t ? "gold-text border-b-2 border-yellow-600" : "text-neutral-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto chat-scroll p-3 space-y-2">
            {tab === "memory" && (
              <>
                <input
                  value={memoryQuery}
                  onChange={(e) => setMemoryQuery(e.target.value)}
                  placeholder="🔍 Yaadon me dhoondo…"
                  className="w-full bg-neutral-900 border gold-border rounded-xl px-3 py-1.5 text-xs outline-none focus:border-yellow-500 placeholder:text-neutral-600 mb-1"
                />
                {filteredMemories.length === 0 ? (
                  <p className="text-xs text-neutral-600 p-2">
                    {memories.length === 0
                      ? "Abhi koi yaad nahi. Mujhse baat karo — main important cheezein khud save kar lunga."
                      : "Kuch nahi mila."}
                  </p>
                ) : (
                  filteredMemories.map((m) => (
                    <div key={m.id} className="bg-neutral-900 border gold-border rounded-xl p-2.5 text-xs">
                      <p className="text-neutral-200">
                        {m.tags.includes("insight") && <span className="mr-1">✨</span>}
                        {m.text}
                      </p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-neutral-600">
                          {m.tags.join(", ")}
                          {m.validTo && <span className="ml-1 text-neutral-500">📜 purani</span>}
                        </span>
                        <button onClick={() => forget(m.id)} className="text-neutral-500 hover:text-red-400">
                          bhula do
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
            {tab === "skills" && (
              <>
                {skills.length === 0 ? (
                  <p className="text-xs text-neutral-600 p-2">
                    Koi skill pack nahi. Neeche URL se install karo ya <code>skills/</code> me markdown files daalo.
                  </p>
                ) : (
                  skills.map((s) => (
                    <div key={s.name} className="bg-neutral-900 border gold-border rounded-xl p-2.5 text-xs">
                      <p className="font-semibold gold-text">{s.name}</p>
                      <p className="text-neutral-400 mt-0.5">{s.description}</p>
                      <p className="text-neutral-600 mt-0.5 italic">{s.when}</p>
                    </div>
                  ))
                )}
                <div className="bg-neutral-900 border gold-border rounded-xl p-2.5 text-xs space-y-2 mt-1">
                  <p className="font-semibold gold-text">＋ URL se skill install karo</p>
                  <input
                    value={skillName}
                    onChange={(e) => setSkillName(e.target.value)}
                    placeholder="naam, jaise workout-coach"
                    className="w-full bg-neutral-800 rounded-lg px-2 py-1.5 text-neutral-200 placeholder:text-neutral-600 outline-none"
                  />
                  <input
                    value={skillUrl}
                    onChange={(e) => setSkillUrl(e.target.value)}
                    placeholder="raw SKILL.md URL (GitHub raw link)"
                    className="w-full bg-neutral-800 rounded-lg px-2 py-1.5 text-neutral-200 placeholder:text-neutral-600 outline-none"
                  />
                  <button
                    onClick={handleInstallSkill}
                    className="w-full bg-yellow-600 hover:bg-yellow-500 text-black font-semibold rounded-lg py-1.5"
                  >
                    Install
                  </button>
                  {skillMsg && <p className="text-neutral-400">{skillMsg}</p>}
                </div>
              </>
            )}
            {tab === "reminders" && (
              <>
                <p className="text-xs text-neutral-600 p-2">
                  “Mujhe kal subah 8 baje yaad dilana” — bolo, Yaad khud reminder laga dega. Tab khula rakho ⏰
                </p>
                {reminders.length === 0 ? (
                  <p className="text-xs text-neutral-600 p-2">Koi active reminder nahi.</p>
                ) : (
                  reminders.map((r) => (
                    <div key={r.id} className="bg-neutral-900 border gold-border rounded-xl p-2.5 text-xs">
                      <p className="text-neutral-200">⏰ {r.text}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-neutral-500">
                          {new Date(r.remindAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                        </span>
                        <button
                          onClick={() => api.reminders.remove(r.id).then(() => api.reminders.list().then(setReminders)).catch(() => {})}
                          className="text-neutral-500 hover:text-red-400"
                        >
                          hatao
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
