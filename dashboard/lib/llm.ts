import OpenAI from "openai";

// Model IDs live in env so they can be swapped without touching code. These
// defaults match classifier/llm_agents.py (picked 2026-04-18).
export const DRAFTER_MODEL = process.env.DRAFTER_MODEL ?? "google/gemini-3.1-pro-preview";
export const RESUME_EDITOR_MODEL = process.env.RESUME_EDITOR_MODEL ?? "google/gemini-3.1-pro-preview";
export const EMBED_MODEL = process.env.EMBED_MODEL ?? "openai/text-embedding-3-small";
export const EMBED_DIM = 1536;

let _client: OpenAI | undefined;

export function openRouter(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  _client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });
  return _client;
}

export async function embedText(text: string): Promise<number[]> {
  const res = await openRouter().embeddings.create({
    model: EMBED_MODEL,
    input: text && text.trim().length > 0 ? text : " ",
  });
  const v = res.data[0].embedding;
  if (v.length !== EMBED_DIM) throw new Error(`embedding dim ${v.length} != ${EMBED_DIM}`);
  return v;
}

export function toVectorLiteral(v: number[]): string {
  return "[" + v.map((x) => x.toFixed(7)).join(",") + "]";
}
