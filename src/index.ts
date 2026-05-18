import { askNurseClippy, explainTerm } from "./ai";
import { fetchDailyMedDrug } from "./dailymed";
import { ensureDrugSchema, getAllDrugs, getCondition, getDrugByIdOrName, getDrugClasses, getDrugsByClass, getExplainCache, getGraphEdges, getGraphNodes, insertGraphSeed, logQa, populateAllConditionsFromGraph, populateAllDrugsFromGraph, populateDrugFromGraph, searchDrugs, setExplainCache, upsertCondition, upsertDrug } from "./db";
import { backfillDrugsFromFda, createDrugFromFda, enrichDrugFromFda, needsFdaEnrichment } from "./fda";
import { ingestKnowledge } from "./ingest";
import { assertAuthConfig, authenticateRequest, clearSessionCookie, consumeMagicLink, createSessionCookie, requestMagicLink, requireAuth } from "./auth";
import { ensureSystemSchema } from "./bootstrap";
import type { AskRequest, ConditionRecord, DrugRecord, Env, ExplainRequest, GraphSeed, IngestRequest } from "./types";
import { clientIp, corsHeaders, sanitizeRedirectUrl, sha256 } from "./utils";
import type { ExecutionContext } from "@cloudflare/workers-types";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request, env) });
    const url = new URL(request.url);

    try {
      assertAuthConfig(env);
      await ensureSystemSchema(env.DB);

      if (!url.pathname.startsWith("/api/admin/") && !url.pathname.startsWith("/api/auth/")) {
        const rateLimitCheck = await checkRateLimit(request, env);
        if (rateLimitCheck) return rateLimitCheck;
      }
      ctx.waitUntil(ensureDrugSchema(env.DB).catch(() => {}));
      
      // Auth Routes
      if (url.pathname === "/api/auth/login" && request.method === "POST") return handleRequestMagicLink(request, env);
      if (url.pathname === "/api/auth/login" && request.method === "GET") return handleConsumeMagicLink(request, url, env);
      if (url.pathname === "/api/auth/logout" && request.method === "POST") return handleLogout(request, env);
      if (url.pathname === "/api/auth/me" && request.method === "GET") return handleAuthMe(request, env);
      
      // Public / Protected logic
      const isPublicApi = url.pathname === "/api/status" || url.pathname.startsWith("/api/drugs/") || url.pathname.startsWith("/api/conditions/") || url.pathname.startsWith("/api/graph/");
      const isAdminApi = url.pathname.startsWith("/api/admin/");
      const isAuthApi = url.pathname.startsWith("/api/auth/");
      
      // For any API that is not explicitly public, admin, or auth, we require authentication
      if (url.pathname.startsWith("/api/") && !isPublicApi && !isAdminApi && !isAuthApi) {
        const authResponse = await requireAuth(request, env);
        if (authResponse instanceof Response) return authResponse;
      }
      if (url.pathname === "/api/drugs/search" && request.method === "GET") return handleDrugSearch(request, url, env);
      if (url.pathname === "/api/drugs/classes" && request.method === "GET") return handleDrugClasses(request, env);
      if (url.pathname === "/api/drugs/list-all" && request.method === "GET") return handleDrugListAll(request, env);
      if (url.pathname.startsWith("/api/drugs/by-class/") && request.method === "GET") return handleDrugsByClass(request, url, env);
      if (url.pathname.startsWith("/api/drugs/") && request.method === "GET") return handleDrugDossier(request, url, env, ctx);
      if (url.pathname.startsWith("/api/conditions/") && request.method === "GET") return handleCondition(request, url, env);
      if ((url.pathname === "/api/admin/backfill" || url.pathname === "/api/admin/backfill-fda") && request.method === "POST") return handleBackfillFda(request, env);
      if (url.pathname.startsWith("/api/admin/refresh-drug/") && request.method === "POST") return handleRefreshDrug(request, url, env);
      if (url.pathname === "/api/admin/refresh-all" && request.method === "POST") return handleRefreshAll(request, env);
      if (url.pathname === "/api/admin/refresh-batch" && request.method === "POST") return handleRefreshBatch(request, env);
      if (url.pathname === "/api/admin/populate-all" && request.method === "POST") return handlePopulateAll(request, env);
      if (url.pathname === "/api/admin/update-drug" && request.method === "POST") return handleAdminUpdateDrug(request, env);
      if (url.pathname === "/api/admin/push-graph" && request.method === "POST") return handleAdminPushGraph(request, env);
      if (url.pathname === "/api/explain" && request.method === "POST") return handleExplain(request, env, ctx);
      if (url.pathname === "/api/ask" && request.method === "POST") return handleAsk(request, env, ctx);
      if (url.pathname === "/api/ingest" && request.method === "POST") return handleIngest(request, env);
      if (url.pathname === "/api/graph/nodes" && request.method === "GET") return json(request, env, { nodes: await getGraphNodes(env.DB, url.searchParams.get("type")) });
      if (url.pathname === "/api/graph/edges" && request.method === "GET") {
        const nodeId = url.searchParams.get("node_id");
        return json(request, env, { edges: await getGraphEdges(env.DB, nodeId ? Number(nodeId) : undefined) });
      }
      if (url.pathname === "/api/admin/qa-log" && request.method === "GET") return handleQaLog(request, env);
      if (url.pathname.startsWith("/api/")) return json(request, env, { error: "Not found" }, 404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      console.error("Request failed", { path: url.pathname, message, error });
      return json(request, env, { error: message }, 500);
    }
  }
};

