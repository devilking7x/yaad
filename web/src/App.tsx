import { useEffect, useRef, useState } from "react";
import { api, chatStream, type Memory, type Skill } from "./api";

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
  see_image: "tasveer dekh raha hun…",
};

const QUICK_ACTIONS = [
  "Mere baare me kya yaad hai tumhe?",
  "Good morning! Mera briefing do.",
  "Aaj ki top tech news batao.",
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
  const [tab, setTab] = useState<"memory" | "skills">("memory");
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
          patch((m) => ({ ...m, content: e.reply || acc, meta: bits.join(" · ") }));
          setSession((s) => ({
            tokens: s.tokens + e.usage.total_tokens,
            costUsd: s.costUsd == null && e.costUsd == null ? null : (s.costUsd ?? 0) + (e.costUsd ?? 0),
          }));
          setStatus("");
          refreshMemories();
        } else if (e.type === "error") {
          patch((m) => ({ ...m, content: `Server se baat nahi ho payi: ${e.error}` }));
          setStatus("");
        }
      },
        img ?? undefined
      );
    } catch (err) {
      patch((m) => ({ ...m, content: `Server se baat nahi ho payi: ${(err as Error).message}` }));
    } finally {
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
        <div>
          <h1 className="text-2xl font-bold gold-text tracking-tight">Yaad</h1>
          <p className="text-xs text-neutral-400">your personal AI that remembers</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
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
                  {m.content}
                  {m.meta && <div className="text-[10px] text-neutral-500 mt-1">{m.meta}</div>}
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
              <button
                onClick={() => send()}
                disabled={busy || (!input.trim() && !pendingImage)}
                className="rounded-xl px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-40"
                style={{ background: "linear-gradient(135deg,#f6d365,#d4a017)" }}
              >
                Bhej
              </button>
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
            {(["memory", "skills"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider ${
                  tab === t ? "gold-text border-b-2 border-yellow-600" : "text-neutral-500"
                }`}
              >
                {t === "memory" ? `Memory (${memories.length})` : `Skills (${skills.length})`}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto chat-scroll p-3 space-y-2">
            {tab === "memory" &&
              (memories.length === 0 ? (
                <p className="text-xs text-neutral-600 p-2">
                  Abhi koi yaad nahi. Mujhse baat karo — main important cheezein khud save kar lunga.
                </p>
              ) : (
                memories.map((m) => (
                  <div key={m.id} className="bg-neutral-900 border gold-border rounded-xl p-2.5 text-xs">
                    <p className="text-neutral-200">{m.text}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-neutral-600">{m.tags.join(", ")}</span>
                      <button onClick={() => forget(m.id)} className="text-neutral-500 hover:text-red-400">
                        bhula do
                      </button>
                    </div>
                  </div>
                ))
              ))}
            {tab === "skills" &&
              (skills.length === 0 ? (
                <p className="text-xs text-neutral-600 p-2">
                  Koi skill pack nahi. <code>skills/</code> me markdown files daalo.
                </p>
              ) : (
                skills.map((s) => (
                  <div key={s.name} className="bg-neutral-900 border gold-border rounded-xl p-2.5 text-xs">
                    <p className="font-semibold gold-text">{s.name}</p>
                    <p className="text-neutral-400 mt-0.5">{s.description}</p>
                    <p className="text-neutral-600 mt-0.5 italic">{s.when}</p>
                  </div>
                ))
              ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
