import type { ConditionRecord, DrugClassSummary, DrugRecord, DrugSearchResult, ExplainRequest, GraphEdgeSeed, GraphEntity } from "./types";

type DrugRow = Omit<DrugRecord, "brand_names" | "indications" | "contraindications" | "black_box_warnings" | "side_effects" | "interactions" | "monitoring" | "indications_raw" | "contraindications_raw" | "side_effects_raw" | "interactions_raw" | "monitoring_raw" | "images"> & {
  brand_names: string | null;
  indications: string | null;
  contraindications: string | null;
  black_box_warnings: string | null;
  side_effects: string | null;
  interactions: string | null;
  monitoring: string | null;
  indications_raw: string | null;
  contraindications_raw: string | null;
  side_effects_raw: string | null;
  interactions_raw: string | null;
  monitoring_raw: string | null;
  images: string | null;
};

type ConditionRow = Omit<ConditionRecord, "symptoms" | "treatments" | "related_conditions"> & {
  symptoms: string | null;
  treatments: string | null;
  related_conditions: string | null;
};

type GraphNodeRow = {
  id: number;
  entity_type: string;
  name: string;
  properties: string | null;
  source: string | null;
};

type GraphEdgeRow = {
  id: number;
  source_node_id: number;
  target_node_id: number;
  relationship: string;
  weight: number | null;
  source: string | null;
  source_name: string;
  source_type: string;
  target_name: string;
  target_type: string;
};

export async function searchDrugs(db: D1Database, q: string, limit: number): Promise<DrugSearchResult[]> {
  const term = `%${q.toLowerCase()}%`;
  const result = await db.prepare(
    `SELECT id, name, generic_name, drug_class, brand_names, indications
     FROM drugs
     WHERE lower(name) LIKE ? OR lower(coalesce(generic_name, '')) LIKE ? OR lower(coalesce(brand_names, '')) LIKE ?
     ORDER BY name
     LIMIT ?`
  ).bind(term, term, term, limit).all<DrugRow>();

  return (result.results ?? []).map((row) => ({
    id: row.id ?? 0,
    name: row.name,
    generic_name: row.generic_name,
    drug_class: row.drug_class,
    brand_names: parseJsonArray(row.brand_names),
    indications: parseJsonArray(row.indications)
  }));
}

export async function getDrugClasses(db: D1Database): Promise<DrugClassSummary[]> {
  const result = await db.prepare(
    `WITH graph_class_drugs AS (
       SELECT target.name AS class_name, source.name AS drug_name
       FROM graph_edges edge
       JOIN graph_nodes source ON source.id = edge.source_node_id
       JOIN graph_nodes target ON target.id = edge.target_node_id
       WHERE edge.relationship = 'member_of'
         AND lower(source.entity_type) IN ('drug', 'medication')
         AND lower(target.entity_type) IN ('drug_class', 'medication_class')
       UNION
       SELECT source.name AS class_name, target.name AS drug_name
       FROM graph_edges edge
       JOIN graph_nodes source ON source.id = edge.source_node_id
       JOIN graph_nodes target ON target.id = edge.target_node_id
       WHERE edge.relationship = 'includes'
         AND lower(source.entity_type) IN ('drug_class', 'medication_class')
         AND lower(target.entity_type) IN ('drug', 'medication')
     ),
     class_drugs AS (
       SELECT class_name, drug_name FROM graph_class_drugs
       UNION
       SELECT drug_class AS class_name, name AS drug_name
       FROM drugs
       WHERE coalesce(drug_class, '') <> ''
     )
     SELECT class_name AS name, COUNT(DISTINCT lower(drug_name)) AS count
     FROM class_drugs
     GROUP BY lower(class_name)
     ORDER BY count DESC, name`
  ).all<DrugClassSummary>();

  return result.results ?? [];
}

