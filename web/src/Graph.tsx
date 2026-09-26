// Knowledge graph view — "tumhara dimaag". Force-directed SVG, no dependencies.
// Click a node to filter memories by that entity.

import { useEffect, useMemo, useRef, useState } from "react";

export interface GNode {
  id: string;
  label: string;
  count: number;
}
export interface GEdge {
  a: string;
  b: string;
  weight: number;
}

interface Pos {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export default function Graph({
  nodes,
  edges,
  selected,
  onSelect,
}: {
  nodes: GNode[];
  edges: GEdge[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const W = 560;
  const H = 380;
  const [, setTick] = useState(0);
  const posRef = useRef<Map<string, Pos>>(new Map());

  const layout = useMemo(() => {
    const pos = new Map<string, Pos>();
    const n = nodes.length;
    nodes.forEach((nd, i) => {
      const ang = (2 * Math.PI * i) / Math.max(n, 1);
      pos.set(nd.id, {
        x: W / 2 + Math.cos(ang) * (W / 3),
        y: H / 2 + Math.sin(ang) * (H / 3),
        vx: 0,
        vy: 0,
      });
    });
    const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
    // Force sim: repulsion + springs + centering, 160 ticks.
    for (let t = 0; t < 160; t++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = pos.get(nodes[i].id)!;
          const b = pos.get(nodes[j].id)!;
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            d2 = 1;
          }
          const f = 2600 / d2;
          const d = Math.sqrt(d2);
          const fx = (f * dx) / d;
          const fy = (f * dy) / d;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }
      for (const e of edges) {
        const a = pos.get(e.a);
        const b = pos.get(e.b);
        if (!a || !b || !idx.has(e.a) || !idx.has(e.b)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const want = 90;
        const f = ((d - want) * 0.02 * Math.min(e.weight, 4)) / d;
        a.vx += dx * f;
        a.vy += dy * f;
        b.vx -= dx * f;
        b.vy -= dy * f;
      }
      for (const nd of nodes) {
        const p = pos.get(nd.id)!;
        p.vx += (W / 2 - p.x) * 0.008;
        p.vy += (H / 2 - p.y) * 0.008;
        p.vx *= 0.82;
        p.vy *= 0.82;
        p.x = Math.max(34, Math.min(W - 34, p.x + p.vx));
        p.y = Math.max(24, Math.min(H - 24, p.y + p.vy));
      }
    }
    posRef.current = pos;
    return pos;
  }, [nodes, edges]);

  useEffect(() => {
    setTick((t) => t + 1);
  }, [layout]);

  if (nodes.length === 0) {
    return (
      <p className="text-xs text-neutral-600 p-2">
        Abhi graph ke liye entities nahi hain — Yaad se baatein karo, wo khud entities nikalega.
      </p>
    );
  }

  const maxCount = Math.max(...nodes.map((nd) => nd.count), 1);
  const maxW = Math.max(...edges.map((e) => e.weight), 1);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full rounded-xl border gold-border bg-[#0d0d14]"
      style={{ minHeight: 300 }}
    >
      {edges.map((e, i) => {
        const a = layout.get(e.a);
        const b = layout.get(e.b);
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#a16207"
            strokeOpacity={0.25 + (0.45 * e.weight) / maxW}
            strokeWidth={0.8 + (2.2 * e.weight) / maxW}
          />
        );
      })}
      {nodes.map((nd) => {
        const p = layout.get(nd.id)!;
        const r = 8 + (14 * nd.count) / maxCount;
        const isSel = selected === nd.id;
        return (
          <g
            key={nd.id}
            onClick={() => onSelect(isSel ? null : nd.id)}
            className="cursor-pointer"
          >
            <circle
              cx={p.x}
              cy={p.y}
              r={r + (isSel ? 4 : 0)}
              fill={isSel ? "#fbbf24" : "#713f12"}
              stroke={isSel ? "#fef3c7" : "#ca8a04"}
              strokeWidth={isSel ? 2.5 : 1.2}
              opacity={selected && !isSel ? 0.35 : 0.95}
            />
            <text
              x={p.x}
              y={p.y + r + 13}
              textAnchor="middle"
              fill={isSel ? "#fde68a" : "#a8a29e"}
              fontSize={10.5}
              fontWeight={isSel ? 700 : 400}
            >
              {nd.label.length > 16 ? nd.label.slice(0, 15) + "…" : nd.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
