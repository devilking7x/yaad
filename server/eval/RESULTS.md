# Yaad memory eval — RESULTS

Date: 2026-09-26 · mode: keyword-fallback (no embeddings, offline) · cases: 6

| recall@1 | 6/6 = 1.00 |
| recall@3 | 6/6 = 1.00 |
| MRR | 1.000 |

| case | rank | distractor check |
|---|---|---|
| current fact wins (Delhi > Mumbai) | #1 | rank 1 < 3 ✓ |
| historical recall (Mumbai) | #1 | — |
| entity query (chai) | #1 | — |
| entity query (metro) | #1 | — |
| entity query (gym) | #1 | — |
| distractor not top (coffee) | #1 | rank 1 < 3 ✓ |

> Re-run with `MEMORY_DIR=$(mktemp -d) pnpm eval`. With NEBIUS_API_KEY + embedding model set,
> the same harness exercises the semantic + RRF path.