import { atomicWriteFile } from "./fsutil.js";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { logSecurity, safeFetch } from "./security.js";

/**
 * Read a response body as text, aborting the moment the byte cap is exceeded.
 * Used where an attacker-controlled server could otherwise stream an
 * unbounded body and OOM the process before we ever slice it.
 */
export async function readCappedText(res: Response, maxBytes: number): Promise<string> {
  const body = res.body;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new Error(`Response body bahut bada hai (${Math.round(maxBytes / 1024)}KB se zyada)`);
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

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
  draft: boolean;
}

function cleanName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

function parseSkill(file: string, raw: string): Skill | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const header = m[1];
  const get = (k: string): string => {
    const line = header.split("\n").find((l) => l.startsWith(`${k}:`));
    return line ? line.slice(k.length + 1).trim() : "";
  };
  const name = get("name") || path.basename(file, ".md").replace(/^_draft-/, "");
  return {
    name,
    description: get("description"),
    when: get("when"),
    instructions: m[2].trim(),
    draft: /^draft:\s*true$/m.test(header),
  };
}

function readAll(): Array<{ file: string; skill: Skill }> {
  const dir = path.resolve(config.skillsDir);
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ file: string; skill: Skill }> = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const skill = parseSkill(f, fs.readFileSync(path.join(dir, f), "utf-8"));
    if (skill) out.push({ file: f, skill });
  }
  return out;
}

/** Active skills only — drafts are never runnable until approved. */
export function listSkills(): Skill[] {
  return readAll().filter((s) => !s.skill.draft).map((s) => s.skill);
}

/** Draft inbox: skills Yaad dreamed up, waiting for the user's approval. */
export function listDrafts(): Skill[] {
  return readAll().filter((s) => s.skill.draft).map((s) => s.skill);
}

export function getSkill(name: string): Skill | undefined {
  return listSkills().find((s) => s.name === name);
}

export function draftExists(name: string): boolean {
  const clean = cleanName(name);
  return readAll().some((s) => s.skill.name === clean);
}

/** Save a model-drafted skill pack into the drafts inbox (not runnable). */
export function saveDraft(name: string, md: string): void {
  const clean = cleanName(name);
  if (!clean) throw new Error("Invalid draft name");
  const dir = path.resolve(config.skillsDir);
  fs.mkdirSync(dir, { recursive: true });
  atomicWriteFile(path.join(dir, `_draft-${clean}.md`), md, "utf-8");
}

/** Approve a draft: it becomes a real, runnable skill. */
export function approveDraft(name: string): Skill {
  const clean = cleanName(name);
  const dir = path.resolve(config.skillsDir);
  const found = readAll().find((s) => s.skill.draft && s.skill.name === clean);
  if (!found) throw new Error("Draft nahi mila");
  const raw = fs.readFileSync(path.join(dir, found.file), "utf-8");
  const active = raw.replace(/^draft:\s*true\n/m, "");
  atomicWriteFile(path.join(dir, `${clean}.md`), active, "utf-8");
  fs.unlinkSync(path.join(dir, found.file));
  const skill = parseSkill(`${clean}.md`, active);
  if (!skill) throw new Error("Draft corrupt nikla");
  return skill;
}

export function discardDraft(name: string): boolean {
  const clean = cleanName(name);
  const dir = path.resolve(config.skillsDir);
  const found = readAll().find((s) => s.skill.draft && s.skill.name === clean);
  if (!found) return false;
  fs.unlinkSync(path.join(dir, found.file));
  return true;
}

/**
 * Install a skill pack from a URL (e.g. a raw SKILL.md on GitHub).
 * Validates the front-matter, then saves it into the skills directory.
 */
export async function installSkill(name: string, url: string): Promise<Skill> {
  const clean = cleanName(name);
  if (!clean) throw new Error("Give the skill a valid name (letters, numbers, dashes)");
  // SSRF guard: safeFetch validates the URL AND every redirect hop,
  // so a 302 to an internal address can never slip through.
  const res = await safeFetch(url, {
    headers: { "User-Agent": "yaad/1.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Could not fetch that URL (HTTP ${res.status})`);
  const ctype = res.headers.get("content-type") ?? "";
  if (ctype && !/^text\//i.test(ctype)) {
    throw new Error(`Wo skill pack nahi lagta (content-type: ${ctype.split(";")[0]})`);
  }
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > 200_000) throw new Error("Skill pack bahut bada hai (200KB se zyada)");
  // M3 fix: the old `(await res.text()).slice(0, 200_000)` buffered the ENTIRE
  // body first — a chunked stream with a lying/absent content-length could OOM
  // the 512MB instance. Read with a running byte cap instead.
  const md = await readCappedText(res, 200_000);
  const skill = parseSkill(`${clean}.md`, md);
  if (!skill || !skill.instructions || skill.instructions.length < 50) {
    throw new Error("That URL doesn't look like a skill pack (needs front-matter + instructions)");
  }
  // Rewrite the front-matter name so it matches the installed filename (no duplicates).
  const stamped = md.replace(/^name:\s*.*$/m, `name: ${clean}`);
  const dir = path.resolve(config.skillsDir);
  fs.mkdirSync(dir, { recursive: true });
  atomicWriteFile(path.join(dir, `${clean}.md`), stamped, "utf-8");
  return { ...skill, name: clean };
}