export async function getDrugsByClass(db: D1Database, className: string, limit = 50): Promise<DrugSearchResult[]> {
  const classTerms = expandClassSearchTerms(className);
  const clauses = classTerms.map(() => "lower(class_name) LIKE ?").join(" OR ");
  const result = await db.prepare(
    `WITH graph_class_drugs AS (
       SELECT target.name AS class_name, source.name AS drug_name
       FROM graph_edges edge
       JOIN graph_nodes source ON source.id = edge.source_node_id
       JOIN graph_nodes target ON target.id = edge.target_node_id
       WHERE edge.relationship = 'member_of'
         AND lower(source.entity_type) IN ('drug', 'medication')
         AND lower(target.entity_type) IN ('drug_class', 'medication_class')
       UNION
       SELECT source.name AS class_name, target.name AS drug_name
       FROM graph_edges edge
       JOIN graph_nodes source ON source.id = edge.source_node_id
       JOIN graph_nodes target ON target.id = edge.target_node_id
       WHERE edge.relationship = 'includes'
         AND lower(source.entity_type) IN ('drug_class', 'medication_class')
         AND lower(target.entity_type) IN ('drug', 'medication')
     ),
     class_drugs AS (
       SELECT class_name, drug_name FROM graph_class_drugs
       UNION
       SELECT drug_class AS class_name, name AS drug_name
       FROM drugs
       WHERE coalesce(drug_class, '') <> ''
     ),
     selected AS (
       SELECT drug_name, MIN(class_name) AS class_name
       FROM class_drugs
       WHERE ${clauses}
       GROUP BY lower(drug_name)
     )
     SELECT d.id, selected.drug_name AS name, d.generic_name, COALESCE(d.drug_class, selected.class_name) AS drug_class,
            d.brand_names, d.indications
     FROM selected
     LEFT JOIN drugs d ON lower(d.name) = lower(selected.drug_name)
     ORDER BY selected.drug_name
     LIMIT ?`
  ).bind(...classTerms.map((term) => `%${term}%`), limit).all<DrugRow>();

  return (result.results ?? []).map((row) => ({
    id: row.id ?? 0,
    name: row.name,
    generic_name: row.generic_name,
    drug_class: row.drug_class,
    brand_names: parseJsonArray(row.brand_names),
    indications: parseJsonArray(row.indications)
  }));
}

export async function getDrugByIdOrName(db: D1Database, idOrName: string): Promise<DrugRecord | null> {
  const isId = /^\d+$/.test(idOrName);
  const stmt = isId
    ? db.prepare("SELECT * FROM drugs WHERE id = ?")
    : db.prepare("SELECT * FROM drugs WHERE lower(name) = lower(?) OR lower(generic_name) = lower(?)");
  const row = isId ? await stmt.bind(Number(idOrName)).first<DrugRow>() : await stmt.bind(idOrName, idOrName).first<DrugRow>();
  return row ? hydrateDrug(row) : null;
}

let schemaReady: Promise<void> | null = null;

export async function ensureDrugSchema(db: D1Database): Promise<void> {
  schemaReady ??= (async () => {
    const columns = await db.prepare("PRAGMA table_info(drugs)").all<{ name: string }>();
    const columnNames = new Set((columns.results ?? []).map((column) => column.name));
    const migrations = [
      ["rxcui", "ALTER TABLE drugs ADD COLUMN rxcui TEXT"],
      ["label_raw", "ALTER TABLE drugs ADD COLUMN label_raw TEXT"],
      ["enriched_at", "ALTER TABLE drugs ADD COLUMN enriched_at TEXT"],
      ["indications_raw", "ALTER TABLE drugs ADD COLUMN indications_raw TEXT"],
      ["contraindications_raw", "ALTER TABLE drugs ADD COLUMN contraindications_raw TEXT"],
      ["side_effects_raw", "ALTER TABLE drugs ADD COLUMN side_effects_raw TEXT"],
      ["interactions_raw", "ALTER TABLE drugs ADD COLUMN interactions_raw TEXT"],
      ["monitoring_raw", "ALTER TABLE drugs ADD COLUMN monitoring_raw TEXT"]
    ] as const;
    for (const [column, sql] of migrations) {
      if (!columnNames.has(column)) await db.prepare(sql).run();
    }
  })();
  await schemaReady;
}