async function handleDrugSearch(request: Request, url: URL, env: Env): Promise<Response> {
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limit = clamp(url.searchParams.get("limit"), 20, 1, 50);
  if (!q) return json(request, env, { results: [], total: 0 });

  let results = await searchDrugs(env.DB, q, limit);
  if (!results.length) {
    const assembled = await assembleDrug(q, env);
    const saved = await upsertDrug(env.DB, assembled);
    results = [{
      id: saved.id ?? 0,
      name: saved.name,
      generic_name: saved.generic_name,
      drug_class: saved.drug_class,
      brand_names: saved.brand_names,
      indications: saved.indications
    }];
  }
  return json(request, env, { results, total: results.length });
}

async function handleDrugClasses(request: Request, env: Env): Promise<Response> {
  const classes = await getDrugClasses(env.DB);
  return json(request, env, { classes, total: classes.length });
}

async function handleDrugsByClass(request: Request, url: URL, env: Env): Promise<Response> {
  const className = decodeURIComponent(url.pathname.replace("/api/drugs/by-class/", "")).trim();
  const limit = clamp(url.searchParams.get("limit"), 50, 1, 100);
  if (!className) return json(request, env, { results: [], total: 0 });
  const results = await getDrugsByClass(env.DB, className, limit);
  return json(request, env, { results, total: results.length, className });
}

async function handleDrugListAll(request: Request, env: Env): Promise<Response> {
  if (!isAdminRequest(request, env)) return json(request, env, { error: "Unauthorized" }, 401);
  const drugs = await getAllDrugs(env.DB);
  return json(request, env, {
    drugs: drugs.map((drug) => ({
      id: drug.id,
      name: drug.name,
      generic_name: drug.generic_name,
      source: drug.source,
      has_label_raw: Boolean(drug.label_raw?.trim()),
      enriched_at: drug.enriched_at ?? null
    })),
    total: drugs.length
  });
}

async function handleQaLog(request: Request, env: Env): Promise<Response> {
  if (!isAdminRequest(request, env)) return json(request, env, { error: "Unauthorized" }, 401);
  const url = new URL(request.url);
  const limit = clamp(url.searchParams.get("limit"), 20, 1, 100);
  const drug = url.searchParams.get("drug");

  let result;
  if (drug) {
    result = await env.DB.prepare(
      "SELECT * FROM qa_log WHERE drug = ? ORDER BY created_at DESC LIMIT ?"
    ).bind(drug, limit).all();
  } else {
    result = await env.DB.prepare(
      "SELECT * FROM qa_log ORDER BY created_at DESC LIMIT ?"
    ).bind(limit).all();
  }
  return json(request, env, { logs: result.results ?? [] });
}

async function handleDrugDossier(request: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const idOrName = decodeURIComponent(url.pathname.replace("/api/drugs/", ""));
  const cached = await getDrugByIdOrName(env.DB, idOrName);
  // If we have cached data, return it immediately and enrich in background
  if (cached) {
    if (needsFdaEnrichment(cached)) {
      ctx.waitUntil(enrichDrugFromFda(cached, env.AI, env.DB));
    }
    return json(request, env, { drug: cached, cached: true });
  }

  const fromFda = await createDrugFromFda(idOrName, env.AI, env.DB);
  if (fromFda) {
    return json(request, env, { drug: fromFda, cached: false });
  }

  const fromGraph = await populateDrugFromGraph(env.DB, idOrName);
  if (fromGraph) return json(request, env, { drug: fromGraph, cached: false });

  const assembled = await assembleDrug(idOrName, env);
  const saved = await upsertDrug(env.DB, assembled);
  return json(request, env, { drug: saved, cached: false });
}

