// Yaad MCP server — exposes Yaad's brain (persistent memory + reminders)
// to any MCP-compatible agent (Claude Code, Cursor, MCP Inspector...).
//
// Runs over stdio with newline-delimited JSON-RPC 2.0 (no SDK needed).
// Start:  pnpm mcp   (after pnpm build)
// Logs go to stderr — stdout is reserved for the protocol.

import { memoryAdd, memorySearch, memoryList } from "./memory.js";
import { listReminders } from "./reminders.js";

const VERSION = "1.0.0";

interface RpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method: string;
  params?: any;
}

const TOOLS = [
  {
    name: "yaad_memory_search",
    description:
      "Search Yaad's long-term memory (hybrid semantic + keyword + entity retrieval). Returns currently-valid memories.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to recall, e.g. 'user's sister' or 'coding preferences'" },
        limit: { type: "number", description: "Max results (default 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "yaad_memory_add",
    description: "Save a durable fact to Yaad's long-term memory.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The fact to remember" },
        tags: { type: "string", description: "Comma-separated tags" },
      },
      required: ["text"],
    },
  },
  {
    name: "yaad_memory_list",
    description: "List recent memories (including superseded ones with their history).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },
  {
    name: "yaad_reminders_list",
    description: "List the user's reminders.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(name: string, args: Record<string, any>): Promise<unknown> {
  switch (name) {
    case "yaad_memory_search": {
      const mems = await memorySearch(String(args.query ?? ""), Number(args.limit ?? 5));
      return mems.map((m) => ({
        id: m.id,
        text: m.text,
        tags: m.tags,
        entities: m.entities,
        createdAt: m.createdAt,
        superseded: m.validTo !== null,
      }));
    }
    case "yaad_memory_add": {
      const mem = await memoryAdd(
        String(args.text ?? ""),
        String(args.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean)
      );
      return { saved: true, id: mem.id };
    }
    case "yaad_memory_list": {
      const mems = memoryList().slice(0, Number(args.limit ?? 20));
      return mems.map((m) => ({
        id: m.id,
        text: m.text,
        tags: m.tags,
        valid: m.validTo === null,
        supersededBy: m.supersededBy ?? null,
        createdAt: m.createdAt,
      }));
    }
    case "yaad_reminders_list":
      return listReminders();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function ok(id: RpcRequest["id"], result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}
function err(id: RpcRequest["id"], code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(req: RpcRequest): Promise<string | null> {
  const id = req.id ?? null;
  try {
    switch (req.method) {
      case "initialize":
        return ok(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "yaad-brain", version: VERSION },
        });
      case "notifications/initialized":
        return null; // notification — no response
      case "tools/list":
        return ok(id, { tools: TOOLS });
      case "tools/call": {
        const result = await callTool(req.params?.name, req.params?.arguments ?? {});
        return ok(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      }
      case "ping":
        return ok(id, {});
      default:
        return err(id, -32601, `Method not found: ${req.method}`);
    }
  } catch (e: any) {
    return err(id, -32603, String(e?.message ?? e).slice(0, 500));
  }
}

// Newline-delimited JSON-RPC over stdio.
let buffer = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", async (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const req = JSON.parse(trimmed) as RpcRequest;
      const res = await handle(req);
      if (res) process.stdout.write(res + "\n");
    } catch (e: any) {
      process.stderr.write(`[yaad-mcp] bad frame: ${String(e?.message ?? e).slice(0, 200)}\n`);
    }
  }
});
process.stderr.write(`[yaad-mcp] Yaad brain MCP server v${VERSION} ready on stdio\n`);
