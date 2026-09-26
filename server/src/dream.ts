import { config } from "./config.js";
import { currentMems, memoryAdd, type Memory } from "./memory.js";
import { chatComplete } from "./nebius.js";
import { estimateChatCost, recordSpend } from "./spend.js";
import { draftExists, saveDraft } from "./skills.js";

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
      const { message, usage } = await chatComplete({
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
      if (usage) recordSpend(estimateChatCost(usage));
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

/**
 * Skill dreaming — the self-improving step. When the user's memories show a
 * REPEATED workflow (not a one-off fact), draft a reusable SKILL.md pack for it.
 * Drafts are NEVER auto-installed: they land in the drafts inbox and need the
 * user's one-tap approval. That approval gate is the whole point.
 */
export async function dreamSkills(): Promise<{ drafted: string[]; note: string }> {
  if (!config.nebiusApiKey || !config.fastModel) {
    return { drafted: [], note: "" };
  }
  const mems = currentMems().filter((m) => !m.tags.includes("insight") && !m.tags.includes("skill-draft"));
  if (mems.length < 5) return { drafted: [], note: "" };

  const sample = mems
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 25)
    .map((m) => `- ${m.text}`)
    .join("\n");

  let raw = "";
  try {
    const { message, usage } = await chatComplete({
      model: config.fastModel,
      temperature: 0.3,
      maxTokens: 900,
      messages: [
        {
          role: "system",
          content:
            "Tum Yaad ho — ek personal AI jo khud ko improve karta hai. Neeche user ki yaadein hain. " +
            "Agar inme koi DOHRAYA JAANE WALA workflow/routine dikhe (jaise roz subah kuch check karna, " +
            "hafte me ek baar koi report banana), to uske liye ek SKILL PACK draft karo. " +
            "Format EXACTLY:\n---\nname: <short-dash-name>\ndescription: <1 line>\nwhen: <kab use kare>\n---\n<clear instructions, Roman Hindi ok>\n\n" +
            "Rules: max 2 packs; sirf asli repeated pattern par; one-off facts par skill mat banao. " +
            "Agar koi repeated workflow nahi dikhta to exactly likho: NONE. Packs ko '```' se wrap mat karo.",
        },
        { role: "user", content: `YAADEIN:\n${sample}` },
      ],
    });
    if (usage) recordSpend(estimateChatCost(usage));
    raw = (message.content ?? "").trim();
  } catch {
    return { drafted: [], note: "" };
  }
  if (!raw || /^none\.?$/i.test(raw)) return { drafted: [], note: "" };

  // Split on front-matter boundaries: each pack starts with ---\nname:
  const packs = raw.split(/(?=^---\nname:)/m).map((p) => p.trim()).filter(Boolean).slice(0, 2);
  const drafted: string[] = [];
  for (const pack of packs) {
    const nameMatch = pack.match(/^---\nname:\s*([a-z0-9-]+)/m);
    if (!nameMatch) continue;
    const name = nameMatch[1].slice(0, 40);
    if (draftExists(name)) continue;
    const withDraft = pack.replace(/^---\n/, "---\ndraft: true\n");
    if (withDraft.length < 120 || withDraft.length > 8000) continue;
    try {
      saveDraft(name, withDraft);
      await memoryAdd(`Naya skill draft taiyaar: ${name} — approval ka wait kar raha hai.`, ["skill-draft", "dream"], []);
      drafted.push(name);
    } catch {
      /* keep dreaming */
    }
  }
  return { drafted, note: drafted.length ? `${drafted.length} skill draft taiyaar.` : "" };
}