async function handleCondition(request: Request, url: URL, env: Env): Promise<Response> {
  const idOrName = decodeURIComponent(url.pathname.replace("/api/conditions/", ""));
  const cached = await getCondition(env.DB, idOrName);
  if (cached) return json(request, env, { condition: cached, cached: true });

  const assembled = await assembleCondition(idOrName);
  const saved = await upsertCondition(env.DB, assembled);
  return json(request, env, { condition: saved, cached: false });
}

async function handleBackfillFda(request: Request, env: Env): Promise<Response> {
  if (!isAdminRequest(request, env)) return json(request, env, { error: "Unauthorized" }, 401);
  const result = await backfillDrugsFromFda(env, env.AI);
  return json(request, env, result);
}

async function handleRefreshDrug(request: Request, url: URL, env: Env): Promise<Response> {
  if (!isAdminRequest(request, env)) return json(request, env, { error: "Unauthorized" }, 401);
  const name = decodeURIComponent(url.pathname.replace("/api/admin/refresh-drug/", "")).trim();
  if (!name) return json(request, env, { error: "Drug name is required" }, 400);

  const drug = await getDrugByIdOrName(env.DB, name);
  if (!drug?.id) return json(request, env, { error: "Drug not found" }, 404);

  await markDrugsStale(env.DB, [drug.id]);
  return json(request, env, { status: "marked for refresh", name: drug.name, next_load: "Will re-enrich on next dossier view" });
}

async function handleRefreshAll(request: Request, env: Env): Promise<Response> {
  if (!isAdminRequest(request, env)) return json(request, env, { error: "Unauthorized" }, 401);
  const result = await env.DB.prepare("UPDATE drugs SET enriched_at = 'STALE', assembled_at = datetime('now')").run();
  return json(request, env, { status: "marked for refresh", count: result.meta?.changes ?? null, next_load: "Will re-enrich on next dossier view" });
}

async function handleRefreshBatch(request: Request, env: Env): Promise<Response> {
  if (!isAdminRequest(request, env)) return json(request, env, { error: "Unauthorized" }, 401);
  const body = await readJson<{ names?: string[] } | string[]>(request);
  const names = Array.isArray(body) ? body : body.names;
  if (!Array.isArray(names) || !names.length) return json(request, env, { error: "names array is required" }, 400);

  const ids: number[] = [];
  const missing: string[] = [];
  for (const rawName of names) {
    const name = String(rawName ?? "").trim();
    if (!name) continue;
    const drug = await getDrugByIdOrName(env.DB, name);
    if (drug?.id) ids.push(drug.id);
    else missing.push(name);
  }

  if (ids.length) await markDrugsStale(env.DB, ids);
  return json(request, env, {
    status: "marked for refresh",
    count: ids.length,
    missing,
    next_load: "Will re-enrich on next dossier view"
  });
}

async function handlePopulateAll(request: Request, env: Env): Promise<Response> {
  if (!isAdminRequest(request, env)) return json(request, env, { error: "Unauthorized" }, 401);

  const [drugs, conditions] = await Promise.all([
    populateAllDrugsFromGraph(env.DB),
    populateAllConditionsFromGraph(env.DB)
  ]);
  return json(request, env, { drugs, conditions });
}

