import { atomicWriteFile } from "./fsutil.js";
// Yaad Proactive Engine — the agent wakes up on its own.
// Every poll decides: is there something worth telling the user RIGHT NOW?
//   1. due reminders  2. morning briefing window  3. unseen dream insights
// Nudges are idempotent (seen-state), cheap (no model calls), and offline-safe.

import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { dream, dreamSkills } from "./dream.js";
import { checkBudget } from "./spend.js";
import { listDrafts } from "./skills.js";
import { listJobs } from "./jobs.js";
import { memoryList } from "./memory.js";
import { listReminders } from "./reminders.js";

export type NudgeKind = "reminder" | "briefing" | "insight" | "skill-draft" | "job-done";
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
    atomicWriteFile(stateFile(), JSON.stringify(s, null, 2), "utf-8");
  } catch {
    /* never break a request */
  }
}

function today(): string {
  // M8 fix: server runs on UTC — use IST like spend.ts does, otherwise the
  // "morning briefing" fires till 5:30pm IST and the date rolls over wrong.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function hourIST(): number {
  // M8 fix: hour in Asia/Kolkata, not server-local (UTC on Render).
  // (% 24 guards the "24" that hour12:false yields at midnight.)
  return (
    Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false })) % 24
  );
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

  // 2. Morning briefing — once per day, before noon IST, only if there's a brain
  const hour = hourIST();
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

  // 3b. Unapproved skill drafts — Yaad dreamed up a new capability
  for (const d of listDrafts().slice(0, 2)) {
    const id = `skill:${d.name}`;
    if (!seen.has(id)) {
      out.push({
        id,
        kind: "skill-draft",
        text: `✨ Naya skill taiyaar: ${d.name} — ${d.description.slice(0, 80)}`,
        createdAt: now,
        action: "open-skills",
        refId: d.name,
      });
    }
  }

  // 2b. Finished background jobs the user hasn't seen yet
  for (const j of listJobs().filter((x) => x.status !== "running" && !x.seen).slice(0, 3)) {
    const id = `job:${j.id}`;
    if (!seen.has(id)) {
      out.push({
        id,
        kind: "job-done",
        text:
          j.status === "done"
            ? `🔍 Research taiyaar: ${j.query.slice(0, 80)}`
            : `⚠️ Research fail ho gaya: ${j.query.slice(0, 80)}`,
        createdAt: now,
        action: "open-jobs",
        refId: j.id,
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
  try {
    // M5 fix: dream() + dreamSkills() burn model calls — the budget guard must
    // run first, else auto-dreams spend past the daily cap. A capped budget
    // just skips this dream cycle (checked again on the next poll).
    checkBudget();
  } catch {
    return;
  }
  const st = loadState();
  const count = memoryList().length;
  if (count - st.memCountAtDream < 5) return;
  dreaming = true;
  // dream() writes via memoryAdd, which serializes internally; the `dreaming`
  // flag is enough to prevent overlapping runs.
  dream()
    .then(() => dreamSkills())
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
