// Knowledge graph: entities become nodes, co-occurrence becomes edges.
// "Tumhara dimaag" — the visual wow for the demo. Pure computation, no model.

import { currentMems } from "./memory.js";

export interface GraphNode {
  id: string;
  label: string;
  count: number;
}
export interface GraphEdge {
  a: string;
  b: string;
  weight: number;
}

const MAX_NODES = 40;

export function buildGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const counts = new Map<string, number>();
  const pairCounts = new Map<string, number>();
  const labelOf = new Map<string, string>();

  for (const m of currentMems()) {
    const ents = [...new Set(m.entities.map((e) => e.toLowerCase().trim()).filter((e) => e && e !== "auto"))];
    for (const e of ents) {
      counts.set(e, (counts.get(e) ?? 0) + 1);
      if (!labelOf.has(e)) {
        const orig = m.entities.find((x) => x.toLowerCase().trim() === e);
        labelOf.set(e, orig ?? e);
      }
    }
    for (let i = 0; i < ents.length; i++) {
      for (let j = i + 1; j < ents.length; j++) {
        const key = [ents[i], ents[j]].sort().join("↔");
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_NODES);
  const keep = new Set(top.map(([e]) => e));
  const nodes: GraphNode[] = top.map(([e, count]) => ({
    id: e,
    label: labelOf.get(e) ?? e,
    count,
  }));
  const edges: GraphEdge[] = [];
  for (const [key, weight] of pairCounts) {
    const [a, b] = key.split("↔");
    if (keep.has(a) && keep.has(b)) edges.push({ a, b, weight });
  }
  edges.sort((x, y) => y.weight - x.weight);
  return { nodes, edges: edges.slice(0, 120) };
}
