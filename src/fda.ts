import { getAllDrugs, insertGraphSeed, upsertDrug } from "./db";
import { extractAiJson } from "./ai";
import { cleanFdaSection } from "./cleaner";
import type { DrugRecord, Env, GraphEdgeSeed, GraphEntity, GraphSeed } from "./types";

export interface FdaLabelResult {
  rxcui: string;
  generic_name?: string | null;
  brand_names: string[];
  pharm_class_epc: string[];
  indications_and_usage: string[];
  contraindications: string[];
  boxed_warning: string[];
  adverse_reactions: string[];
  drug_interactions: string[];
  pregnancy: string[];
  dosage_and_administration: string[];
  warnings_and_cautions: string[];
  label_raw?: string | null;
  source: "fda";
}

interface RxNormResponse {
  idGroup?: {
    rxnormId?: string[];
  };
}

interface RxApproximateResponse {
  approximateGroup?: {
    candidate?: Array<{ rxcui?: string; score?: string }>;
  };
}

interface RxPropertiesResponse {
  properties?: {
    name?: string;
  };
}

interface OpenFdaLabel {
  openfda?: {
    generic_name?: string[];
    brand_name?: string[];
    pharm_class_epc?: string[];
    rxcui?: string[];
  };
  indications_and_usage?: string[];
  contraindications?: string[];
  boxed_warning?: string[];
  warnings?: string[];
  warnings_and_cautions?: string[];
  adverse_reactions?: string[];
  drug_interactions?: string[];
  pregnancy?: string[];
  dosage_and_administration?: string[];
}

interface OpenFdaResponse {
  results?: OpenFdaLabel[];
}

interface DailymedImage {
  url: string;
  type: "pill" | "label" | "package" | "structure";
}

interface DailymedSplSearchResponse {
  data?: Array<{ setid: string; title: string }>;
}

type AiMappedFda = Partial<DrugRecord> & {
  graph?: GraphSeed;
};

const ARRAY_FIELDS = [
  "indications",
  "contraindications",
  "black_box_warnings",
  "side_effects",
  "interactions",
  "monitoring",
  "brand_names",
  "images"
] as const;

const RAW_ARRAY_FIELDS = [
  "indications_raw",
  "contraindications_raw",
  "side_effects_raw",
  "interactions_raw",
  "monitoring_raw"
] as const;

const REMAP_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const MAX_AI_SECTION_CHARS = 4000;
const MAX_AI_FIELD_ITEMS = 15;

const REMAP_SYSTEM_PROMPT = `You are a clinical data routing assistant for nursing pharmacology. 
Your job: take raw FDA label sections and route each sentence into the correct clinical field.

FIELDS (output exactly these keys):
- indications: Therapeutic use, what it treats
- contraindications: When NOT to give it
- black_box_warnings: FDA's strongest safety warnings
- side_effects: Adverse reactions, incidence rates, body-system effects
- interactions: Drug-drug, drug-food, drug-lab interactions
- monitoring: Nursing monitoring parameters ONLY — labs, vitals, clinical assessments, frequency
- administration: Dose, route, preparation, storage
- pregnancy_category: Brief pregnancy/lactation statement (single string, not array)
- DISCARD: OTC consumer advice, legal boilerplate, clinical trial methodology, "see package insert" refs
- graph: Clean clinical graph data extracted from the label

RULES:
- Output JSON with keys matching the field names above (except DISCARD)
- Each field value is an array of short, clinically actionable strings
- DISCARD is an array of discarded text (for audit, not stored)
- Preserve clinical specificity — include dose ranges, frequencies, lab values
- Remove cross-references like "(see PRECAUTIONS)" or "(5.1)"
- Remove boilerplate like "For more information, consult the official label"
- If a sentence mixes monitoring + interaction content, put it in the PRIMARY field (monitoring wins over interactions for lab monitoring related to interactions)
- pregnancy_category should be a single string like "Category B" or "No human data available"
- If an FDA section has no clinically useful content for any field, DISCARD it
- Keep empty arrays for sections with no relevant data
- MAX 15 items per field — prioritize the most clinically important

Also extract graph entities and edges from the clinical data:
- Entity types: condition, symptom, lab, drug_class, warning, drug
- Edge relationships: treats, contraindicated_with, may_cause, interacts_with, requires_monitoring, member_of
- Graph data should be deduplicated (same entity name shouldn't appear twice)
- Max 20 entities total
- Drug name is always the source, conditions/symptoms/labs are targets

Return JSON with all fields plus a "graph" key containing {entities, edges}.`;

