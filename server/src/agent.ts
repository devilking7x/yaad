import { config } from "./config.js";
import { chatComplete, chatStream, type ChatMessage, type ChatTool, type Usage } from "./nebius.js";
import { memoryAdd, memorySearch } from "./memory.js";
import { getSkill, listSkills } from "./skills.js";
import { webSearch } from "./tavily.js";

// Yaad agent: recall memory -> pick skills -> reason with Nemotron -> act with tools.
// Streams tokens live, tracks token usage + estimated cost, and proactively
// consolidates new facts into long-term memory after each turn.

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

export type AgentEvent =
  | { type: "token"; token: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string }
  | {
      type: "done";
      reply: string;
      model: string;
      steps: number;
      usage: Usage;
      costUsd: number | null;
    }
  | { type: "error"; error: string };

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
      const mem = await memoryAdd(
        args.text,
        (args.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean)
      );
      return { saved: true, id: mem.id };
    }
    case "recall":
      return (await memorySearch(args.query, 5)).map((m) => ({ id: m.id, text: m.text, tags: m.tags }));
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

function addUsage(a: Usage, b?: Usage): Usage {
  return {
    prompt_tokens: a.prompt_tokens + (b?.prompt_tokens ?? 0),
    completion_tokens: a.completion_tokens + (b?.completion_tokens ?? 0),
    total_tokens: a.total_tokens + (b?.total_tokens ?? 0),
  };
}

function estimateCost(usage: Usage): number | null {
  const { priceInputPer1M, priceOutputPer1M } = config;
  if (!priceInputPer1M && !priceOutputPer1M) return null;
  return (usage.prompt_tokens / 1e6) * priceInputPer1M + (usage.completion_tokens / 1e6) * priceOutputPer1M;
}

/** Background pass: extract durable facts from the turn into long-term memory. */
async function consolidateMemory(userMessage: string, reply: string): Promise<void> {
  if (!config.autoRemember || userMessage.trim().length < 20) return;
  try {
    const { message } = await chatComplete({
      model: config.fastModel,
      temperature: 0.2,
      maxTokens: 300,
      messages: [
        {
          role: "system",
          content:
            "Extract durable facts about the user from this conversation (preferences, people, decisions, routines, goals). " +
            "Reply with ONLY a JSON array of strings, e.g. [\"User likes filter coffee\", \"User's sister is Priya\"]. " +
            "Empty array [] if nothing durable. No other text.",
        },
        { role: "user", content: `User: ${userMessage}\nAssistant: ${reply.slice(0, 1500)}` },
      ],
    });
    const facts = JSON.parse(message.content ?? "[]") as string[];
    for (const f of facts.slice(0, 5)) {
      if (typeof f === "string" && f.trim().length > 3) {
        await memoryAdd(f.trim(), ["auto"]);
      }
    }
  } catch {
    /* consolidation is best-effort; never break the turn */
  }
}

const MAX_STEPS = 6;

export async function runAgentStream(
  userMessage: string,
  history: ChatMessage[],
  onEvent: (e: AgentEvent) => void
): Promise<void> {
  const recalled = await memorySearch(userMessage, 5);
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
  let totalUsage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let finalReply = "";

  for (;;) {
    steps++;
    const needsReasoning = messages.length > 6 || userMessage.length > 500;
    model = needsReasoning ? config.reasoningModel : config.fastModel;

    let assembled: ChatMessage | undefined;
    for await (const chunk of chatStream({ model, messages, tools: TOOLS })) {
      if (chunk.delta) onEvent({ type: "token", token: chunk.delta });
      if (chunk.thinking) onEvent({ type: "thinking", text: chunk.thinking });
      if (chunk.message) assembled = chunk.message;
      if (chunk.usage) totalUsage = addUsage(totalUsage, chunk.usage);
      if (chunk.model) model = chunk.model;
    }
    if (!assembled) throw new Error("Token Factory returned no message");
    messages.push(assembled);

    const calls = assembled.tool_calls ?? [];
    if (calls.length === 0 || steps >= MAX_STEPS) {
      finalReply = assembled.content ?? "";
      break;
    }
    for (const call of calls) {
      onEvent({ type: "tool", name: call.function.name });
      let args: Record<string, string> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        /* keep empty */
      }
      const out = await executeTool(call.function.name, args).catch((e: Error) => ({ error: e.message }));
      messages.push(toolResult(call.id, call.function.name, out));
    }
  }

  onEvent({
    type: "done",
    reply: finalReply,
    model,
    steps,
    usage: totalUsage,
    costUsd: estimateCost(totalUsage),
  });

  // Learn in the background — never blocks the delivered response.
  await consolidateMemory(userMessage, finalReply);
}

export interface TurnResult {
  reply: string;
  model: string;
  steps: number;
  usage: Usage;
  costUsd: number | null;
}

/** Non-streaming wrapper (kept for simple clients). */
export async function runAgent(userMessage: string, history: ChatMessage[] = []): Promise<TurnResult> {
  let reply = "";
  let model = "";
  let steps = 0;
  let usage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let costUsd: number | null = null;
  await runAgentStream(userMessage, history, (e) => {
    if (e.type === "done") {
      reply = e.reply;
      model = e.model;
      steps = e.steps;
      usage = e.usage;
      costUsd = e.costUsd;
    } else if (e.type === "error") {
      throw new Error(e.error);
    }
  });
  return { reply, model, steps, usage, costUsd };
}
