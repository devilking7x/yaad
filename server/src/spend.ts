import { atomicWriteFile } from "./fsutil.js";
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
  atomicWriteFile(file(), JSON.stringify(s, null, 2), "utf-8");
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

// --- Cost estimation ---------------------------------------------------------
// H2 fix: previously estimateCost() returned null when prices were unset, so
// recordSpend() was a silent no-op and the daily cap NEVER tripped. Now the
// estimators always return a number: real prices when configured, conservative
// (deliberately high) fallbacks otherwise — the cap fails safe, never blind.

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

// Conservative $/1M tokens when NEBIUS_PRICE_*_PER_1M are unset. These sit
// ABOVE typical Token Factory prices for the Nemotron lineup, so the daily
// cap trips early rather than late. Set the real env prices for accuracy.
const FALLBACK_PRICE_INPUT_PER_1M = 1.0;
const FALLBACK_PRICE_OUTPUT_PER_1M = 3.0;
const FALLBACK_PRICE_EMBED_PER_1M = 0.2;

/** Estimated USD for a chat completion's token usage. Never null. */
export function estimateChatCost(usage: TokenUsage): number {
  const in1M = config.priceInputPer1M || FALLBACK_PRICE_INPUT_PER_1M;
  const out1M = config.priceOutputPer1M || FALLBACK_PRICE_OUTPUT_PER_1M;
  return (
    (usage.prompt_tokens / 1e6) * in1M + (usage.completion_tokens / 1e6) * out1M
  );
}

/** Estimated USD for embedding a batch of texts (~4 chars/token heuristic). */
export function estimateEmbedCost(texts: string[]): number {
  const tokens = texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0);
  const per1M = config.priceEmbedPer1M || FALLBACK_PRICE_EMBED_PER_1M;
  return (tokens / 1e6) * per1M;
}

// --- In-flight reservations (M2 fix: TOCTOU) ----------------------------------
// checkBudget() runs at turn start, recordSpend() at turn end. With 30 parallel
// /api/chat requests, all 30 could pass the check before any recorded spend.
// Each turn reserves a conservative estimate up front (released in `finally`),
// so concurrent turns see each other's reservations. Single-threaded event
// loop => reserve/check is atomic.

let inflightReserveUsd = 0;

/** Conservative max cost of one chat turn (covers a 120B reasoning turn). */
export const TURN_RESERVE_USD = 0.05;

export function reserveSpend(usd: number): void {
  inflightReserveUsd += usd;
}

export function releaseSpend(usd: number): void {
  inflightReserveUsd = Math.max(0, inflightReserveUsd - usd);
}

/** Throws when the daily cap is set and already reached. */
export function checkBudget(): void {
  const cap = config.dailyCapUsd;
  if (!cap || cap <= 0) return;
  const spent = todaySpendUsd() + inflightReserveUsd;
  if (spent >= cap) {
    throw new Error(
      `Aaj ka budget ($${cap.toFixed(2)}) khatam ho gaya — kal phir try karo. (kharch: $${spent.toFixed(4)})`
    );
  }
}