async function handleAdminUpdateDrug(request: Request, env: Env): Promise<Response> {
  if (!isAdminRequest(request, env)) return json(request, env, { error: "Unauthorized" }, 401);
  const body = await readJson<{ drug?: DrugRecord } & Partial<DrugRecord>>(request);
  const incoming = body.drug ?? body;
  if (!incoming.name?.trim()) return json(request, env, { error: "drug.name is required" }, 400);

  const existing = await getDrugByIdOrName(env.DB, incoming.name);
  const drug: DrugRecord = {
    ...existing,
    ...incoming,
    id: existing?.id,
    name: existing?.name ?? incoming.name.trim(),
    rxcui: incoming.rxcui ?? existing?.rxcui ?? null,
    generic_name: incoming.generic_name ?? existing?.generic_name ?? incoming.name.toLowerCase(),
    drug_class: incoming.drug_class ?? existing?.drug_class ?? null,
    brand_names: incoming.brand_names ?? existing?.brand_names ?? [],
    indications: incoming.indications ?? existing?.indications ?? [],
    contraindications: incoming.contraindications ?? existing?.contraindications ?? [],
    black_box_warnings: incoming.black_box_warnings ?? existing?.black_box_warnings ?? [],
    side_effects: incoming.side_effects ?? existing?.side_effects ?? [],
    interactions: incoming.interactions ?? existing?.interactions ?? [],
    monitoring: incoming.monitoring ?? existing?.monitoring ?? [],
    indications_raw: incoming.indications_raw ?? existing?.indications_raw ?? [],
    contraindications_raw: incoming.contraindications_raw ?? existing?.contraindications_raw ?? [],
    side_effects_raw: incoming.side_effects_raw ?? existing?.side_effects_raw ?? [],
    interactions_raw: incoming.interactions_raw ?? existing?.interactions_raw ?? [],
    monitoring_raw: incoming.monitoring_raw ?? existing?.monitoring_raw ?? [],
    allergies: incoming.allergies ?? existing?.allergies ?? null,
    administration: incoming.administration ?? existing?.administration ?? null,
    pregnancy_category: incoming.pregnancy_category ?? existing?.pregnancy_category ?? null,
    label_raw: incoming.label_raw ?? existing?.label_raw ?? null,
    images: incoming.images ?? existing?.images ?? [],
    source: incoming.source ?? existing?.source ?? "admin",
    assembled_at: new Date().toISOString(),
    enriched_at: incoming.enriched_at ?? existing?.enriched_at ?? null
  };

  const saved = await upsertDrug(env.DB, drug);
  return json(request, env, { drug: saved });
}

async function handleAdminPushGraph(request: Request, env: Env): Promise<Response> {
  if (!isAdminRequest(request, env)) return json(request, env, { error: "Unauthorized" }, 401);
  const body = await readJson<GraphSeed & { source?: string }>(request);
  const entities = Array.isArray(body.entities) ? body.entities.filter((entity) => entity.type?.trim() && entity.name?.trim()) : [];
  const edges = Array.isArray(body.edges) ? body.edges.filter((edge) => edge.source?.trim() && edge.target?.trim() && edge.relationship?.trim()) : [];
  if (!entities.length) return json(request, env, { error: "entities are required" }, 400);

  await insertGraphSeed(env.DB, entities, edges, body.source || "label_remap");
  return json(request, env, { inserted: { entities: entities.length, edges: edges.length } });
}

async function handleExplain(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson<ExplainRequest>(request);
  if (!body.term?.trim()) return json(request, env, { error: "term is required" }, 400);
  const drugName = body.drug?.trim();
  const baseContext = body.context?.trim();
  const mode = body.mode || "quick";

  // Build drug context from D1
  const drug = drugName ? await getDrugByIdOrName(env.DB, drugName) : null;
  const drugData = drug ? buildContextForAsk(drug) : "";

  // Search AI Search for relevant context
  let searchContext = "";
  try {
    const searchResponse = await env.SEARCH.search({
      query: [body.term, drugName, baseContext].filter(Boolean).join(" "),
      ai_search_options: {
        retrieval: { max_num_results: 3, match_threshold: 0.3 }
      }
    });
    if (searchResponse?.chunks?.length) {
      searchContext = searchResponse.chunks.map((c: { item?: { key?: string }; text?: string }) => `[${c.item?.key}] ${c.text}`).join("\n\n");
    }
  } catch {
    searchContext = "(Knowledge search unavailable)";
  }

  const fullQuery = `Explain for a registered nurse: ${body.term}${drugName ? ` (related to ${drugName})` : ""}${baseContext ? `\nClinical context: ${baseContext}` : ""}`;

  // Check cache
  const normalized = { term: body.term.trim(), drug: drugName, context: `${mode}\n${fullQuery}` };
  const cached = await getExplainCache(env.DB, normalized);
  if (cached) {
    ctx.waitUntil(logQa(env.DB, {
      endpoint: "explain",
      query: body.term,
      drug: drugName || null,
      section_context: baseContext || null,
      mode,
      drug_data_snapshot: drugData ? drugData.slice(0, 2000) : null,
      search_results_snapshot: searchContext ? searchContext.slice(0, 2000) : null,
      response: cached,
      response_length: cached.length,
      cached: 1
    }));
    return json(request, env, { explanation: cached, cached: true });
  }

  const explanation = await askNurseClippy(env.AI, fullQuery, drugData, searchContext, mode);
  await setExplainCache(env.DB, normalized, explanation);
  ctx.waitUntil(logQa(env.DB, {
    endpoint: "explain",
    query: body.term,
    drug: drugName || null,
    section_context: baseContext || null,
    mode,
    drug_data_snapshot: drugData ? drugData.slice(0, 2000) : null,
    search_results_snapshot: searchContext ? searchContext.slice(0, 2000) : null,
    response: explanation,
    response_length: explanation.length,
    cached: 0
  }));
  return json(request, env, { explanation, cached: false });
}

