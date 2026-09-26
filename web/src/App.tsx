import { useEffect, useRef, useState } from "react";
import { api, chatStream, type Memory, type Skill } from "./api";

interface Msg {
  role: "user" | "assistant";
  content: string;
  meta?: string;
}

interface SessionUsage {
  tokens: number;
  costUsd: number | null;
}

const TOOL_LABELS: Record<string, string> = {
  remember: "yaad kar raha hun…",
  recall: "yaadein dhoondh raha hun…",
  web_search: "web pe dekh raha hun…",
  run_skill: "skill chala raha hun…",
};

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
  const bottomRef = useRef<HTMLDivElement>(null);
  const recogRef = useRef<any>(null);

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
    if (!SR) {
      setInput((p) => p); // no-op; button hidden when unsupported (see below)
      return;
    }
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

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((p) => [...p, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setBusy(true);
    setStatus("soch raha hun…");
    const idx = messages.length + 1; // index of the placeholder assistant message

    const patch = (content: string, meta?: string) =>
      setMessages((p) => p.map((m, i) => (i === idx ? { ...m, content, meta: meta ?? m.meta } : m)));

    try {
      let acc = "";
      await chatStream(text, history, (e) => {
        if (e.type === "token") {
          acc += e.token;
          patch(acc);
          setStatus("");
        } else if (e.type === "tool") {
          setStatus(TOOL_LABELS[e.name] ?? `${e.name}…`);
        } else if (e.type === "done") {
          const bits = [`${shortModel(e.model)}`, `${e.steps} steps`, `${fmtTokens(e.usage.total_tokens)} tokens`];
          if (e.costUsd != null) bits.push(`$${e.costUsd.toFixed(4)}`);
          patch(e.reply || acc, bits.join(" · "));
          setSession((s) => ({
            tokens: s.tokens + e.usage.total_tokens,
            costUsd: s.costUsd == null && e.costUsd == null ? null : (s.costUsd ?? 0) + (e.costUsd ?? 0),
          }));
          setStatus("");
          refreshMemories();
        } else if (e.type === "error") {
          patch(`Server se baat nahi ho payi: ${e.error}`);
          setStatus("");
        }
      });
    } catch (err) {
      patch(`Server se baat nahi ho payi: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  async function forget(id: string) {
    await api.deleteMemory(id).catch(() => {});
    refreshMemories();
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0f" }}>
      {/* Header */}
      <header className="border-b gold-border px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold gold-text tracking-tight">Yaad</h1>
          <p className="text-xs text-neutral-400">your personal AI that remembers</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
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
            <div className="flex gap-2">
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
                onClick={send}
                disabled={busy || !input.trim()}
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
