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

/**
 * Install a skill pack from a URL (e.g. a raw SKILL.md on GitHub).
 * Validates the front-matter, then saves it into the skills directory.
 */
export async function installSkill(name: string, url: string): Promise<Skill> {
  const clean = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!clean) throw new Error("Give the skill a valid name (letters, numbers, dashes)");
  if (!/^https?:\/\//i.test(url)) throw new Error("URL must start with http(s)");
  const res = await fetch(url, { headers: { "User-Agent": "yaad/1.0" } });
  if (!res.ok) throw new Error(`Could not fetch that URL (HTTP ${res.status})`);
  const md = await res.text();
  const skill = parseSkill(`${clean}.md`, md);
  if (!skill || !skill.instructions || skill.instructions.length < 50) {
    throw new Error("That URL doesn't look like a skill pack (needs front-matter + instructions)");
  }
  // Rewrite the front-matter name so it matches the installed filename (no duplicates).
  const stamped = md.replace(/^name:\s*.*$/m, `name: ${clean}`);
  const dir = path.resolve(config.skillsDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${clean}.md`), stamped, "utf-8");
  return { ...skill, name: clean };
}
