import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

// Daily spend guard: tracks estimated Nebius spend per calendar day (IST).
// When YAAD_DAILY_CAP_USD is set and today's spend reaches it, chat is
// blocked until tomorrow — your credits can't be drained by accident
// (or by a stranger on the public demo).

function file(): string {
  fs.mkdirSync(config.memoryDir, { recursive: true });
  return path.join(config.memoryDir, "spend.json");
}

interface SpendLog {
  date: string; // YYYY-MM-DD (IST)
  usd: number;
}

function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function load(): SpendLog {
  try {
    const s = JSON.parse(fs.readFileSync(file(), "utf-8")) as SpendLog;
    if (s.date === todayIST()) return s;
  } catch {
    /* start fresh */
  }
  return { date: todayIST(), usd: 0 };
}

function save(s: SpendLog): void {
  fs.writeFileSync(file(), JSON.stringify(s, null, 2), "utf-8");
}

export function todaySpendUsd(): number {
  return load().usd;
}

export function recordSpend(usd: number | null): void {
  if (usd == null || usd <= 0) return;
  const s = load();
  s.usd += usd;
  save(s);
}

/** Throws when the daily cap is set and already reached. */
export function checkBudget(): void {
  const cap = config.dailyCapUsd;
  if (!cap || cap <= 0) return;
  const spent = todaySpendUsd();
  if (spent >= cap) {
    throw new Error(
      `Aaj ka budget ($${cap.toFixed(2)}) khatam ho gaya — kal phir try karo. (kharch: $${spent.toFixed(4)})`
    );
  }
}
