import { useState } from "react";
import type { Memory } from "./api";

/** Memory Timeline — Yaad ne kab kya yaad rakha, ek nazar me.
 *  Superseded ("purani") memories are kept as history, never deleted:
 *  this is the visual proof of "the AI that never forgets". */

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(key: string): string {
  const [y, mo, d] = key.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  const today = new Date();
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (dayKey(dt) === dayKey(today)) return "Aaj";
  if (dayKey(dt) === dayKey(yest)) return "Kal";
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function Timeline({
  memories,
  query,
  onForget,
}: {
  memories: Memory[];
  query: string;
  onForget: (id: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "current" | "old">("all");
  const q = query.toLowerCase();

  const current = memories.filter((m) => !m.validTo);
  const old = memories.filter((m) => m.validTo);

  const filtered = memories.filter(
    (m) =>
      (filter === "all" || (filter === "current" ? !m.validTo : !!m.validTo)) &&
      `${m.text} ${m.tags.join(" ")}`.toLowerCase().includes(q)
  );

  const groups = new Map<string, Memory[]>();
  for (const m of filtered) {
    const k = dayKey(new Date(m.createdAt));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(m);
  }
  const days = [...groups.keys()].sort().reverse();

  return (
    <div>
      {/* Stats + filter chips */}
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        {(
          [
            ["all", `Sab (${memories.length})`],
            ["current", `🧠 Maujooda (${current.length})`],
            ["old", `📜 Purani (${old.length})`],
          ] as const
        ).map(([f, label]) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[11px] px-2 py-1 rounded-full border ${
              filter === f
                ? "bg-yellow-600/20 text-yellow-300 border-yellow-600/60"
                : "text-neutral-500 border-neutral-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {days.length === 0 ? (
        <div className="text-center py-8 px-4">
          <p className="text-3xl mb-2">📅</p>
          <p className="text-xs text-neutral-500 leading-relaxed">
            {memories.length === 0
              ? <>Abhi koi yaad nahi.<br />Mujhse baat karo — main important cheezein khud save kar lunga.</>
              : "Kuch nahi mila."}
          </p>
        </div>
      ) : (
        days.map((day) => (
          <div key={day} className="mb-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-bold gold-text uppercase tracking-wide">{dayLabel(day)}</span>
              <span className="text-[10px] text-neutral-600">{groups.get(day)!.length} yaadein</span>
              <div className="flex-1 h-px bg-yellow-600/20" />
            </div>
            <div className="relative ml-1.5 pl-4 border-l border-yellow-600/40 space-y-2">
              {groups.get(day)!.map((m) => {
                const isOld = !!m.validTo;
                return (
                  <div key={m.id} className="relative">
                    <span
                      className={`absolute -left-[21px] top-3 h-2.5 w-2.5 rounded-full border ${
                        isOld ? "bg-neutral-800 border-neutral-600" : "bg-yellow-500 border-yellow-300"
                      }`}
                    />
                    <div
                      className={`rounded-xl p-2.5 text-xs border ${
                        isOld ? "bg-neutral-950 border-neutral-800 opacity-70" : "bg-neutral-900 gold-border"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className={isOld ? "text-neutral-500 line-through decoration-neutral-700" : "text-neutral-200"}>
                          {m.tags.includes("insight") && <span className="mr-1">✨</span>}
                          {m.text}
                        </p>
                        <span className="text-[10px] text-neutral-600 whitespace-nowrap">{timeOf(m.createdAt)}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-neutral-600">
                          {m.tags.join(", ")}
                          {isOld && <span className="ml-1 text-yellow-600/80">📜 purani — ab ye badal chuki</span>}
                        </span>
                        <button onClick={() => onForget(m.id)} className="text-neutral-500 hover:text-red-400">
                          bhula do
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
      {old.length > 0 && filter === "all" && (
        <p className="text-[10px] text-neutral-600 text-center px-4 pb-2">
          📜 Purani yaadein delete nahi hoti — sirf retire hoti hain. Isiliye Yaad kabhi bhoolta nahi.
        </p>
      )}
    </div>
  );
}