export async function upsertDrug(db: D1Database, drug: DrugRecord): Promise<DrugRecord> {
  await ensureDrugSchema(db);
  const assembledAt = drug.assembled_at ?? new Date().toISOString();
  await db.prepare(
    `INSERT INTO drugs (
      rxcui, name, generic_name, drug_class, brand_names, indications, contraindications, black_box_warnings,
      side_effects, interactions, monitoring, indications_raw, contraindications_raw, side_effects_raw, interactions_raw,
      monitoring_raw, allergies, administration, pregnancy_category, label_raw, images, source, assembled_at, enriched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      rxcui = excluded.rxcui,
      generic_name = excluded.generic_name,
      drug_class = excluded.drug_class,
      brand_names = excluded.brand_names,
      indications = excluded.indications,
      contraindications = excluded.contraindications,
      black_box_warnings = excluded.black_box_warnings,
      side_effects = excluded.side_effects,
      interactions = excluded.interactions,
      monitoring = excluded.monitoring,
      indications_raw = excluded.indications_raw,
      contraindications_raw = excluded.contraindications_raw,
      side_effects_raw = excluded.side_effects_raw,
      interactions_raw = excluded.interactions_raw,
      monitoring_raw = excluded.monitoring_raw,
      allergies = excluded.allergies,
      administration = excluded.administration,
      pregnancy_category = excluded.pregnancy_category,
      label_raw = excluded.label_raw,
      images = excluded.images,
      source = excluded.source,
      assembled_at = excluded.assembled_at,
      enriched_at = excluded.enriched_at`
  ).bind(
    drug.rxcui ?? null,
    drug.name,
    drug.generic_name ?? null,
    drug.drug_class ?? null,
    JSON.stringify(drug.brand_names ?? []),
    JSON.stringify(drug.indications ?? []),
    JSON.stringify(drug.contraindications ?? []),
    JSON.stringify(drug.black_box_warnings ?? []),
    JSON.stringify(drug.side_effects ?? []),
    JSON.stringify(drug.interactions ?? []),
    JSON.stringify(drug.monitoring ?? []),
    JSON.stringify(drug.indications_raw ?? []),
    JSON.stringify(drug.contraindications_raw ?? []),
    JSON.stringify(drug.side_effects_raw ?? []),
    JSON.stringify(drug.interactions_raw ?? []),
    JSON.stringify(drug.monitoring_raw ?? []),
    drug.allergies ?? null,
    drug.administration ?? null,
    drug.pregnancy_category ?? null,
    drug.label_raw ?? null,
    JSON.stringify(drug.images ?? []),
    drug.source,
    assembledAt,
    drug.enriched_at ?? null
  ).run();

  const saved = await getDrugByIdOrName(db, drug.name);
  if (!saved) throw new Error("Drug upsert failed");
  return saved;
}

export async function getCondition(db: D1Database, idOrName: string): Promise<ConditionRecord | null> {
  const isId = /^\d+$/.test(idOrName);
  const row = isId
    ? await db.prepare("SELECT * FROM conditions WHERE id = ?").bind(Number(idOrName)).first<ConditionRow>()
    : await db.prepare("SELECT * FROM conditions WHERE lower(name) = lower(?)").bind(idOrName).first<ConditionRow>();
  return row ? hydrateCondition(row) : null;
}

