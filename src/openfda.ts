import type { DrugRecord } from "./types";

interface OpenFdaLabel {
  openfda?: {
    generic_name?: string[];
    brand_name?: string[];
    pharm_class_epc?: string[];
  };
  indications_and_usage?: string[];
  contraindications?: string[];
  boxed_warning?: string[];
  warnings?: string[];
  adverse_reactions?: string[];
  drug_interactions?: string[];
  pregnancy?: string[];
  dosage_and_administration?: string[];
}

interface OpenFdaResponse {
  results?: OpenFdaLabel[];
}

export async function fetchOpenFdaDrug(name: string, apiKey: string): Promise<Partial<DrugRecord>> {
  const search = `active_ingredient:${quoteIfNeeded(name)}`;
  const url = new URL("https://api.fda.gov/drug/label.json");
  url.searchParams.set("search", search);
  url.searchParams.set("limit", "1");
  if (apiKey) url.searchParams.set("api_key", apiKey);

  const response = await fetch(url);
  if (response.status === 404) return {};
  if (!response.ok) throw new Error(`OpenFDA returned ${response.status}`);

  const payload = (await response.json()) as OpenFdaResponse;
  const label = payload.results?.[0];
  if (!label) return {};

  return {
    name: label.openfda?.generic_name?.[0] ?? name,
    generic_name: label.openfda?.generic_name?.[0]?.toLowerCase() ?? name.toLowerCase(),
    drug_class: label.openfda?.pharm_class_epc?.[0] ?? null,
    brand_names: label.openfda?.brand_name ?? [],
    indications: splitMedicalText(label.indications_and_usage?.[0], 5),
    contraindications: splitMedicalText(label.contraindications?.[0], 5),
    black_box_warnings: splitMedicalText(label.boxed_warning?.[0] ?? label.warnings?.[0], 4),
    side_effects: splitMedicalText(label.adverse_reactions?.[0], 6),
    interactions: splitMedicalText(label.drug_interactions?.[0], 6),
    pregnancy_category: summarize(label.pregnancy?.[0], 220),
    administration: summarize(label.dosage_and_administration?.[0], 260),
    source: "fda"
  };
}

export function splitMedicalText(text: string | undefined, limit: number): string[] {
  if (!text) return [];
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.;])\s+(?=[A-Z0-9])/)
    .map((item) => item.replace(/^[*•\-\s]+/, "").trim())
    .filter((item) => item.length > 12)
    .slice(0, limit)
    .map((item) => summarize(item, 220));
}

function summarize(text: string | undefined, max: number): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}...` : clean;
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, "")}"` : value;
}
