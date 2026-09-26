// Yaad memory eval — measures recall quality OFFLINE (keyword-fallback path,
// no API keys needed). Run:  MEMORY_DIR=$(mktemp -d) pnpm eval
// Guards regressions like the Delhi-vs-coffee ranking bug (2026-09-26).

import fs from "node:fs";
import { memoryAdd, memorySearch, memorySupersede } from "../src/memory.js";

interface Case {
  name: string;
  query: string;
  expectId: string;
  historical?: boolean;
  /** the expected memory must outrank this distractor */
  outrankId?: string;
}

async function main() {
  // --- Seed a controlled brain ---
  const mumbai = await memoryAdd("mera ghar Mumbai me hai", [], ["ghar", "Mumbai"]);
  const delhi = await memoryAdd("mera ghar Delhi me hai", [], ["ghar", "Delhi"]);
  memorySupersede(mumbai.id, delhi.id);
  const chai = await memoryAdd("mujhe adrak wali chai pasand hai", [], ["chai"]);
  const coffee = await memoryAdd("coffee peena sehat ke liye acha hota hai", [], ["coffee"]);
  const metro = await memoryAdd("Delhi me metro se travel karta hun", [], ["Delhi", "metro"]);
  const gym = await memoryAdd("gym subah 6 baje jata hun", [], ["gym"]);

  const cases: Case[] = [
    { name: "current fact wins (Delhi > Mumbai)", query: "mera ghar kahan hai", expectId: delhi.id, outrankId: coffee.id },
    { name: "historical recall (Mumbai)", query: "mera ghar kahan tha", expectId: mumbai.id, historical: true },
    { name: "entity query (chai)", query: "chai", expectId: chai.id },
    { name: "entity query (metro)", query: "metro", expectId: metro.id },
    { name: "entity query (gym)", query: "gym kab jata hun", expectId: gym.id },
    { name: "distractor not top (coffee)", query: "mera ghar kahan hai", expectId: delhi.id, outrankId: coffee.id },
  ];

  let r1 = 0;
  let r3 = 0;
  let mrr = 0;
  const rows: string[] = [];

  for (const c of cases) {
    const hits = await memorySearch(c.query, 10, { includeHistorical: !!c.historical });
    const rank = hits.findIndex((m) => m.id === c.expectId) + 1; // 0 = miss
    const found = rank > 0;
    if (found) {
      if (rank === 1) r1++;
      if (rank <= 3) r3++;
      mrr += 1 / rank;
    }
    let outrank = "—";
    if (c.outrankId) {
      const rd = hits.findIndex((m) => m.id === c.outrankId) + 1;
      outrank = rd === 0 ? "distractor absent ✓" : rank > 0 && rank < rd ? `rank ${rank} < ${rd} ✓` : `RANK ${rank} vs ${rd} ✗`;
    }
    rows.push(`| ${c.name} | ${found ? `#${rank}` : "MISS"} | ${outrank} |`);
    console.log(`${found ? "✓" : "✗"} ${c.name}: rank ${found ? rank : "MISS"} — "${c.query}"`);
  }

  const n = cases.length;
  const line = (k: string, v: string) => `| ${k} | ${v} |`;
  const report = [
    "# Yaad memory eval — RESULTS",
    "",
    `Date: ${new Date().toISOString().slice(0, 10)} · mode: keyword-fallback (no embeddings, offline) · cases: ${n}`,
    "",
    line("recall@1", `${r1}/${n} = ${(r1 / n).toFixed(2)}`),
    line("recall@3", `${r3}/${n} = ${(r3 / n).toFixed(2)}`),
    line("MRR", (mrr / n).toFixed(3)),
    "",
    "| case | rank | distractor check |",
    "|---|---|---|",
    ...rows,
    "",
    "> Re-run with `MEMORY_DIR=$(mktemp -d) pnpm eval`. With NEBIUS_API_KEY + embedding model set,",
    "> the same harness exercises the semantic + RRF path.",
  ].join("\n");

  fs.writeFileSync(new URL("./RESULTS.md", import.meta.url), report, "utf-8");
  console.log("\n" + report.split("\n").slice(4, 7).join("\n"));
  console.log("wrote server/eval/RESULTS.md");
}

main().catch((e) => {
  console.error("eval failed:", e);
  process.exit(1);
});
