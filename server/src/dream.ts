import { config } from "./config.js";
import { currentMems, memoryAdd, type Memory } from "./memory.js";
import { chatComplete } from "./nebius.js";

// "Dreaming" — background memory consolidation (OpenClaw Dreaming / Letta
// sleep-time pattern): cluster related memories, and when a cluster has
// enough members (promotion gate: >= 3), synthesize one higher-level
// insight memory from it. Insights are tagged so the UI can badge them.

const PROMOTION_GATE = 3; // min related memories to form an insight
const MAX_DREAMS = 3; // max insights per run

function clusterKey(m: Memory): string[] {
  const keys = m.entities.filter((e) => e && e !== "auto");
  for (const t of m.tags) {
    if (t && t !== "auto" && t !== "insight" && t !== "dream") keys.push(`tag:${t}`);
  }
  return keys;
}

export async function dream(): Promise<{ insights: string[]; note: string }> {
  if (!config.nebiusApiKey || !config.fastModel) {
    return { insights: [], note: "Sapne dekhne ke liye NEBIUS_API_KEY chahiye." };
  }
  const mems = currentMems().filter((m) => !m.tags.includes("insight"));
  if (mems.length < PROMOTION_GATE) {
    return { insights: [], note: `Abhi sirf ${mems.length} yaadein hain — kam se kam ${PROMOTION_GATE} chahiye.` };
  }

  const clusters = new Map<string, Memory[]>();
  for (const m of mems) {
    for (const key of clusterKey(m)) {
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key)!.push(m);
    }
  }
  // Biggest clusters first; skip clusters already fully covered by an insight.
  const existing = new Set(currentMems().filter((m) => m.tags.includes("insight")).map((m) => m.entities.join("|")));
  const candidates = [...clusters.entries()]
    .filter(([key, g]) => g.length >= PROMOTION_GATE && !existing.has(key))
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_DREAMS);

  const insights: string[] = [];
  for (const [key, group] of candidates) {
    try {
      const { message } = await chatComplete({
        model: config.fastModel,
        temperature: 0.4,
        maxTokens: 220,
        messages: [
          {
            role: "system",
            content:
              "Tum Yaad ho — ek personal AI. Neeche user ki kuch yaadein hain jo ek dusre se judi hain. " +
              "Inse ek chhota, gehra insight nikalo (1-2 lines, Roman Hindi me, user ko 'tum' kehkar). " +
              "Sirf insight likho, koi intro/outro nahi. Agar koi asli pattern nahi dikhta to exactly likho: NONE",
          },
          {
            role: "user",
            content: `THEME: ${key.replace(/^tag:/, "")}\n\nYAADEIN:\n${group.slice(0, 12).map((m) => `- ${m.text}`).join("\n")}`,
          },
        ],
      });
      const text = (message.content ?? "").trim();
      if (text && text !== "NONE" && text.length > 10) {
        await memoryAdd(`💭 ${text}`, ["insight", "dream"], [key.replace(/^tag:/, "")]);
        insights.push(text);
      }
    } catch {
      /* one bad cluster must not kill the dream */
    }
  }
  return {
    insights,
    note: insights.length
      ? `${insights.length} naye insight mile.`
      : "Is baar koi naya pattern nahi mila — agle sapne me phir koshish karenge.",
  };
}
