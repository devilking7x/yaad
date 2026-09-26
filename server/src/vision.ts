import { config } from "./config.js";
import { estimateChatCost, recordSpend } from "./spend.js";

// Vision: describe a user-shared image with a Nemotron vision model
// (e.g. nvidia/nemotron-3-nano-omni) on Token Factory, so Yaad can
// *remember* photos — receipts, whiteboards, people, places.

export async function describeImage(dataUrl: string): Promise<string> {
  if (!config.nebiusApiKey) throw new Error("NEBIUS_API_KEY is not set");
  if (!config.visionModel) {
    throw new Error(
      "NEBIUS_VISION_MODEL is not set — pick a vision model from GET /v1/models (e.g. a Nemotron Omni/VL model)"
    );
  }
  const res = await fetch(`${config.nebiusBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.nebiusApiKey}`,
    },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model: config.visionModel,
      temperature: 0.3,
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe this image in detail for a personal memory archive: people, objects, any visible text, location cues, and mood. Two to four sentences.",
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Token Factory vision ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as any;
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Vision model returned no description");
  // C2 fix: vision was unmetered — record it so the daily cap stays honest.
  const u = data.usage;
  if (u && typeof u.prompt_tokens === "number" && typeof u.completion_tokens === "number") {
    recordSpend(estimateChatCost({ prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens }));
  }
  return text as string;
}
