import { useEffect, useRef, useState } from "react";
import { api, type Memory, type Skill } from "./api";

interface Msg {
  role: "user" | "assistant";
  content: string;
  meta?: string;
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
  const [memories, setMemories] = useState<Memory[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tab, setTab] = useState<"memory" | "skills">("memory");
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.health().then(() => setServerOk(true)).catch(() => setServerOk(false));
    api.memories().then(setMemories).catch(() => {});
    api.skills().then(setSkills).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const refreshMemories = () => api.memories().then(setMemories).catch(() => {});

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((p) => [...p, { role: "user", content: text }]);
    setBusy(true);
    try {
      const turn = await api.chat(text, history);
      setMessages((p) => [
        ...p,
        { role: "assistant", content: turn.reply, meta: `${turn.model.split("/").pop()} · ${turn.steps} steps` },
      ]);
      refreshMemories();
    } catch (e) {
      setMessages((p) => [
        ...p,
        { role: "assistant", content: `Server se baat nahi ho payi: ${(e as Error).message}` },
      ]);
    } finally {
      setBusy(false);
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
            {busy && (
              <div className="flex justify-start">
                <div className="bg-neutral-900 border gold-border rounded-2xl px-4 py-2.5 text-sm text-neutral-400">
                  soch raha hun…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t gold-border p-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Yaad se kuch kaho…"
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
