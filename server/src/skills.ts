import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

// Skill packs: markdown files with a small front-matter header.
// Format:
//   ---
//   name: morning-briefing
//   description: Daily briefing: weather, calendar, top tasks.
//   when: Use when the user asks for a briefing or says "good morning".
//   ---
//   <instructions the agent should follow when the skill runs>

export interface Skill {
  name: string;
  description: string;
  when: string;
  instructions: string;
}

function parseSkill(file: string, raw: string): Skill | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const header = m[1];
  const get = (k: string): string => {
    const line = header.split("\n").find((l) => l.startsWith(`${k}:`));
    return line ? line.slice(k.length + 1).trim() : "";
  };
  const name = get("name") || path.basename(file, ".md");
  return { name, description: get("description"), when: get("when"), instructions: m[2].trim() };
}

export function listSkills(): Skill[] {
  const dir = path.resolve(config.skillsDir);
  if (!fs.existsSync(dir)) return [];
  const out: Skill[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const skill = parseSkill(f, fs.readFileSync(path.join(dir, f), "utf-8"));
    if (skill) out.push(skill);
  }
  return out;
}

export function getSkill(name: string): Skill | undefined {
  return listSkills().find((s) => s.name === name);
}