async function buildDrugDataContext(env: Env, drugName: string, requestContext?: string, cachedDrug?: DrugRecord | null): Promise<string> {
  const drug = cachedDrug === undefined ? await getDrugByIdOrName(env.DB, drugName) : cachedDrug;
  if (!drug) {
    return [
      "Drug data: no cached drug record found in DoseAtlas database.",
      "Source badge: ⚪ General Knowledge only.",
      "Boundary: For specific warnings, contraindications, interactions, adverse effects, or monitoring not listed here, tell the nurse to consult the official label or facility drug guide."
    ].join("\n");
  }

  const badge = sourceBadge(drug.source);
  const conditionSummaries = await getConditionSummaries(env, [
    ...drug.indications,
    ...drug.contraindications
  ]);

  return [
    "Drug data from DoseAtlas:",
    `Source badge to use for listed drug facts: ${badge} ${sourceLabel(badge)}`,
    `Stored source: ${drug.source || "unknown"}`,
    `Requested context: ${requestContext || "General question"}`,
    `Name: ${drug.name}`,
    drug.generic_name ? `Generic name: ${drug.generic_name}` : "",
    drug.drug_class ? `Drug class: ${drug.drug_class}` : "",
    formatContextList("Indications", drug.indications),
    formatContextList("Contraindications", drug.contraindications),
    formatContextList("Black box warnings", drug.black_box_warnings),
    formatContextList("Side effects", drug.side_effects),
    formatContextList("Interactions", drug.interactions),
    formatContextList("Monitoring", drug.monitoring),
    drug.administration ? `Administration: ${drug.administration}` : "",
    drug.pregnancy_category ? `Pregnancy category: ${drug.pregnancy_category}` : "",
    conditionSummaries ? `Related condition data from conditions table:\n${conditionSummaries}` : "",
    "Boundary: If a requested drug-specific fact is not listed above, do not infer it. Say it is not in the curated database and direct the nurse to the official label or facility drug guide."
    ].filter(Boolean).join("\n");
}

function buildDrugCacheContext(drug: DrugRecord): string {
  return [
    `Stored source: ${drug.source || "unknown"}`,
    formatContextList("Indications", drug.indications),
    formatContextList("Contraindications", drug.contraindications),
    formatContextList("Black box warnings", drug.black_box_warnings),
    formatContextList("Side effects", drug.side_effects),
    formatContextList("Interactions", drug.interactions),
    formatContextList("Monitoring", drug.monitoring)
  ].join("\n");
}

type DrugSection = "indications" | "contraindications" | "black_box_warnings" | "side_effects" | "interactions" | "monitoring";

function getDrugSection(term: string): DrugSection | null {
  const normalized = term.toLowerCase();
  if (normalized.includes("contraindication") || normalized.includes("avoid")) return "contraindications";
  if (normalized.includes("indication") || normalized.includes("used for")) return "indications";
  if (normalized.includes("black box") || normalized.includes("boxed warning") || normalized.includes("bbw")) return "black_box_warnings";
  if (normalized.includes("side effect") || normalized.includes("adverse")) return "side_effects";
  if (normalized.includes("interaction")) return "interactions";
  if (normalized.includes("monitor")) return "monitoring";
  return null;
}

