import { extractGraphSeed } from "./ai";
import { insertGraphSeed } from "./db";
import type { Env, GraphSeed, IngestRequest } from "./types";

export async function ingestKnowledge(env: Env, body: IngestRequest): Promise<GraphSeed & { merged: boolean }> {
  if (!body.text?.trim()) throw new Error("text is required");
  const seed = await extractGraphSeed(env.AI, body.text.slice(0, 12000), body.source || "Other");
  if (body.merge) await insertGraphSeed(env.DB, seed.entities, seed.edges, body.source || "user_upload");
  return { ...seed, merged: Boolean(body.merge) };
}
