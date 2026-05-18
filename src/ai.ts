import type { ExplainRequest, GraphSeed } from "./types";

const MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const DEFAULT_MAX_TOKENS = 2048;

const NURSE_CLIPPY_SYSTEM = `You are Nurse Clippy, a clinical pharmacology assistant for registered nurses. 

You have access to:
- ATI Engage Pharmacology + F.A. Davis nursing pharmacology textbooks
- FDA label data via OpenFDA and DailyMed
- Structured drug records from Sentinel's drug database

Personality: Direct, clinically precise, no fluff. You speak like an experienced nurse educator who's seen it all. Use plain clinical language.

Answering rules:
1. For drug-specific questions — use the provided drug data and search results. Be specific with drug names, conditions, and monitoring parameters.
2. For general pharmacology — use the textbook content confidently.
3. Format: 2-5 bullet points. Clinical action items first. End with source.
4. Only say "consult the official label" if the data genuinely lacks the answer.
5. If a drug is not in the database, use FDA context if available.
6. NEVER invent specific warnings, interactions, or contraindications.
7. For critical safety info (BBW, life-threatening interactions), prefix with "CRITICAL:".
8. End each answer with "Source: [data source]" on its own line.

Output: Plain text. No headings, no protocol references.`;

const DEEP_DIVE_SYSTEM = `You are Nurse Clippy providing an in-depth clinical review.

You have access to:
- ATI Engage Pharmacology + F.A. Davis nursing pharmacology textbooks
- FDA label data via OpenFDA and DailyMed
- Structured drug records from Sentinel's drug database

Format your response with these sections when applicable:
1. Clinical Significance — why this matters at the bedside
2. Assessment Priorities — what to look for, what to ask
3. Intervention — what to do
4. Monitoring — what to track and when
5. Critical Takeaways — 2-3 must-remember points for clinical practice

Be thorough but direct. Use clinical language. Reference specific data from the provided context.
End with "Source: [source]" on its own line.`;

export async function askNurseClippy(ai: Ai, query: string, drugData: string, searchResults: string, mode?: string): Promise<string> {
  const system = mode === "deep" ? DEEP_DIVE_SYSTEM : NURSE_CLIPPY_SYSTEM;
  const maxTokens = mode === "deep" ? 4096 : DEFAULT_MAX_TOKENS;
  const response = await ai.run(MODEL, {
    max_tokens: maxTokens,
    temperature: 0.3,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Question: ${query}\n\nDrug data from database:\n${drugData || "No drug record found."}\n\nRelevant knowledge base results:\n${searchResults || "No knowledge base results found."}` }
    ]
  });
  return extractAiText(response);
}

export async function explainTerm(ai: Ai, request: ExplainRequest): Promise<string> {
  const { term, drug, context, mode } = request;
  const query = [
    `Explain the requested clinical pharmacology term for a registered nurse: ${term}`,
    drug ? `Drug: ${drug}` : "",
    context ? `Context: ${context}` : "Context: General question"
  ].filter(Boolean).join("\n");

  return askNurseClippy(ai, query, context ?? "", "", mode);
}

export async function extractGraphSeed(ai: Ai, text: string, source: string): Promise<GraphSeed> {
  const response = await ai.run(MODEL, {
    messages: [
      {
        role: "system",
        content: "Extract medication knowledge as strict JSON with entities and edges only. Entity types should be drug, condition, drug_class, lab, warning, or symptom."
      },
      {
        role: "user",
        content: `Source type: ${source}\nText:\n${text}\n\nReturn JSON: {"entities":[{"type":"drug","name":"...","properties":{}}],"edges":[{"source":"...","target":"...","relationship":"treats","weight":1}]}`
      }
    ]
  });

  const raw = extractAiText(response);
  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
  try {
    const parsed = JSON.parse(jsonText) as GraphSeed;
    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : []
    };
  } catch {
    return { entities: [], edges: [] };
  }
}

export function extractAiJson(response: unknown): Record<string, unknown> {
  if (response && typeof response === "object" && hasClinicalJsonKeys(response as Record<string, unknown>)) {
    return response as Record<string, unknown>;
  }
  const raw = extractAiRawText(response) || JSON.stringify(response);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractAiRawText(response: unknown, depth = 0): string {
  if (depth > 3) return "";
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") return "";

  const obj = response as Record<string, unknown>;
  if (typeof obj.response === "string") return obj.response;
  if (typeof obj.result === "string") return obj.result;
  if (typeof obj.output_text === "string") return obj.output_text;
  if (typeof obj.content === "string") return obj.content;
  if (Array.isArray(obj.choices)) {
    const first = obj.choices[0] as { message?: { content?: string }; text?: string } | undefined;
    return first?.message?.content ?? first?.text ?? "";
  }

  return extractAiRawText(obj.result, depth + 1)
    || extractAiRawText(obj.response, depth + 1)
    || extractAiRawText(obj.output, depth + 1);
}

function hasClinicalJsonKeys(value: Record<string, unknown>): boolean {
  return "indications" in value
    || "contraindications" in value
    || "black_box_warnings" in value
    || "side_effects" in value
    || "interactions" in value
    || "monitoring" in value;
}

function extractAiText(response: unknown): string {
  if (typeof response === "string") return response;
  if (response && typeof response === "object") {
    const obj = response as Record<string, unknown>;
    if (typeof obj.response === "string") return obj.response;
    if (typeof obj.result === "string") return obj.result;
    if (Array.isArray(obj.choices)) {
      const first = obj.choices[0] as { message?: { content?: string }; text?: string } | undefined;
      return first?.message?.content ?? first?.text ?? "";
    }
  }
  return "No explanation was returned. Try a more specific question.";
}