function explainDrugSectionFromData(drug: DrugRecord | null, requestedDrug: string, section: DrugSection): string {
  if (!drug) {
    return [
      `• ⚪ This is not in my curated database — consult the official label or your facility drug guide for ${requestedDrug}.`,
      "",
      "Source: ⚪ General Knowledge boundary",
      "Disclaimer: No DoseAtlas drug record was found, so drug-specific warnings, contraindications, interactions, adverse effects, and monitoring were not inferred."
    ].join("\n");
  }

  const items = drug[section];
  const badge = sourceBadge(drug.source);
  const label = drugSectionLabel(section);
  if (!items.length) {
    return [
      `• ${badge} This is not in my curated database — consult the official label or your facility drug guide for ${drug.name}.`,
      "",
      `Source: ${badge} ${sourceLabel(badge)} (${drug.source || "unknown"})`,
      "Disclaimer: DoseAtlas has no listed entry for this drug section, so no drug-specific fact was inferred."
    ].join("\n");
  }

  const bullets = items.length > 5
    ? [...items.slice(0, 4), `Additional listed ${label.toLowerCase()}: ${items.slice(4).join("; ")}`]
    : items;

  return [
    ...bullets.map((item) => `• ${badge} ${item}`),
    "",
    `Source: ${badge} ${sourceLabel(badge)} (${drug.source || "unknown"})`,
    "Disclaimer: Verify against the official label and facility drug guide before administration."
  ].join("\n");
}

function drugSectionLabel(section: DrugSection): string {
  if (section === "black_box_warnings") return "Black box warnings";
  if (section === "side_effects") return "Side effects";
  return section.charAt(0).toUpperCase() + section.slice(1);
}

async function getConditionSummaries(env: Env, names: string[]): Promise<string> {
  const uniqueNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))].slice(0, 8);
  const conditions = await Promise.all(uniqueNames.map((name) => getCondition(env.DB, name)));
  return conditions
    .filter((condition): condition is ConditionRecord => Boolean(condition))
    .map((condition) => {
      const badge = sourceBadge(condition.source ?? "");
      return [
        `- ${badge} ${condition.name}`,
        condition.description ? `  Description: ${condition.description}` : "",
        condition.symptoms.length ? `  Symptoms: ${condition.symptoms.join("; ")}` : "",
        condition.treatments.length ? `  Treatments: ${condition.treatments.join("; ")}` : ""
      ].filter(Boolean).join("\n");
    })
    .join("\n");
}

async function handleIngest(request: Request, env: Env): Promise<Response> {
  const body = await readJson<IngestRequest>(request);
  const result = await ingestKnowledge(env, body);
  return json(request, env, result);
}

// --- Auth Handlers ---

async function handleRequestMagicLink(request: Request, env: Env): Promise<Response> {
  let body: { email?: string; redirectUrl?: string };
  try {
    body = await readJson<{ email?: string; redirectUrl?: string }>(request);
  } catch (error) {
    console.error("Invalid magic link request JSON", error);
    return json(request, env, { error: "Invalid JSON body" }, 400);
  }

  const email = body.email?.trim().toLowerCase();
  
  if (!email || !email.includes("@")) {
    return json(request, env, { error: "Valid email is required" }, 400);
  }

  const result = await requestMagicLink(env, email, request, sanitizeRedirectUrl(body.redirectUrl));
  if (!result.success) {
    return json(request, env, { error: result.error }, 429);
  }

  return json(request, env, { success: true });
}

async function handleConsumeMagicLink(request: Request, url: URL, env: Env): Promise<Response> {
  const token = url.searchParams.get("token");
  if (!token) return redirectWithCors(request, env, `${url.origin}/login?error=${encodeURIComponent("Invalid or expired link.")}`);

  const result = await consumeMagicLink(env, token);
  if (result.error) {
    console.error("Magic link login failed", { error: result.error });
    return redirectWithCors(request, env, `${url.origin}/login?error=${encodeURIComponent("Invalid or expired link.")}`);
  }

  if (!result.email) {
    console.error("Magic link consumed without email");
    return redirectWithCors(request, env, `${url.origin}/login?error=${encodeURIComponent("Invalid or expired link.")}`);
  }

  const cookie = await createSessionCookie(env, result.email);
  const redirectTarget = `${url.origin}${sanitizeRedirectUrl(result.redirectUrl) || "/"}`;

  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders(request, env),
      "Location": redirectTarget,
      "Set-Cookie": cookie
    }
  });
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const cookie = clearSessionCookie();
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": "application/json",
      "Set-Cookie": cookie
    }
  });
}

async function handleAuthMe(request: Request, env: Env): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return json(request, env, { error: "Unauthorized" }, 401);
  }
  return json(request, env, { email: user.email });
}


