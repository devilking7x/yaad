import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

// Reminders: "mujhe kal subah 8 baje yaad dilana".
// Stored server-side; the web app polls and fires browser notifications.

export interface Reminder {
  id: string;
  text: string;
  remindAt: string; // ISO 8601
  createdAt: string;
  done: boolean;
}

function file(): string {
  fs.mkdirSync(config.memoryDir, { recursive: true });
  return path.join(config.memoryDir, "reminders.json");
}

function load(): Reminder[] {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf-8")) as Reminder[];
  } catch {
    return [];
  }
}

function save(all: Reminder[]): void {
  fs.writeFileSync(file(), JSON.stringify(all, null, 2), "utf-8");
}

const uid = (): string =>
  `rem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export function addReminder(text: string, remindAt: string): Reminder {
  const d = new Date(remindAt);
  if (isNaN(d.getTime())) throw new Error(`Could not parse time: ${remindAt}`);
  const r: Reminder = {
    id: uid(),
    text,
    remindAt: d.toISOString(),
    createdAt: new Date().toISOString(),
    done: false,
  };
  const all = load();
  all.push(r);
  save(all);
  return r;
}

export function listReminders(): Reminder[] {
  return load().sort((a, b) => a.remindAt.localeCompare(b.remindAt));
}

export function completeReminder(id: string): boolean {
  const all = load();
  const r = all.find((x) => x.id === id);
  if (!r) return false;
  r.done = true;
  save(all);
  return true;
}

export function deleteReminder(id: string): boolean {
  const all = load();
  const next = all.filter((x) => x.id !== id);
  if (next.length === all.length) return false;
  save(next);
  return true;
}
