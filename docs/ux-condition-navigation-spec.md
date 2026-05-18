# Sentinel UX: Condition Navigation + Clippy Rethink

## Problem
Clicking any text in dossier/condition views triggers Nurse Clippy (AI explanation). This conflicts with navigating to condition pages — users have to find a tiny "detail" link instead of just clicking the text.

## Solution
**Flip the priority**: Text clicks → navigate. Only `?` button → Clippy.

---

## Changes

### 1. assistant.tsx — New `LinkTerm` component

Replace `ExplainTerm` with `LinkTerm`:
```tsx
// New component: renders text as a link based on context
export function LinkTerm({ 
  children, 
  href, 
  className 
}: { 
  children: React.ReactNode; 
  href: string; 
  className?: string;
}) {
  return <a className={`condition-link ${className ?? ''}`} href={href}>{children}</a>;
}
```

Keep `ExplainButton` unchanged (the `?` button). Keep `AssistantPanel` unchanged.

Remove the old `ExplainTerm` component entirely (or keep as legacy but don't use it).

### 2. dossier.tsx — DossierSection refactor

In `DossierSection`:
- Remove `linkConditions` prop (no longer needed)
- Replace `<ExplainTerm>` with conditional navigation:
  - **Indications section** ("What It Treats"): each item → `<a href={#/condition/item}>` 
  - **Contraindications section** ("Don't Give If"): each item → `<a href={#/condition/item}>`
  - **Side effects section** ("Watch For"): keep as text (symptoms, not conditions) with just `?` button
  - **Interactions section**: each item → `<a href={#/drug/item}>`
  - **Monitoring, Black Box Warnings**: keep as plain text with `?` button
- Keep `<ExplainButton>` on every item for Clippy access

How: pass a `linkType?: 'condition' | 'drug' | null` prop to `DossierSection`. When set, items link to `#/{linkType}/{item}`.

The dossier calling code already has clear section semantics. Update each `<DossierSection>` call:
```tsx
<DossierSection title="What It Treats" items={drug.indications} drug={drugName} context="Indications and usage" onExplain={onExplain} linkType="condition" />
<DossierSection title="Don't Give If" items={drug.contraindications} drug={drugName} context="Contraindications" onExplain={onExplain} tone="danger" linkType="condition" />
<DossierSection title="Black Box Warnings" items={drug.black_box_warnings} drug={drugName} context="Boxed warning" onExplain={onExplain} tone="warning" />
<DossierSection title="Watch For" items={drug.side_effects} drug={drugName} context="Adverse reactions" onExplain={onExplain} />
<DossierSection title="Monitor" items={drug.monitoring} drug={drugName} context="Nursing monitoring parameters" onExplain={onExplain} tone="info" />
<DossierSection title="Interactions" items={drug.interactions} drug={drugName} context="Drug interactions" onExplain={onExplain} linkType="drug" />
```

### 3. condition.tsx — Same pattern

In `ConditionList`:
- Add `linkType?: 'condition' | 'drug' | null` prop
- When `linkType` is set, items link to `#/{linkType}/{item}`
- Keep `ExplainButton` for Clippy

Update the calling code:
```tsx
<ConditionList title="Signs & Symptoms" items={condition.symptoms} context="Signs and symptoms" onExplain={onExplain} linkType="condition" />
<ConditionList title="Common Medications" items={condition.treatments} context="Common treatments" onExplain={onExplain} linkType="drug" />
<ConditionList title="Related Conditions" items={condition.related_conditions} context="Related conditions" onExplain={onExplain} linkType="condition" />
```

Remove the old `drugLinks` prop from `ConditionList`.

### 4. style.css — New styles

Replace `.explain-term` styles:
```css
.condition-link {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px dotted color-mix(in srgb, var(--accent) 40%, transparent);
  transition: border-color 0.15s;
}
.condition-link:hover {
  border-bottom-color: var(--accent);
}
```

Keep `.explain-button` as-is.

Remove `.inline-arrow` styles (no longer needed).

### 5. index.ts — Condition Search (bonus)

Add a `/api/conditions/search` endpoint:
```ts
if (url.pathname === "/api/conditions/search" && request.method === "GET") return handleConditionSearch(url, env);
```

Implementation in db.ts:
```ts
export async function searchConditions(db: D1Database, q: string, limit = 20): Promise<ConditionSearchResult[]> {
  const term = `%${q.toLowerCase()}%`;
  const result = await db.prepare(
    `SELECT name, description, symptoms
     FROM conditions
     WHERE lower(name) LIKE ?
     ORDER BY
       CASE WHEN lower(name) = lower(?) THEN 0
            WHEN lower(name) LIKE ? THEN 1
            ELSE 2 END,
       name
     LIMIT ?`
  ).bind(term, q, `${q.toLowerCase()}%`, limit).all();
  return (result.results ?? []).map((row: any) => ({
    name: row.name,
    description: row.description,
    symptom_count: row.symptoms ? JSON.parse(row.symptoms).length : 0
  }));
}
```

Handler:
```ts
async function handleConditionSearch(url: URL, env: Env): Promise<Response> {
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limit = clamp(url.searchParams.get("limit"), 20, 1, 50);
  if (!q) return json({ results: [] });
  const results = await searchConditions(env.DB, q, limit);
  return json({ results, total: results.length });
}
```

Route add in index.ts (before the catch-all):
```ts
if (url.pathname === "/api/conditions/search" && request.method === "GET") return handleConditionSearch(url, env);
```

### 6. search.tsx — Show condition results

In `SearchView`, add a second search for conditions when the query isn't empty:
```tsx
// Parallel search for conditions alongside drug results
const [conditionResults, setConditionResults] = useState<ConditionSearchResult[]>([]);

async function runSearch(nextQuery = query) {
  // ... existing drug search ...
  
  // Also search conditions
  const condResp = await fetch(`/api/conditions/search?q=${encodeURIComponent(q)}&limit=5`);
  const condData = await condResp.json();
  setConditionResults(condData.results ?? []);
}
```

Add condition results section below drug results:
```tsx
{conditionResults.length > 0 && (
  <section className="content-band compact" style={{ marginTop: 16 }}>
    <h2>Related Conditions</h2>
    <div className="recent-list">
      {conditionResults.map((c) => (
        <a key={c.name} href={`#/condition/${encodeURIComponent(c.name)}`} className="recent-pill">
          {c.name}
          {c.symptom_count > 0 && <span className="muted" style={{ marginLeft: 6 }}>({c.symptom_count} symptoms)</span>}
        </a>
      ))}
    </div>
  </section>
)}
```

## Files to modify
1. `src/frontend/assistant.tsx` — replace `ExplainTerm` with `LinkTerm`, keep `ExplainButton` + `AssistantPanel`
2. `src/frontend/dossier.tsx` — update `DossierSection` + call sites with `linkType` prop
3. `src/frontend/condition.tsx` — update `ConditionList` + call sites
4. `src/frontend/style.css` — `.explain-term` → `.condition-link`, add condition search styles
5. `src/index.ts` — add `/api/conditions/search` route + handler
6. `src/db.ts` — add `searchConditions` function
7. `src/types.ts` — add `ConditionSearchResult` type
8. `src/frontend/search.tsx` — add condition results panel

## Order of implementation
1. db.ts — add `searchConditions` function
2. types.ts — add type
3. assistant.tsx — add `LinkTerm`, keep `ExplainButton`
4. dossier.tsx — refactor `DossierSection` with `linkType`
5. condition.tsx — refactor `ConditionList` with `linkType`
6. style.css — update styles
7. index.ts — add route
8. search.tsx — add condition results
