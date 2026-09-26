// Yaad Proactive Engine — the agent wakes up on its own.
// Every poll decides: is there something worth telling the user RIGHT NOW?
//   1. due reminders  2. morning briefing window  3. unseen dream insights
// Nudges are idempotent (seen-state), cheap (no model calls), and offline-safe.

import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { dream } from "./dream.js";
import { memoryList } from "./memory.js";
import { listReminders } from "./reminders.js";

export type NudgeKind = "reminder" | "briefing" | "insight";
export interface Nudge {
  id: string;
  kind: NudgeKind;
  text: string;
  createdAt: string;
  /** what the UI should do on tap: done-reminder | send-briefing | open-memory */
  action: string;
  refId?: string;
}

interface ProactiveState {
  lastBriefingDate: string; // YYYY-MM-DD
  seenNudgeIds: string[];
  memCountAtDream: number;
  lastDreamAt: string;
}

function stateFile(): string {
  return path.join(config.memoryDir, "proactive.json");
}

function loadState(): ProactiveState {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), "utf-8")) as Partial<ProactiveState>;
    return {
      lastBriefingDate: s.lastBriefingDate ?? "",
      seenNudgeIds: Array.isArray(s.seenNudgeIds) ? s.seenNudgeIds.slice(-200) : [],
      memCountAtDream: s.memCountAtDream ?? 0,
      lastDreamAt: s.lastDreamAt ?? "",
    };
  } catch {
    return { lastBriefingDate: "", seenNudgeIds: [], memCountAtDream: 0, lastDreamAt: "" };
  }
}

function saveState(s: ProactiveState): void {
  try {
    fs.mkdirSync(config.memoryDir, { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2), "utf-8");
  } catch {
    /* never break a request */
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** All nudges worth showing right now. Pure computation — no model calls. */
export function computeNudges(): Nudge[] {
  const st = loadState();
  const seen = new Set(st.seenNudgeIds);
  const out: Nudge[] = [];
  const now = new Date().toISOString();

  // 1. Due reminders (not done, time passed)
  for (const r of listReminders()) {
    if (!r.done && r.remindAt <= now) {
      const id = `rem:${r.id}`;
      if (!seen.has(id)) {
        out.push({
          id,
          kind: "reminder",
          text: `⏰ ${r.text}`,
          createdAt: now,
          action: "done-reminder",
          refId: r.id,
        });
      }
    }
  }

  // 2. Morning briefing — once per day, before noon, only if there's a brain
  const hour = new Date().getHours();
  if (hour < 12 && st.lastBriefingDate !== today() && memoryList().length > 0) {
    const id = `brief:${today()}`;
    if (!seen.has(id)) {
      out.push({
        id,
        kind: "briefing",
        text: "☀️ Good morning! Aaj ka briefing banau?",
        createdAt: now,
        action: "send-briefing",
      });
    }
  }

  // 3. Unseen dream insights (newest 3)
  const insights = memoryList()
    .filter((m) => m.tags.includes("insight"))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);
  for (const ins of insights) {
    const id = `insight:${ins.id}`;
    if (!seen.has(id)) {
      out.push({
        id,
        kind: "insight",
        text: `💤 Naya insight: ${ins.text.slice(0, 120)}${ins.text.length > 120 ? "…" : ""}`,
        createdAt: now,
        action: "open-memory",
        refId: ins.id,
      });
    }
  }

  return out;
}

export function markNudgesSeen(ids: string[]): void {
  if (!ids.length) return;
  const st = loadState();
  const set = new Set(st.seenNudgeIds);
  for (const id of ids.slice(0, 50)) set.add(String(id).slice(0, 120));
  st.seenNudgeIds = [...set].slice(-200);
  saveState(st);
}

export function markBriefingOffered(): void {
  const st = loadState();
  st.lastBriefingDate = today();
  saveState(st);
}

/**
 * Auto-dream: when enough NEW memories piled up since the last dream run,
 * consolidate them in the background. Needs the fast model; silently skips
 * offline. Called opportunistically (nudge polls), never blocks a request.
 */
let dreaming = false;
export function maybeAutoDream(): void {
  if (dreaming || !config.fastModel) return;
  const st = loadState();
  const count = memoryList().length;
  if (count - st.memCountAtDream < 5) return;
  dreaming = true;
  // dream() writes via memoryAdd, which serializes internally; the `dreaming`
  // flag is enough to prevent overlapping runs.
  dream()
    .then(() => {
      const s2 = loadState();
      s2.memCountAtDream = memoryList().length;
      s2.lastDreamAt = new Date().toISOString();
      saveState(s2);
    })
    .catch(() => {
      /* dreaming must never break anything */
    })
    .finally(() => {
      dreaming = false;
    });
}