export async function resolveRxNorm(drugName: string): Promise<string | null> {
  const name = drugName.trim();
  if (!name) return null;

  const exact = new URL("https://rxnav.nlm.nih.gov/REST/rxcui.json");
  exact.searchParams.set("name", name);
  exact.searchParams.set("search", "2");
  const exactRxcui = await fetchRxCui(exact);
  if (exactRxcui) return exactRxcui;

  const approximate = new URL("https://rxnav.nlm.nih.gov/REST/approximateTerm.json");
  approximate.searchParams.set("term", name);
  approximate.searchParams.set("maxEntries", "1");
  try {
    const response = await fetch(approximate);
    if (!response.ok) return null;
    const payload = (await response.json()) as RxApproximateResponse;
    return payload.approximateGroup?.candidate?.[0]?.rxcui ?? null;
  } catch {
    return null;
  }
}

export async function fetchFdaLabel(rxcui: string): Promise<FdaLabelResult> {
  const safeRxcui = rxcui.replace(/"/g, "");
  const rxName = await fetchRxNormName(safeRxcui);
  const searches = [
    `openfda.rxcui:"${safeRxcui}"`,
    rxName ? `openfda.generic_name:"${escapeFdaSearch(rxName)}"` : "",
    rxName ? `active_ingredient:"${escapeFdaSearch(rxName)}"` : ""
  ].filter(Boolean);

  let labels: OpenFdaLabel[] = [];
  for (const search of searches) {
    labels = await fetchOpenFdaLabels(search);
    if (labels.length) break;
  }

  const label = chooseBestLabel(labels);
  if (!label) return emptyFdaLabel(rxcui);

  return {
    rxcui,
    generic_name: first(label.openfda?.generic_name) ?? null,
    brand_names: cleanArray(label.openfda?.brand_name),
    pharm_class_epc: cleanArray(label.openfda?.pharm_class_epc),
    indications_and_usage: cleanArray(label.indications_and_usage),
    contraindications: cleanArray(label.contraindications),
    boxed_warning: cleanArray(label.boxed_warning),
    adverse_reactions: cleanArray(label.adverse_reactions),
    drug_interactions: cleanArray(label.drug_interactions),
    pregnancy: cleanArray(label.pregnancy),
    dosage_and_administration: cleanArray(label.dosage_and_administration),
    warnings_and_cautions: cleanArray(label.warnings_and_cautions ?? label.warnings),
    label_raw: JSON.stringify(label),
    source: "fda"
  };
}

export async function fetchDailymedImages(drugName: string): Promise<string[]> {
  const name = drugName.trim();
  if (!name) return [];

  try {
    const searchUrl = new URL("https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json");
    searchUrl.searchParams.set("drug_name", name);
    searchUrl.searchParams.set("pagesize", "5");
    const searchResp = await fetchWithTimeout(searchUrl.toString(), { headers: { Accept: "application/json" } });
    if (!searchResp.ok) return [];

    const searchData = (await searchResp.json()) as DailymedSplSearchResponse;
    const spls = searchData.data ?? [];
    if (!spls.length) return [];

    const images: DailymedImage[] = [];
    for (const spl of spls) {
      const infoUrl = `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${encodeURIComponent(spl.setid)}`;
      const infoResp = await fetchWithTimeout(infoUrl);
      if (!infoResp.ok) continue;
      const html = await infoResp.text();

      const regex = /image\.cfm\?name=([^"&]+)(?:&amp;|&)setid=([^"&]+)/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(html)) !== null) {
        const imageName = decodeHtmlAttribute(match[1]);
        const setid = decodeHtmlAttribute(match[2]);
        const type = classifyDailymedImage(imageName);
        const url = `https://dailymed.nlm.nih.gov/dailymed/image.cfm?name=${imageName}&setid=${setid}&type=img`;
        if (!type || images.some((item) => item.url === url)) continue;
        images.push({ url, type });
      }

      if (images.length > 0) break;
    }

    return images
      .filter((image) => image.type === "pill" || image.type === "package")
      .map((image) => image.url)
      .slice(0, 3);
  } catch {
    return [];
  }
}