export async function populateDrugFromGraph(db: D1Database, drugName: string): Promise<DrugRecord | null> {
  const nodes = await getGraphNodesByName(db, drugName, ["drug", "medication"]);
  if (!nodes.length) return null;

  const edges = await getEdgesForNodeIds(db, nodes.map((node) => node.id));
  const graphDrug = collectDrugFromGraph(nodes, edges);
  const existing = await getDrugByIdOrName(db, graphDrug.name);

  return upsertDrug(db, {
    name: graphDrug.name,
    rxcui: existing?.rxcui ?? null,
    generic_name: existing?.generic_name ?? graphDrug.name.toLowerCase(),
    drug_class: firstValue(graphDrug.drugClasses) ?? existing?.drug_class ?? null,
    brand_names: existing?.brand_names ?? [],
    indications: mergeLists(graphDrug.indications, existing?.indications),
    contraindications: mergeLists(graphDrug.contraindications, existing?.contraindications),
    black_box_warnings: existing?.black_box_warnings ?? [],
    side_effects: mergeLists(graphDrug.sideEffects, existing?.side_effects),
    interactions: mergeLists(graphDrug.interactions, existing?.interactions),
    monitoring: mergeLists(graphDrug.monitoring, existing?.monitoring),
    indications_raw: existing?.indications_raw ?? [],
    contraindications_raw: existing?.contraindications_raw ?? [],
    side_effects_raw: existing?.side_effects_raw ?? [],
    interactions_raw: existing?.interactions_raw ?? [],
    monitoring_raw: existing?.monitoring_raw ?? [],
    allergies: existing?.allergies ?? null,
    administration: existing?.administration ?? null,
    pregnancy_category: existing?.pregnancy_category ?? null,
    label_raw: existing?.label_raw ?? null,
    images: existing?.images ?? [],
    source: existing?.source?.includes("graph") ? existing.source : existing?.source ? `${existing.source}+graph` : "graph",
    assembled_at: new Date().toISOString(),
    enriched_at: existing?.enriched_at ?? null
  });
}

export async function getAllDrugs(db: D1Database): Promise<DrugRecord[]> {
  await ensureDrugSchema(db);
  const result = await db.prepare("SELECT * FROM drugs ORDER BY name").all<DrugRow>();
  return (result.results ?? []).map(hydrateDrug);
}

