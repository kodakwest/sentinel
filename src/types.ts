export interface Env {
  DB: D1Database;
  AI: Ai;
  SEARCH: AiSearchInstance;
  ASSETS: Fetcher;
  OPENFDA_API_KEY: string;
  ADMIN_SECRET?: string;
}

export interface DrugRecord {
  id?: number;
  rxcui?: string | null;
  name: string;
  generic_name?: string | null;
  drug_class?: string | null;
  brand_names: string[];
  indications: string[];
  contraindications: string[];
  black_box_warnings: string[];
  side_effects: string[];
  interactions: string[];
  monitoring: string[];
  indications_raw?: string[];
  contraindications_raw?: string[];
  side_effects_raw?: string[];
  interactions_raw?: string[];
  monitoring_raw?: string[];
  allergies?: string | null;
  administration?: string | null;
  pregnancy_category?: string | null;
  label_raw?: string | null;
  images: string[];
  source: string;
  assembled_at?: string | null;
  enriched_at?: string | null;
}

export interface DrugSearchResult {
  id: number;
  name: string;
  generic_name?: string | null;
  drug_class?: string | null;
  brand_names: string[];
  indications: string[];
}

export interface DrugClassSummary {
  name: string;
  count: number;
}

export interface ConditionRecord {
  id?: number;
  name: string;
  description?: string | null;
  symptoms: string[];
  treatments: string[];
  related_conditions: string[];
  source?: string | null;
}

export interface ExplainRequest {
  term: string;
  drug?: string;
  context?: string;
  mode?: string;
}

export interface AskRequest {
  query: string;
  drug?: string;
  context?: string;
  mode?: string;
}

export interface IngestRequest {
  text: string;
  source: string;
  merge?: boolean;
}

export interface GraphEntity {
  type: string;
  name: string;
  properties?: Record<string, unknown>;
}

export interface GraphEdgeSeed {
  source: string;
  target: string;
  relationship: string;
  weight?: number;
}

export interface GraphSeed {
  entities: GraphEntity[];
  edges: GraphEdgeSeed[];
}