export async function remapFdaWithAi(fda: FdaLabelResult, name: string, ai: Ai): Promise<AiMappedFda> {
  const fallback = fallbackMapFdaToDrug(fda, name);

  try {
    const response = await ai.run(REMAP_MODEL, {
      max_tokens: 2048,
      temperature: 0.1,
      messages: [
        { role: "system", content: REMAP_SYSTEM_PROMPT },
        { role: "user", content: buildFdaRemapPrompt(fda) }
      ]
    });
    const result = extractAiJson(response);
    return mergeAiMappedFda(fallback, result, fda, name);
  } catch {
    return fallback;
  }
}

function fallbackMapFdaToDrug(fda: FdaLabelResult, name: string): AiMappedFda {
  const pregnancyCategory = parsePregnancyCategory(fda.pregnancy.join(" "));

  return {
    rxcui: fda.rxcui,
    name,
    generic_name: fda.generic_name?.toLowerCase() ?? name.toLowerCase(),
    drug_class: first(fda.pharm_class_epc) ?? null,
    brand_names: fda.brand_names,
    indications: limitSection(fda.indications_and_usage),
    contraindications: limitSection(fda.contraindications),
    black_box_warnings: limitSection(fda.boxed_warning),
    side_effects: limitSection(fda.adverse_reactions),
    interactions: limitSection(fda.drug_interactions),
    administration: summarize(fda.dosage_and_administration.join(" "), 360) || null,
    pregnancy_category: pregnancyCategory,
    monitoring: limitSection(fda.warnings_and_cautions),
    ...rawFdaFields(fda),
    label_raw: fda.label_raw ?? null,
    source: "fda"
  };
}

function rawFdaFields(fda: FdaLabelResult): Pick<DrugRecord, "indications_raw" | "contraindications_raw" | "side_effects_raw" | "interactions_raw" | "monitoring_raw"> {
  return {
    indications_raw: limitSection(fda.indications_and_usage),
    contraindications_raw: limitSection(fda.contraindications),
    side_effects_raw: limitSection(fda.adverse_reactions),
    interactions_raw: limitSection(fda.drug_interactions),
    monitoring_raw: limitSection(fda.warnings_and_cautions)
  };
}

function buildFdaRemapPrompt(fda: FdaLabelResult): string {
  return `Route each sentence from these FDA label sections into the correct clinical fields.

indications_and_usage:
${formatAiSection(fda.indications_and_usage)}

contraindications:
${formatAiSection(fda.contraindications)}

boxed_warning:
${formatAiSection(fda.boxed_warning)}

adverse_reactions:
${formatAiSection(fda.adverse_reactions)}

drug_interactions:
${formatAiSection(fda.drug_interactions)}

warnings_and_cautions:
${formatAiSection(fda.warnings_and_cautions)}

pregnancy:
${formatAiSection(fda.pregnancy)}

dosage_and_administration:
${formatAiSection(fda.dosage_and_administration)}

Return JSON with keys: indications, contraindications, black_box_warnings, side_effects, interactions, monitoring, administration, pregnancy_category, discard, graph.`;
}

function formatAiSection(values: string[]): string {
  let used = 0;
  const lines: string[] = [];
  for (const [index, value] of values.entries()) {
    const prefix = `[${index + 1}] `;
    const remaining = MAX_AI_SECTION_CHARS - used - prefix.length;
    if (remaining <= 0) break;
    const line = `${prefix}${value.slice(0, remaining)}`;
    lines.push(line);
    used += line.length + 1;
    if (value.length > remaining) break;
  }
  return lines.join("\n");
}