export async function populateAllDrugsFromGraph(db: D1Database): Promise<{ updated: number; errors: string[] }> {
  const result = await db.prepare(
    `SELECT MIN(name) AS name
     FROM graph_nodes
     WHERE lower(entity_type) IN ('drug', 'medication')
     GROUP BY lower(name)
     ORDER BY name`
  ).all<{ name: string }>();

  let updated = 0;
  const errors: string[] = [];
  for (const row of result.results ?? []) {
    try {
      const saved = await populateDrugFromGraph(db, row.name);
      if (saved) updated += 1;
    } catch (error) {
      errors.push(`${row.name}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return { updated, errors };
}

export async function populateConditionFromGraph(db: D1Database, conditionName: string): Promise<ConditionRecord | null> {
  const nodes = await getGraphNodesByName(db, conditionName, ["condition", "condition_or_indication", "therapeutic_use"]);
  if (!nodes.length) return null;

  const edges = await getEdgesForNodeIds(db, nodes.map((node) => node.id));
  const graphCondition = collectConditionFromGraph(nodes, edges);
  const existing = await getCondition(db, graphCondition.name);

  return upsertCondition(db, {
    name: graphCondition.name,
    description: existing?.description || `Graph-derived profile for ${graphCondition.name}.`,
    symptoms: mergeLists(graphCondition.symptoms, existing?.symptoms),
    treatments: mergeLists(graphCondition.treatments, existing?.treatments),
    related_conditions: mergeLists(graphCondition.relatedConditions, existing?.related_conditions),
    source: existing?.source?.includes("graph") ? existing.source : existing?.source ? `${existing.source}+graph` : "graph"
  });
}

export async function populateAllConditionsFromGraph(db: D1Database): Promise<{ updated: number; errors: string[] }> {
  const result = await db.prepare(
    `SELECT MIN(name) AS name
     FROM graph_nodes
     WHERE lower(entity_type) IN ('condition', 'condition_or_indication', 'therapeutic_use')
     GROUP BY lower(name)
     ORDER BY name`
  ).all<{ name: string }>();

  let updated = 0;
  const errors: string[] = [];
  for (const row of result.results ?? []) {
    try {
      const saved = await populateConditionFromGraph(db, row.name);
      if (saved) updated += 1;
    } catch (error) {
      errors.push(`${row.name}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return { updated, errors };
}

async function getGraphNodesByName(db: D1Database, name: string, types: string[]): Promise<GraphNodeRow[]> {
  const typePlaceholders = types.map(() => "?").join(", ");
  const result = await db.prepare(
    `SELECT *
     FROM graph_nodes
     WHERE lower(name) = lower(?)
       AND lower(entity_type) IN (${typePlaceholders})
     ORDER BY id`
  ).bind(name, ...types).all<GraphNodeRow>();
  return result.results ?? [];
}

async function getEdgesForNodeIds(db: D1Database, nodeIds: number[]): Promise<GraphEdgeRow[]> {
  if (!nodeIds.length) return [];
  const placeholders = nodeIds.map(() => "?").join(", ");
  const result = await db.prepare(
    `SELECT edge.*, source.name AS source_name, source.entity_type AS source_type,
            target.name AS target_name, target.entity_type AS target_type
     FROM graph_edges edge
     JOIN graph_nodes source ON source.id = edge.source_node_id
     JOIN graph_nodes target ON target.id = edge.target_node_id
     WHERE edge.source_node_id IN (${placeholders}) OR edge.target_node_id IN (${placeholders})
     ORDER BY edge.relationship, target.name`
  ).bind(...nodeIds, ...nodeIds).all<GraphEdgeRow>();
  return result.results ?? [];
}

function collectDrugFromGraph(nodes: GraphNodeRow[], edges: GraphEdgeRow[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const canonicalName = chooseCanonicalName(nodes);
  const fields = {
    name: canonicalName,
    drugClasses: new Set<string>(),
    indications: new Set<string>(),
    contraindications: new Set<string>(),
    sideEffects: new Set<string>(),
    interactions: new Set<string>(),
    monitoring: new Set<string>()
  };

  for (const edge of edges) {
    const sourceIsDrug = ids.has(edge.source_node_id);
    const targetIsDrug = ids.has(edge.target_node_id);
    const rel = edge.relationship;
    const otherName = sourceIsDrug ? edge.target_name : edge.source_name;
    if (!otherName || sameName(otherName, canonicalName)) continue;

    if (sourceIsDrug) {
      if (rel === "member_of" || rel === "is_classified_as") fields.drugClasses.add(otherName);
      else if (["used_for", "treats_or_indicated_for", "treats", "therapeutic_use"].includes(rel)) fields.indications.add(otherName);
      else if (["contraindicated_with", "use_caution_or_avoid_with", "contraindicated_or_caution_with"].includes(rel)) fields.contraindications.add(otherName);
      else if (["may_cause", "adverse_effect_risk", "can_cause"].includes(rel)) fields.sideEffects.add(otherName);
      else if (["interacts_with", "interaction_risk"].includes(rel)) fields.interactions.add(otherName);
      else if (["monitor", "requires_monitoring"].includes(rel)) fields.monitoring.add(otherName);
    } else if (targetIsDrug) {
      if (rel === "includes" && isClassType(edge.source_type)) fields.drugClasses.add(otherName);
      else if (["treated_by", "used_for", "treats_or_indicated_for", "treats"].includes(rel)) fields.indications.add(otherName);
      else if (["interacts_with", "interaction_risk"].includes(rel)) fields.interactions.add(otherName);
    }
  }

  return fields;
}

function collectConditionFromGraph(nodes: GraphNodeRow[], edges: GraphEdgeRow[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const canonicalName = chooseCanonicalName(nodes);
  const fields = {
    name: canonicalName,
    symptoms: new Set<string>(),
    treatments: new Set<string>(),
    relatedConditions: new Set<string>()
  };

  for (const edge of edges) {
    const sourceIsCondition = ids.has(edge.source_node_id);
    const targetIsCondition = ids.has(edge.target_node_id);
    const otherName = sourceIsCondition ? edge.target_name : edge.source_name;
    if (!otherName || sameName(otherName, canonicalName)) continue;

    if (sourceIsCondition) {
      if (edge.relationship === "can_cause") fields.symptoms.add(otherName);
      else if (["treated_by", "treats", "used_for"].includes(edge.relationship)) fields.treatments.add(otherName);
      else if (["includes", "associated_with", "related_to"].includes(edge.relationship) && isConditionType(edge.target_type)) fields.relatedConditions.add(otherName);
    } else if (targetIsCondition) {
      if (["used_for", "treats_or_indicated_for", "treats", "treated_by", "therapeutic_use"].includes(edge.relationship)) fields.treatments.add(otherName);
      else if (["includes", "associated_with", "related_to"].includes(edge.relationship) && isConditionType(edge.source_type)) fields.relatedConditions.add(otherName);
    }
  }

  return fields;
}

export async function upsertCondition(db: D1Database, condition: ConditionRecord): Promise<ConditionRecord> {
  await db.prepare(
    `INSERT INTO conditions (name, description, symptoms, treatments, related_conditions, source)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      symptoms = excluded.symptoms,
      treatments = excluded.treatments,
      related_conditions = excluded.related_conditions,
      source = excluded.source`
  ).bind(
    condition.name,
    condition.description ?? null,
    JSON.stringify(condition.symptoms ?? []),
    JSON.stringify(condition.treatments ?? []),
    JSON.stringify(condition.related_conditions ?? []),
    condition.source ?? null
  ).run();

  const saved = await getCondition(db, condition.name);
  if (!saved) throw new Error("Condition upsert failed");
  return saved;
}

export async function getExplainCache(db: D1Database, request: ExplainRequest): Promise<string | null> {
  const row = await db.prepare(
    "SELECT explanation FROM explain_cache WHERE term = ? AND coalesce(drug, '') = ? AND coalesce(context, '') = ? ORDER BY id DESC LIMIT 1"
  ).bind(request.term, request.drug ?? "", request.context ?? "").first<{ explanation: string }>();
  return row?.explanation ?? null;
}

export async function setExplainCache(db: D1Database, request: ExplainRequest, explanation: string): Promise<void> {
  await db.prepare("INSERT INTO explain_cache (term, drug, context, explanation) VALUES (?, ?, ?, ?)")
    .bind(request.term, request.drug ?? null, request.context ?? null, explanation)
    .run();
}

export async function insertGraphSeed(db: D1Database, entities: GraphEntity[], edges: GraphEdgeSeed[], source: string): Promise<void> {
  const entityIds = new Map<string, number>();
  for (const entity of entities) {
    await db.prepare(
      "INSERT INTO graph_nodes (entity_type, name, properties, source) VALUES (?, ?, ?, ?)"
    ).bind(entity.type, entity.name, JSON.stringify(entity.properties ?? {}), source).run();
    const row = await db.prepare(
      "SELECT id FROM graph_nodes WHERE entity_type = ? AND name = ? ORDER BY id DESC LIMIT 1"
    ).bind(entity.type, entity.name).first<{ id: number }>();
    if (row) entityIds.set(entity.name.toLowerCase(), row.id);
  }

  for (const edge of edges) {
    const sourceId = entityIds.get(edge.source.toLowerCase());
    const targetId = entityIds.get(edge.target.toLowerCase());
    if (!sourceId || !targetId) continue;
    await db.prepare(
      "INSERT INTO graph_edges (source_node_id, target_node_id, relationship, weight, source) VALUES (?, ?, ?, ?, ?)"
    ).bind(sourceId, targetId, edge.relationship, edge.weight ?? 1, source).run();
  }
}

export async function getGraphNodes(db: D1Database, type?: string | null, limit = 5000): Promise<unknown[]> {
  const result = type
    ? await db.prepare("SELECT * FROM graph_nodes WHERE entity_type = ? ORDER BY name LIMIT ?").bind(type, limit).all()
    : await db.prepare("SELECT * FROM graph_nodes ORDER BY name LIMIT ?").bind(limit).all();
  return result.results ?? [];
}

export async function getGraphNodeByName(db: D1Database, name: string): Promise<unknown | null> {
  const result = await db.prepare("SELECT * FROM graph_nodes WHERE LOWER(name) = LOWER(?) LIMIT 1").bind(name).all();
  return (result.results ?? [])[0] ?? null;
}

export async function getGraphEdges(db: D1Database, nodeId?: number): Promise<unknown[]> {
  const result = nodeId
    ? await db.prepare(
      `SELECT e.*, s.name AS source_name, t.name AS target_name
       FROM graph_edges e
       JOIN graph_nodes s ON s.id = e.source_node_id
       JOIN graph_nodes t ON t.id = e.target_node_id
       WHERE e.source_node_id = ? OR e.target_node_id = ?
       ORDER BY e.relationship`
    ).bind(nodeId, nodeId).all()
    : await db.prepare("SELECT * FROM graph_edges ORDER BY id DESC LIMIT 200").all();
  return result.results ?? [];
}

function hydrateDrug(row: DrugRow): DrugRecord {
  return {
    ...row,
    brand_names: parseJsonArray(row.brand_names),
    indications: parseJsonArray(row.indications),
    contraindications: parseJsonArray(row.contraindications),
    black_box_warnings: parseJsonArray(row.black_box_warnings),
    side_effects: parseJsonArray(row.side_effects),
    interactions: parseJsonArray(row.interactions),
    monitoring: parseJsonArray(row.monitoring),
    indications_raw: parseJsonArray(row.indications_raw),
    contraindications_raw: parseJsonArray(row.contraindications_raw),
    side_effects_raw: parseJsonArray(row.side_effects_raw),
    interactions_raw: parseJsonArray(row.interactions_raw),
    monitoring_raw: parseJsonArray(row.monitoring_raw),
    images: parseJsonArray(row.images)
  };
}

function hydrateCondition(row: ConditionRow): ConditionRecord {
  return {
    ...row,
    symptoms: parseJsonArray(row.symptoms),
    treatments: parseJsonArray(row.treatments),
    related_conditions: parseJsonArray(row.related_conditions)
  };
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function mergeLists(...lists: Array<Iterable<string> | string[] | undefined | null>): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const value = raw.trim();
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      merged.push(value);
    }
  }
  return merged;
}

function firstValue(values: Iterable<string>): string | null {
  for (const value of values) return value;
  return null;
}

function chooseCanonicalName(nodes: GraphNodeRow[]): string {
  return nodes.map((node) => node.name).sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? "";
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function isClassType(type: string): boolean {
  return ["drug_class", "medication_class"].includes(type.toLowerCase());
}

function isConditionType(type: string): boolean {
  return ["condition", "condition_or_indication", "therapeutic_use"].includes(type.toLowerCase());
}

function expandClassSearchTerms(className: string): string[] {
  const normalized = className.trim().toLowerCase();
  const termsByCategory: Record<string, string[]> = {
    cardiovascular: ["cardio", "cardiac", "heart", "antihypertensive", "beta blocker", "ace inhibitor", "arb", "diuretic", "antiarrhythmic", "anticoagulant", "statins", "fibrate", "cholesterol", "calcium channel", "thrombolytic"],
    "anti-infectives": ["antibiotic", "antiviral", "antifungal", "anti-infective", "cephalosporin", "penicillin", "macrolide", "fluoroquinolone", "aminoglycoside"],
    "cns/pain": ["analgesic", "opioid", "nsaid", "benzodiazepine", "antidepressant", "anticonvulsant", "cns", "sedative", "pain"],
    pulmonary: ["pulmonary", "bronchodilator", "beta2", "beta₂", "saba", "laba", "corticosteroid", "anticholinergic"],
    gi: ["gastro", "antiemetic", "ppi", "proton pump", "h2", "laxative", "antidiarrheal"],
    endocrine: ["insulin", "diabetes", "antidiabetic", "thyroid", "corticosteroid", "endocrine"],
    heme: ["anticoagulant", "antiplatelet", "thrombolytic", "hematologic", "heme", "coagulation"]
  };
  const mapped = termsByCategory[normalized];
  return mapped ?? [normalized];
}

export interface QaLogEntry {
  endpoint: string;
  query: string;
  drug?: string | null;
  section_context?: string | null;
  mode?: string;
  drug_data_snapshot?: string | null;
  search_results_snapshot?: string | null;
  response: string;
  response_length: number;
  cached: number;
}

export async function logQa(db: D1Database, entry: QaLogEntry): Promise<void> {
  await db.prepare(
    `INSERT INTO qa_log (endpoint, query, drug, section_context, mode, drug_data_snapshot, search_results_snapshot, response, response_length, cached)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    entry.endpoint,
    entry.query,
    entry.drug ?? null,
    entry.section_context ?? null,
    entry.mode ?? "quick",
    entry.drug_data_snapshot ?? null,
    entry.search_results_snapshot ?? null,
    entry.response,
    entry.response_length,
    entry.cached
  ).run();
}