async function assembleDrug(name: string, env: Env): Promise<DrugRecord> {
  const [dailyMed, fdaRecord] = await Promise.allSettled([
    fetchDailyMedDrug(name),
    createDrugFromFda(name, env.AI, env.DB)
  ]);
  const dm = dailyMed.status === "fulfilled" ? dailyMed.value : {};
  const fda = fdaRecord.status === "fulfilled" ? fdaRecord.value : null;
  if (fda) return fda;

  const canonical = dm.name ?? titleCase(name);

  return {
    name: titleCase(canonical),
    rxcui: null,
    generic_name: dm.generic_name ?? name.toLowerCase(),
    drug_class: "Review official label",
    brand_names: mergeLists(dm.brand_names),
    indications: defaultList(dm.indications, ["Review indications in the official label before administration."]),
    contraindications: defaultList(dm.contraindications, ["Check allergy history, active diagnoses, and facility drug guide."]),
    black_box_warnings: dm.black_box_warnings ?? [],
    side_effects: defaultList(dm.side_effects, ["Monitor for unexpected adverse reactions and report per policy."]),
    interactions: dm.interactions ?? [],
    monitoring: inferMonitoring(name, dm.drug_class),
    allergies: null,
    administration: dm.administration ?? null,
    pregnancy_category: dm.pregnancy_category ?? null,
    images: [],
    source: dm.source ? "assembled" : "manual",
    assembled_at: new Date().toISOString()
  };
}

async function assembleCondition(name: string): Promise<ConditionRecord> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  let description = "";
  try {
    const response = await fetch(`https://medlineplus.gov/${slug}.json`, { headers: { Accept: "application/json" } });
    if (response.ok) {
      const payload = await response.json() as { description?: string; title?: string };
      description = payload.description ?? "";
    }
  } catch {
    description = "";
  }

  return {
    name: titleCase(name.replace(/-/g, " ")),
    description: description || "Condition details are not cached yet. Use linked medications and clinical references to complete the profile.",
    symptoms: [],
    treatments: [],
    related_conditions: [],
    source: "medlineplus"
  };
}