function mergeAiMappedFda(
  fallback: Partial<DrugRecord>,
  result: Record<string, unknown>,
  fda: FdaLabelResult,
  name: string
): AiMappedFda {
  const mapped: AiMappedFda = {
    rxcui: fda.rxcui,
    name,
    generic_name: fda.generic_name?.toLowerCase() ?? name.toLowerCase(),
    drug_class: first(fda.pharm_class_epc) ?? null,
    brand_names: fda.brand_names,
    indications: aiListOrFallback(result.indications, fallback.indications),
    contraindications: aiListOrFallback(result.contraindications, fallback.contraindications),
    black_box_warnings: aiListOrFallback(result.black_box_warnings, fallback.black_box_warnings),
    side_effects: aiListOrFallback(result.side_effects, fallback.side_effects),
    interactions: aiListOrFallback(result.interactions, fallback.interactions),
    monitoring: aiListOrFallback(result.monitoring, fallback.monitoring),
    ...rawFdaFields(fda),
    administration: aiAdministrationOrFallback(result.administration, fallback.administration),
    pregnancy_category: aiPregnancyOrFallback(result.pregnancy_category, fallback.pregnancy_category),
    label_raw: fda.label_raw ?? null,
    source: "fda",
    graph: parseAiGraph(result.graph, name, first(fda.pharm_class_epc))
  };

  return hasAnyMappedFdaData(mapped) ? mapped : fallback;
}

function aiListOrFallback(value: unknown, fallback: string[] | undefined): string[] {
  const items = Array.isArray(value)
    ? value.map((item) => cleanAiItem(String(item))).filter(Boolean).slice(0, MAX_AI_FIELD_ITEMS)
    : [];
  return items.length ? items : fallback ?? [];
}

function aiAdministrationOrFallback(value: unknown, fallback: string | null | undefined): string | null {
  const items = Array.isArray(value)
    ? value.map((item) => cleanAiItem(String(item))).filter(Boolean).slice(0, MAX_AI_FIELD_ITEMS)
    : typeof value === "string" && value.trim()
      ? [cleanAiItem(value)]
      : [];
  return items.length ? summarize(items.join("; "), 420) : fallback ?? null;
}

function aiPregnancyOrFallback(value: unknown, fallback: string | null | undefined): string | null {
  const clean = typeof value === "string" ? cleanAiItem(value) : "";
  return clean || fallback || null;
}

