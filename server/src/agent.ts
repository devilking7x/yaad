import { config } from "./config.js";
import { chatComplete, type ChatMessage, type ChatTool } from "./nebius.js";
import { memoryAdd, memorySearch } from "./memory.js";
import { getSkill, listSkills } from "./skills.js";
import { webSearch } from "./tavily.js";

// Yaad agent: recall memory -> pick skills -> reason with Nemotron -> act with tools.

const TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "remember",
      description: "Save a durable fact about the user to long-term memory (preferences, people, decisions, context).",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The fact to remember, as a clear sentence." },
          tags: { type: "string", description: "Comma-separated tags, e.g. 'preference,food'." },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall",
      description: "Search long-term memory for relevant context.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the live web (Tavily) for current facts, docs, prices, news.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_skill",
      description: "Run a reusable skill pack by name. Returns the skill's instructions to follow.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Skill name, e.g. 'morning-briefing'." } },
        required: ["name"],
      },
    },
  },
];

function toolResult(id: string, name: string, payload: unknown): ChatMessage {
  return {
    role: "tool",
    tool_call_id: id,
    name,
    content: typeof payload === "string" ? payload : JSON.stringify(payload),
  };
}

async function executeTool(name: string, args: Record<string, string>): Promise<unknown> {
  switch (name) {
    case "remember": {
      const mem = memoryAdd(args.text, (args.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean));
      return { saved: true, id: mem.id };
    }
    case "recall":
      return memorySearch(args.query, 5).map((m) => ({ id: m.id, text: m.text, tags: m.tags }));
    case "web_search":
      return webSearch(args.query, 5);
    case "run_skill": {
      const skill = getSkill(args.name);
      if (!skill) return { error: `Unknown skill '${args.name}'. Available: ${listSkills().map((s) => s.name).join(", ")}` };
      return { name: skill.name, instructions: skill.instructions };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

function systemPrompt(): string {
  const skills = listSkills();
  const skillCatalog =
    skills.length > 0
      ? skills.map((s) => `- ${s.name}: ${s.description} (${s.when})`).join("\n")
      : "(no skills installed — add markdown packs to the skills/ directory)";
  return [
    "You are Yaad, a personal AI assistant that remembers its user.",
    "You are private: the user's data stays in their own memory store, never shared.",
    "",
    "MEMORY: At the start of a conversation, relevant memories are injected below.",
    "Use `remember` to save durable facts (preferences, people, decisions, routines).",
    "Use `recall` when you need more context.",
    "Never claim to remember something you were not given.",
    "",
    "SKILLS (reusable packs you can run with `run_skill`):",
    skillCatalog,
    "",
    "TOOLS: `web_search` for anything current (news, prices, docs, versions).",
    "Be warm, concise, and specific. Answer in the user's language.",
  ].join("\n");
}

export interface TurnResult {
  reply: string;
  model: string;
  steps: number;
}

const MAX_STEPS = 6;

export async function runAgent(userMessage: string, history: ChatMessage[] = []): Promise<TurnResult> {
  const recalled = memorySearch(userMessage, 5);
  const memoryBlock =
    recalled.length > 0
      ? `\n\nWhat you remember about the user:\n${recalled.map((m) => `- ${m.text}`).join("\n")}`
      : "";

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() + memoryBlock },
    ...history,
    { role: "user", content: userMessage },
  ];

  let steps = 0;
  let model = config.fastModel;
  for (;;) {
    steps++;
    // Fast model for tool routing; escalate to the reasoning model when the
    // conversation needs deep thinking (long histories / complex asks).
    const needsReasoning = messages.length > 6 || userMessage.length > 500;
    model = needsReasoning ? config.reasoningModel : config.fastModel;

    const { message } = await chatComplete({ model, messages, tools: TOOLS });
    messages.push(message);

    const calls = message.tool_calls ?? [];
    if (calls.length === 0 || steps >= MAX_STEPS) {
      return { reply: message.content ?? "", model, steps };
    }
    for (const call of calls) {
      const args = JSON.parse(call.function.arguments || "{}") as Record<string, string>;
      const out = await executeTool(call.function.name, args).catch((e: Error) => ({ error: e.message }));
      messages.push(toolResult(call.id, call.function.name, out));
    }
  }
}