async function checkRateLimit(request: Request, env: Env): Promise<Response | null> {
  const key = request.headers.get("X-Api-Key") || clientIp(request);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / 3600) * 3600;
  const bucketKey = `rl:${await sha256(key)}:${windowStart}`;

  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket_key, count, window_start)
     VALUES (?, 1, ?)
     ON CONFLICT(bucket_key) DO UPDATE SET
       count = CASE
         WHEN rate_limits.window_start < excluded.window_start THEN 1
         ELSE rate_limits.count + 1
       END,
       window_start = CASE
         WHEN rate_limits.window_start < excluded.window_start THEN excluded.window_start
         ELSE rate_limits.window_start
       END
     RETURNING count`
  ).bind(bucketKey, windowStart).first<{ count: number }>();

  const limit = Number((env as Env & { RATE_LIMIT_PER_HOUR?: string }).RATE_LIMIT_PER_HOUR) || 100;
  if (row && row.count > limit) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), {
      status: 429,
      headers: { ...corsHeaders(request, env), "Retry-After": "3600", "Content-Type": "application/json" }
    });
  }
  return null;
}

function json(request: Request, env: Env, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders(request, env) });
}

function redirectWithCors(request: Request, env: Env, location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders(request, env),
      Location: location
    }
  });
}

async function markDrugsStale(db: D1Database, ids: number[]): Promise<void> {
  const uniqueIds = [...new Set(ids)].filter((id) => Number.isInteger(id));
  if (!uniqueIds.length) return;
  const placeholders = uniqueIds.map(() => "?").join(", ");
  await db.prepare(`UPDATE drugs SET enriched_at = 'STALE', assembled_at = datetime('now') WHERE id IN (${placeholders})`)
    .bind(...uniqueIds)
    .run();
}

function isAdminRequest(request: Request, env: Env): boolean {
  const configuredSecret = env.ADMIN_SECRET;
  const providedSecret = request.headers.get("X-Admin-Key")
    || request.headers.get("X-Admin-Secret")
    || request.headers.get("x-admin-key")
    || request.headers.get("x-admin-secret")
    || request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(configuredSecret && providedSecret === configuredSecret);
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function clamp(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function mergeLists(...lists: Array<string[] | undefined>): string[] {
  return [...new Set(lists.flatMap((list) => list ?? []).map((item) => item.trim()).filter(Boolean))];
}

function defaultList(list: string[] | undefined, fallback: string[]): string[] {
  return list && list.length ? list : fallback;
}

function formatContextList(label: string, items: string[]): string {
  return `${label}: ${items.length ? items.join("; ") : "Not listed in DoseAtlas database."}`;
}

function sourceBadge(source?: string | null): string {
  const normalized = (source ?? "").toLowerCase();
  if (normalized.includes("curated") || normalized.includes("ati") || normalized.includes("graph")) return "🟢";
  if (normalized.includes("fda") || normalized.includes("dailymed") || normalized.includes("assembled")) return "🟡";
  return "⚪";
}

function sourceLabel(badge: string): string {
  if (badge === "🟢") return "Curated Data";
  if (badge === "🟡") return "FDA/DAILYMED";
  return "General Knowledge";
}

async function handleAsk(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson<AskRequest>(request);
  const query = body.query?.trim();
  if (!query) return json(request, env, { error: "query is required" }, 400);

  const drugName = body.drug?.trim();
  const clinicalContext = body.context?.trim();
  const mode = body.mode || "quick";
  const fullQuery = [query, clinicalContext ? `Clinical context: ${clinicalContext}` : ""].filter(Boolean).join("\n");
  let drugData = "";
  let searchContext = "";

  if (drugName) {
    const drug = await getDrugByIdOrName(env.DB, drugName);
    if (drug) {
      if (needsFdaEnrichment(drug)) {
        ctx.waitUntil(enrichDrugFromFda(drug, env.AI, env.DB).catch(() => undefined));
      }
      drugData = buildContextForAsk(drug);
    }
  }

  try {
    const searchResponse = await env.SEARCH.search({
      query: [query, drugName, clinicalContext].filter(Boolean).join(" "),
      ai_search_options: {
        retrieval: {
          max_num_results: 3,
          match_threshold: 0.3
        }
      }
    });
    if (searchResponse?.chunks?.length) {
      searchContext = searchResponse.chunks.map((chunk) => `[${chunk.item?.key}] ${chunk.text}`).join("\n\n");
    }
  } catch {
    searchContext = "(Knowledge search unavailable)";
  }

  const answer = await askNurseClippy(env.AI, fullQuery, drugData, searchContext, mode);
  ctx.waitUntil(logQa(env.DB, {
    endpoint: "ask",
    query: body.query,
    drug: drugName || null,
    section_context: clinicalContext || null,
    mode,
    drug_data_snapshot: drugData ? drugData.slice(0, 2000) : null,
    search_results_snapshot: searchContext ? searchContext.slice(0, 2000) : null,
    response: answer,
    response_length: answer.length,
    cached: 0
  }));

  return json(request, env, {
    answer,
    sources: {
      drug: drugName || null,
      search_results: searchContext && searchContext !== "(Knowledge search unavailable)" ? "included" : "none"
    }
  });
}

function buildContextForAsk(drug: DrugRecord): string {
  const parts = [`Drug: ${drug.name}`];
  if (drug.generic_name) parts.push(`Generic: ${drug.generic_name}`);
  if (drug.drug_class) parts.push(`Class: ${drug.drug_class}`);
  if (drug.indications?.length) parts.push(`Indications: ${drug.indications.join("; ")}`);
  if (drug.contraindications?.length) parts.push(`Contraindications: ${drug.contraindications.join("; ")}`);
  if (drug.black_box_warnings?.length) parts.push(`BBW: ${drug.black_box_warnings.join("; ")}`);
  if (drug.side_effects?.length) parts.push(`Side Effects: ${drug.side_effects.join("; ")}`);
  if (drug.interactions?.length) parts.push(`Interactions: ${drug.interactions.join("; ")}`);
  if (drug.monitoring?.length) parts.push(`Monitoring: ${drug.monitoring.join("; ")}`);
  if (drug.administration) parts.push(`Administration: ${drug.administration}`);
  if (drug.source) parts.push(`Source: ${drug.source}`);
  return parts.join("\n");
}

function inferMonitoring(name: string, drugClass?: string | null): string[] {
  const text = `${name} ${drugClass ?? ""}`.toLowerCase();
  if (text.includes("digoxin")) return ["Serum digoxin: 0.5-2.0 ng/mL", "Potassium: 3.5-5.0 mEq/L", "Creatinine, BUN, apical pulse, EKG"];
  if (text.includes("insulin")) return ["Blood glucose", "Signs of hypoglycemia", "Potassium if clinically indicated"];
  if (text.includes("anticoagulant") || text.includes("warfarin")) return ["Bleeding", "INR/PT as ordered", "CBC and occult blood as ordered"];
  return ["Vitals and clinical response", "Renal/hepatic labs as ordered", "Adverse reactions and allergies"];
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