function cleanAiItem(value: string): string {
  return value
    .replace(/\(\s*(?:see\s+[^)]*|\d+(?:\.\d+)*)\s*\)/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function parseAiGraph(value: unknown, drugName: string, drugClass?: string): GraphSeed | undefined {
  if (!value || typeof value !== "object") return undefined;
  const graph = value as { entities?: unknown; edges?: unknown };
  const entities = Array.isArray(graph.entities) ? graph.entities : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const cleanedEntities: GraphEntity[] = [];
  const seenEntities = new Set<string>();

  addGraphEntity(cleanedEntities, seenEntities, { type: "drug", name: drugName });
  if (drugClass) addGraphEntity(cleanedEntities, seenEntities, { type: "drug_class", name: drugClass });

  for (const entity of entities) {
    if (!entity || typeof entity !== "object") continue;
    const candidate = entity as { type?: unknown; name?: unknown; properties?: unknown };
    const type = typeof candidate.type === "string" ? candidate.type.trim() : "";
    const name = typeof candidate.name === "string" ? cleanAiItem(candidate.name) : "";
    if (!isAllowedGraphEntityType(type) || !name) continue;
    const properties = candidate.properties && typeof candidate.properties === "object"
      ? candidate.properties as Record<string, unknown>
      : undefined;
    addGraphEntity(cleanedEntities, seenEntities, { type, name, properties });
    if (cleanedEntities.length >= 20) break;
  }

  const cleanedEdges: GraphEdgeSeed[] = [];
  const seenEdges = new Set<string>();
  const entityNames = new Set(cleanedEntities.map((entity) => entity.name.toLowerCase()));
  if (drugClass && entityNames.has(drugClass.toLowerCase())) {
    addGraphEdge(cleanedEdges, seenEdges, { source: drugName, target: drugClass, relationship: "member_of" }, entityNames);
  }

  for (const edge of edges) {
    if (!edge || typeof edge !== "object") continue;
    const candidate = edge as { source?: unknown; target?: unknown; relationship?: unknown; weight?: unknown };
    const target = typeof candidate.target === "string" ? cleanAiItem(candidate.target) : "";
    const relationship = typeof candidate.relationship === "string" ? candidate.relationship.trim() : "";
    if (!target || !isAllowedGraphRelationship(relationship)) continue;
    addGraphEdge(
      cleanedEdges,
      seenEdges,
      {
        source: drugName,
        target,
        relationship,
        weight: typeof candidate.weight === "number" && Number.isFinite(candidate.weight) ? candidate.weight : undefined
      },
      entityNames
    );
  }

  return cleanedEntities.length > 1 ? { entities: cleanedEntities, edges: cleanedEdges } : undefined;
}

function addGraphEntity(entities: GraphEntity[], seen: Set<string>, entity: GraphEntity): void {
  const key = `${entity.type.toLowerCase()}::${entity.name.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  entities.push(entity);
}

function addGraphEdge(edges: GraphEdgeSeed[], seen: Set<string>, edge: GraphEdgeSeed, entityNames: Set<string>): void {
  if (!entityNames.has(edge.source.toLowerCase()) || !entityNames.has(edge.target.toLowerCase())) return;
  const key = `${edge.source.toLowerCase()}::${edge.target.toLowerCase()}::${edge.relationship.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push(edge);
}

function isAllowedGraphEntityType(type: string): boolean {
  return ["condition", "symptom", "lab", "drug_class", "warning", "drug"].includes(type);
}

function isAllowedGraphRelationship(relationship: string): boolean {
  return ["treats", "contraindicated_with", "may_cause", "interacts_with", "requires_monitoring", "member_of"].includes(relationship);
}

function applyDailymedImages(record: DrugRecord, result: PromiseSettledResult<string[]>): void {
  if (result.status === "fulfilled" && result.value.length > 0) {
    record.images = result.value;
  }
}

async function storeAiGraph(db: D1Database, graph: GraphSeed | undefined, drug: DrugRecord): Promise<void> {
  if (!graph?.entities.length) return;
  const entities: GraphEntity[] = [];
  const seenEntities = new Set<string>();
  for (const entity of [{ type: "drug", name: drug.name } as GraphEntity, ...graph.entities]) {
    addGraphEntity(entities, seenEntities, entity);
  }
  const entityNames = new Set(entities.map((entity) => entity.name.toLowerCase()));
  const edges = graph.edges
    .map((edge) => ({ ...edge, source: drug.name }))
    .filter((edge) => entityNames.has(edge.target.toLowerCase()));
  await insertGraphSeed(db, entities, edges, "fda-ai-v2");
}

export async function enrichDrugFromFda(drug: DrugRecord, ai: Ai, db: D1Database): Promise<DrugRecord> {
  if (drug.enriched_at === "STALE" || isStaleEnrichment(drug.enriched_at) || (drug.source.toLowerCase().includes("fda") && (!hasRealText(drug.label_raw) || hasDirtyFdaData(drug)))) {
    return refreshDrugFdaFields(drug, ai, db);
  }

  const rxcui = drug.rxcui ?? await resolveRxNorm(drug.generic_name || drug.name);
  if (!rxcui) return drug;

  const fda = await fetchFdaLabel(rxcui);
  const cleanFda = cleanFdaLabel(fda);
  const [mappedResult, imageResult] = await Promise.allSettled([
    remapFdaWithAi(cleanFda, drug.name, ai),
    fetchDailymedImages(drug.name)
  ]);
  const mapped = mappedResult.status === "fulfilled" ? mappedResult.value : fallbackMapFdaToDrug(cleanFda, drug.name);
  const enriched = fillEmptyDrugFields(drug, mapped);
  enriched.enriched_at = new Date().toISOString();
  applyDailymedImages(enriched, imageResult);
  const saved = await upsertDrug(db, enriched);
  await storeAiGraph(db, mapped.graph, saved);
  return saved;
}

export async function createDrugFromFda(name: string, ai: Ai, db: D1Database): Promise<DrugRecord | null> {
  const rxcui = await resolveRxNorm(name);
  if (!rxcui) return null;

  const fda = await fetchFdaLabel(rxcui);
  const displayName = titleCase(fda.generic_name ?? name);
  const cleanFda = cleanFdaLabel(fda);
  const [mappedResult, imageResult] = await Promise.allSettled([
    remapFdaWithAi(cleanFda, displayName, ai),
    fetchDailymedImages(name)
  ]);
  const mapped = mappedResult.status === "fulfilled" ? mappedResult.value : fallbackMapFdaToDrug(cleanFda, displayName);
  const record = normalizeDrugRecord(mapped, displayName);
  record.enriched_at = new Date().toISOString();
  applyDailymedImages(record, imageResult);
  if (!hasAnyFdaData(record)) return null;
  const saved = await upsertDrug(db, record);
  await storeAiGraph(db, mapped.graph, saved);
  return saved;
}

export async function backfillDrugsFromFda(env: Env, ai: Ai): Promise<{ filled: number; errors: string[] }> {
  const drugs = await getAllDrugs(env.DB);
  let filled = 0;
  const errors: string[] = [];

  for (const drug of drugs) {
    try {
      const enriched = await enrichDrugFromFda(drug, ai, env.DB);
      if (!drugRecordsEqual(drug, enriched)) {
        filled += 1;
      }
    } catch (error) {
      errors.push(`${drug.name}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  return { filled, errors };
}

export function needsFdaEnrichment(drug: DrugRecord): boolean {
  if (drug.enriched_at === "STALE") return true;

  if (!drug.enriched_at) {
    if (hasDirtyFdaData(drug)) return true;
    if (!hasRealText(drug.label_raw) && drug.source.toLowerCase().includes("fda")) return true;
    if (!hasRealList(drug.indications)) return true;
    if (!hasRealList(drug.contraindications)) return true;
    if (!hasRealList(drug.side_effects)) return true;
    if (!drug.rxcui && !drug.source.toLowerCase().includes("fda")) return true;
    return false;
  }

  if (isStaleEnrichment(drug.enriched_at)) return true;

  return false;
}

async function refreshDrugFdaFields(drug: DrugRecord, ai: Ai, db: D1Database): Promise<DrugRecord> {
  const rxcui = drug.rxcui ?? await resolveRxNorm(drug.generic_name || drug.name);
  if (!rxcui) return drug;

  const fda = await fetchFdaLabel(rxcui);
  const cleanFda = cleanFdaLabel(fda);
  const [mappedResult, imageResult] = await Promise.allSettled([
    remapFdaWithAi(cleanFda, drug.name, ai),
    fetchDailymedImages(drug.name)
  ]);
  const mapped = mappedResult.status === "fulfilled" ? mappedResult.value : fallbackMapFdaToDrug(cleanFda, drug.name);
  if (!hasAnyMappedFdaData(mapped)) return drug;

  const enriched: DrugRecord = {
    ...drug,
    ...mapped,
    id: drug.id,
    name: drug.name,
    allergies: drug.allergies ?? null,
    images: drug.images ?? [],
    source: drug.source.toLowerCase().includes("fda") ? drug.source : drug.source ? `${drug.source}+fda` : "fda",
    assembled_at: new Date().toISOString(),
    enriched_at: new Date().toISOString()
  };
  applyDailymedImages(enriched, imageResult);
  const saved = await upsertDrug(db, enriched);
  await storeAiGraph(db, mapped.graph, saved);
  return saved;
}

function fillEmptyDrugFields(existing: DrugRecord, fda: Partial<DrugRecord>): DrugRecord {
  const next: DrugRecord = { ...existing };

  if (!next.rxcui && fda.rxcui) next.rxcui = fda.rxcui;
  if (!hasRealText(next.generic_name) && fda.generic_name) next.generic_name = fda.generic_name;
  if (!hasRealText(next.drug_class) && fda.drug_class) next.drug_class = fda.drug_class;
  if (!hasRealText(next.administration) && fda.administration) next.administration = fda.administration;
  if (!hasRealText(next.pregnancy_category) && fda.pregnancy_category) next.pregnancy_category = fda.pregnancy_category;
  if (fda.label_raw) next.label_raw = fda.label_raw;

  for (const field of ARRAY_FIELDS) {
    const current = next[field];
    const incoming = fda[field];
    if (!hasRealList(current) && Array.isArray(incoming) && incoming.length) {
      next[field] = incoming;
    }
  }

  for (const field of RAW_ARRAY_FIELDS) {
    const incoming = fda[field];
    if (Array.isArray(incoming) && incoming.length) {
      next[field] = incoming;
    }
  }

  if (!next.source.toLowerCase().includes("fda") && hasAnyMappedFdaData(fda)) {
    next.source = next.source ? `${next.source}+fda` : "fda";
  }
  next.assembled_at = new Date().toISOString();
  return next;
}

function normalizeDrugRecord(partial: Partial<DrugRecord>, name: string): DrugRecord {
  return {
    name,
    rxcui: partial.rxcui ?? null,
    generic_name: partial.generic_name ?? name.toLowerCase(),
    drug_class: partial.drug_class ?? null,
    brand_names: partial.brand_names ?? [],
    indications: partial.indications ?? [],
    contraindications: partial.contraindications ?? [],
    black_box_warnings: partial.black_box_warnings ?? [],
    side_effects: partial.side_effects ?? [],
    interactions: partial.interactions ?? [],
    monitoring: partial.monitoring ?? [],
    indications_raw: partial.indications_raw ?? [],
    contraindications_raw: partial.contraindications_raw ?? [],
    side_effects_raw: partial.side_effects_raw ?? [],
    interactions_raw: partial.interactions_raw ?? [],
    monitoring_raw: partial.monitoring_raw ?? [],
    allergies: null,
    administration: partial.administration ?? null,
    pregnancy_category: partial.pregnancy_category ?? null,
    label_raw: partial.label_raw ?? null,
    images: [],
    source: "fda",
    assembled_at: new Date().toISOString(),
    enriched_at: partial.enriched_at ?? null
  };
}

function hasAnyFdaData(drug: DrugRecord): boolean {
  return hasRealList(drug.indications)
    || hasRealList(drug.contraindications)
    || hasRealList(drug.side_effects)
    || hasRealList(drug.interactions)
    || hasRealList(drug.black_box_warnings)
    || hasRealText(drug.label_raw)
    || hasRealText(drug.drug_class);
}

function hasAnyMappedFdaData(drug: Partial<DrugRecord>): boolean {
  return Boolean(drug.rxcui)
    || Boolean(drug.drug_class)
    || Boolean(drug.administration)
    || Boolean(drug.label_raw)
    || ARRAY_FIELDS.some((field) => hasRealList(drug[field]));
}

function hasRealList(items: string[] | undefined): boolean {
  const realItems = (items ?? []).filter((item) => hasRealText(item));
  if (!realItems.length) return false;
  return realItems.some((item) => !isPlaceholder(item));
}

function hasRealText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function isStaleEnrichment(enrichedAt: string | null | undefined): boolean {
  if (!enrichedAt) return false;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const timestamp = new Date(enrichedAt).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp > thirtyDays;
}

function isPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes("review indications in the official label")
    || normalized.includes("check allergy history")
    || normalized.includes("monitor for unexpected adverse reactions")
    || normalized.includes("review official label");
}

function hasDirtyFdaData(drug: DrugRecord): boolean {
  return ARRAY_FIELDS.some((field) => {
    const items = drug[field] ?? [];
    return items.length >= 20 || items.some(isDirtyFdaItem);
  });
}

function isDirtyFdaItem(value: string): boolean {
  return LEADING_FDA_HEADER.test(value)
    || /\(\s*see\s+[^)]*\)/i.test(value)
    || /\[\s*see\s+[^\]]*\]/i.test(value)
    || /^(?:Unnecessary use|Its use should be reserved)\b/i.test(value)
    || /\bClinical Trials Experience\b/i.test(value)
    || value.length > 700
    || /\s+[.,;:!?]/.test(value);
}

const LEADING_FDA_HEADER =
  /^(?:WARNINGS AND PRECAUTIONS|WARNINGS AND CAUTIONS|BOXED WARNING|INDICATIONS AND USAGE|DRUG INTERACTIONS|DOSAGE AND ADMINISTRATION|ADVERSE REACTIONS|CONTRAINDICATIONS|PRECAUTIONS|PREGNANCY|WARNINGS?|WARNING)\b/i;

function drugRecordsEqual(a: DrugRecord, b: DrugRecord): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function fetchRxCui(url: URL): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const payload = (await response.json()) as RxNormResponse;
    return payload.idGroup?.rxnormId?.[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchRxNormName(rxcui: string): Promise<string | null> {
  try {
    const response = await fetch(`https://rxnav.nlm.nih.gov/REST/rxcui/${encodeURIComponent(rxcui)}/properties.json`);
    if (!response.ok) return null;
    const payload = (await response.json()) as RxPropertiesResponse;
    return payload.properties?.name ?? null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtmlAttribute(value: string): string {
  return value.replace(/&amp;/g, "&");
}

function classifyDailymedImage(name: string): DailymedImage["type"] | null {
  const normalized = name.toLowerCase();
  if (normalized.startsWith("label-")) return null;
  if (normalized.includes("structure") || /(?:^|[-_])str\./.test(normalized)) return null;
  if (normalized.includes("package") || normalized.includes("carton") || normalized.includes("bottle")) return "package";
  return "pill";
}

async function fetchOpenFdaLabels(search: string): Promise<OpenFdaLabel[]> {
  const url = new URL("https://api.fda.gov/drug/label.json");
  url.searchParams.set("search", search);
  url.searchParams.set("limit", "10");

  const response = await fetch(url);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`OpenFDA returned ${response.status}`);

  const payload = (await response.json()) as OpenFdaResponse;
  return payload.results ?? [];
}

function escapeFdaSearch(value: string): string {
  return value.replace(/"/g, "").trim();
}

function chooseBestLabel(labels: OpenFdaLabel[]): OpenFdaLabel | null {
  return labels
    .map((label) => ({ label, score: labelScore(label) }))
    .sort((a, b) => b.score - a.score)[0]?.label ?? null;
}

function labelScore(label: OpenFdaLabel): number {
  return [
    label.indications_and_usage,
    label.contraindications,
    label.boxed_warning,
    label.adverse_reactions,
    label.drug_interactions,
    label.dosage_and_administration,
    label.openfda?.pharm_class_epc
  ].filter((value) => value?.length).length;
}

function emptyFdaLabel(rxcui: string): FdaLabelResult {
  return {
    rxcui,
    generic_name: null,
    brand_names: [],
    pharm_class_epc: [],
    indications_and_usage: [],
    contraindications: [],
    boxed_warning: [],
    adverse_reactions: [],
    drug_interactions: [],
    pregnancy: [],
    dosage_and_administration: [],
    warnings_and_cautions: [],
    label_raw: null,
    source: "fda"
  };
}

function cleanArray(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function cleanFdaLabel(fda: FdaLabelResult): FdaLabelResult {
  return {
    ...fda,
    indications_and_usage: cleanFdaSection(fda.indications_and_usage),
    contraindications: cleanFdaSection(fda.contraindications),
    boxed_warning: cleanFdaSection(fda.boxed_warning),
    adverse_reactions: cleanFdaSection(fda.adverse_reactions),
    drug_interactions: cleanFdaSection(fda.drug_interactions),
    pregnancy: cleanFdaSection(fda.pregnancy),
    dosage_and_administration: cleanFdaSection(fda.dosage_and_administration),
    warnings_and_cautions: cleanFdaSection(fda.warnings_and_cautions)
  };
}

function limitSection(values: string[]): string[] {
  return values.slice(0, 20);
}

function splitMedicalText(text: string | undefined, limit: number): string[] {
  if (!text) return [];
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.;:])\s+(?=[A-Z0-9])/)
    .map((item) => item.replace(/^[*•\-\s]+/, "").trim())
    .filter((item) => item.length > 12)
    .slice(0, limit)
    .map((item) => summarize(item, 260))
    .filter(Boolean);
}

function summarize(text: string | undefined, max: number): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}...` : clean;
}

function parsePregnancyCategory(text: string): string | null {
  const match = text.match(/\bPregnancy\s+Category\s+([ABCDX])\b/i);
  return match ? `Pregnancy Category ${match[1].toUpperCase()}` : null;
}

function first(values: string[] | undefined): string | undefined {
  return values?.find((value) => value.trim());
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
