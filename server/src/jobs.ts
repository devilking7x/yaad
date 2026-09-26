// Background jobs (Codex-style): long work runs on its own while the user
// does other things. When it finishes, the proactive engine nudges the user.
// Currently: deep_research in the background. Jobs persist in jobs.json.

import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { deepResearch } from "./tavily.js";
import { checkBudget } from "./spend.js";

export interface Job {
  id: string;
  kind: "deep_research";
  query: string;
  status: "running" | "done" | "failed";
  createdAt: string;
  finishedAt: string | null;
  summary: string | null;
  sources: string[];
  error: string | null;
  seen: boolean;
}

const MAX_JOBS = 20;
// H3 fix: cap CONCURRENTLY RUNNING jobs, not just stored records. Each job =
// planner LLM call + up to 4 parallel Tavily searches + extracts + synthesis.
// Without this, one chat turn could spawn several jobs and 30 req/min could
// keep dozens of detached jobs burning Nebius credits + Tavily quota.
const MAX_RUNNING_JOBS = 3;

function jobsFile(): string {
  return path.join(config.memoryDir, "jobs.json");
}

function loadJobs(): Job[] {
  try {
    const j = JSON.parse(fs.readFileSync(jobsFile(), "utf-8")) as Job[];
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function saveJobs(jobs: Job[]): void {
  try {
    fs.mkdirSync(config.memoryDir, { recursive: true });
    fs.writeFileSync(jobsFile(), JSON.stringify(jobs.slice(0, MAX_JOBS), null, 2), "utf-8");
  } catch {
    /* never break */
  }
}

function updateJob(id: string, patch: Partial<Job>): void {
  const jobs = loadJobs();
  const i = jobs.findIndex((j) => j.id === id);
  if (i >= 0) {
    jobs[i] = { ...jobs[i], ...patch };
    saveJobs(jobs);
  }
}

/**
 * Start deep research in the background. Returns immediately with the job;
 * the research runs detached and the job record is updated on completion.
 * The proactive engine picks up finished, unseen jobs and nudges the user.
 */
export function startResearchJob(query: string): Job {
  // H3 fix: background research used to bypass the budget guard entirely.
  checkBudget();
  const running = loadJobs().filter((j) => j.status === "running").length;
  if (running >= MAX_RUNNING_JOBS) {
    throw new Error(
      `Abhi ${MAX_RUNNING_JOBS} research jobs chal rahe hain — thoda ruk kar phir try karo.`
    );
  }
  const q = String(query ?? "").slice(0, 300).trim();
  if (!q) throw new Error("Research ke liye koi query nahi di.");
  const job: Job = {
    id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    kind: "deep_research",
    query: q,
    status: "running",
    createdAt: new Date().toISOString(),
    finishedAt: null,
    summary: null,
    sources: [],
    error: null,
    seen: false,
  };
  const jobs = loadJobs();
  jobs.unshift(job);
  saveJobs(jobs);

  // Detached: never blocks the chat turn.
  deepResearch(q).then(
    (r) => {
      updateJob(job.id, {
        status: "done",
        finishedAt: new Date().toISOString(),
        summary: r.summary,
        sources: r.sources,
      });
    },
    (e: Error) => {
      updateJob(job.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: e.message?.slice(0, 300) ?? "Research fail ho gaya.",
      });
    }
  );

  return job;
}

export function listJobs(): Job[] {
  return loadJobs();
}

export function markJobSeen(id: string): boolean {
  const jobs = loadJobs();
  const j = jobs.find((x) => x.id === String(id));
  if (!j) return false;
  j.seen = true;
  saveJobs(jobs);
  return true;
}
