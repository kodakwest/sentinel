# UX Condition Navigation Review

Adversarial read: the core UX direction is good. Text should navigate and the `?` button should own Clippy. The spec is not ready to implement as written because it uses raw display names as durable routes, links broad text buckets as if every item is a condition, and adds a likely table-scan search path over roughly 75K condition rows.

## Summary by Priority

### High

1. **Name-based condition routes are too brittle.**
   - Current hash parsing splits on `/` and only preserves the first segment after `#/condition/` (`src/frontend/app.tsx:20-26`). If any new link forgets `encodeURIComponent`, a condition like `45,X/46,XY mixed gonadal dysgenesis` routes as `45,X`.
   - Even when encoded, display names are not stable identifiers. The schema has only `id` and unique `name`, with ontology IDs stored indirectly or flattened into `description` (`schemas/001_create_tables.sql:23-31`, `staging/merge_condition_datasets.py:118-126`).
   - Recommended fix: route condition pages by condition `id` or a stable ontology identifier (`DOID:...`, `MONDO:...`) and keep the display name as text only. Search and condition-link resolution should return `{ id, name, source_ids }`, and links should use `#/condition/${id}`.

2. **Missing conditions currently get silently created.**
   - `handleCondition` calls `assembleCondition` and `upsertCondition` on a miss (`src/index.ts:121-128`). If a user clicks "pain management", "symptom relief", "Administration", or a typo, the app creates a placeholder condition row instead of showing a miss or suggestions.
   - Recommended fix: condition navigation should first resolve against `conditions` or `condition_aliases`. For a miss, return `404` or a "not linked yet" page with search suggestions. Do not auto-upsert from navigation clicks.

3. **The proposed condition search query will likely table-scan.**
   - The spec uses `lower(name) LIKE '%query%'`. The existing condition index is `idx_conditions_name ON conditions(name)` (`schemas/001_create_tables.sql:70-72`), which will not help much with `lower(name)` plus a leading wildcard.
   - Recommended fix: add a normalized search column or FTS table. At minimum, support prefix search with `name_norm` indexed and reserve contains search for explicit "more results". Return IDs and short metadata.

4. **Search flow can delay drug results if implemented as shown.**
   - Current `runSearch` has one loading/error state around drug search (`src/frontend/search.tsx:73-89`). The spec says "parallel" but shows condition fetch after existing drug search. If implemented literally, condition search waits for drug search and shares failure/loading behavior.
   - Recommended fix: use independent `drugLoading`, `conditionLoading`, `drugError`, and `conditionError`, or `Promise.allSettled` with separate rendering. A slow or failed condition query must not hide or delay drug results.

### Medium

5. **Duplicate and ambiguous names are unresolved.**
   - The `conditions.name` column is unique (`schemas/001_create_tables.sql:23-31`), so two ontology records with the same label cannot both be represented as first-class rows. The merge script normalizes by lowercased name and collapses sources (`staging/merge_condition_datasets.py:96-107`).
   - Recommended fix: model canonical condition concepts separately from aliases/source IDs. If two concepts share a label, search should show disambiguating metadata such as ontology source, parent category, or description.

6. **Symptoms should not link to condition pages by default.**
   - The spec changes `Signs & Symptoms` to `linkType="condition"`. But HPO terms like `Pain`, `Nausea`, `Seizure`, and `Hypotonia` are symptoms/phenotypes, not condition concepts. Staging also puts many HPO symptoms into `conditions.symptoms`.
   - Recommended fix: keep symptoms as plain text with `?`, or add a separate `#/symptom/:id` view later. Only `Related Conditions` should link to condition pages.

7. **Indications and contraindications are not always conditions.**
   - FDA label text often contains phrases such as "pain management", "symptom relief", "prevention", "adjunctive therapy", populations, lab states, or long compound sentences. Current code already suppresses detail links for items longer than 80 characters (`src/frontend/dossier.tsx:198-200`), which is a crude but useful signal the spec removes.
   - Recommended fix: do not blanket-link every indication/contraindication string. Add a resolver that links only if the exact item or a normalized alias exists in `conditions`. Otherwise render plain text plus `?`.

8. **Drug interaction links are probably wrong as specified.**
   - `Interactions` strings can be drug names, classes, foods, warnings, or mechanisms. Linking every item to `#/drug/:item` will trigger drug auto-assembly for non-drugs via the current dossier miss behavior (`src/index.ts:97-118`).
   - Recommended fix: only link interactions resolved to known drugs. Consider `linkType="drug"` only after an API resolver returns a drug ID.

9. **The `linkConditions` migration is conceptually clean but incomplete.**
   - `DossierSection` currently owns `linkConditions` and the inline `detail` link (`src/frontend/dossier.tsx:174-200`). Replacing it with `linkType` is mechanically simple, but the drug class header still uses `ExplainTerm` (`src/frontend/dossier.tsx:69-71`) and the condition list still uses `drugLinks` (`src/frontend/condition.tsx:62-72`).
   - Recommended fix: introduce a small `LinkedTerm`/`TermWithExplain` component and migrate all clickable term locations deliberately. Do not remove `ExplainTerm` until every import is gone.

10. **CSS print/cascade cleanup is easy to miss.**
    - Print CSS currently hides `.inline-arrow` and restyles `.explain-term` (`src/frontend/style.css:650-667`). Replacing `.explain-term` with `.condition-link` needs print rules too, or printed dossiers may show dotted links and accent colors.
    - Recommended fix: add print styles for `.condition-link` and remove `.inline-arrow` only after all uses are gone.

### Low

11. **XSS risk is low if links are encoded, but the proposed `LinkTerm` is too permissive.**
    - React escapes rendered text, and `#/condition/${encodeURIComponent(name)}` is not script-executable. However, the proposed `LinkTerm` accepts arbitrary `href`, so a future caller could pass `javascript:` or unencoded display text.
    - Recommended fix: do not accept arbitrary `href` for condition/drug links. Accept `{ type, id }` or build the route inside a helper that always encodes.

12. **Showing only five condition results below drug results undersells condition search.**
    - Five related conditions below drug results is okay as a first pass, but it makes conditions feel secondary even when the query is clearly a condition. Nurses may search "heart failure" directly.
    - Recommended fix: add tabs or grouped results with counts: `Drugs`, `Conditions`. Default ordering can still prioritize drugs for drug-like queries, but condition-heavy queries need a clear path to more than five results.

13. **Search debounce/timing is unspecified.**
    - Current search is submit-only, not debounced (`src/frontend/search.tsx:117-124`). Adding condition search should not accidentally double request volume on every keystroke.
    - Recommended fix: keep submit-only for this change, or add one shared 250-400 ms debounce with cancellation. Use minimum query length, e.g. 2 or 3 chars for conditions.

## Special Character and Routing Notes

- Apostrophes and quotes are safe in React text and SQL bind parameters, but raw string interpolation into `href` should still be avoided.
- Encoded forward slashes work with current hash parsing only if every caller uses `encodeURIComponent`. The spec includes both raw `#/{linkType}/{item}` wording and encoded examples; it should require one route helper.
- Non-ASCII names exist in staged data, e.g. `α-gal allergy`. `encodeURIComponent` handles these, but ID-based routes avoid ugly URLs and decoding edge cases.
- Names containing `#`, `?`, `%`, or `/` should be covered by tests because hashes are easy to break by hand-built links.

## Recommended Alternative

Ship the UX flip, but add a resolution layer:

1. `GET /api/conditions/resolve?name=...` returns an exact canonical match, aliases, or suggestions.
2. `GET /api/conditions/search?q=...` returns `{ id, name, description, source_ids, symptom_count }`.
3. Dossier sections render a link only when the resolver/search index says the item is a known condition or drug.
4. Routes use `#/condition/:id` and API fetches `/api/conditions/:id`.
5. Keep symptoms plain until there is a symptom page.

This makes text navigation feel direct without letting random label prose mutate the database.

## Ship Assessment

Ship as-is:

- The interaction model: term text navigates, `?` opens Clippy.
- Keeping `ExplainButton` on every item.
- Replacing the small `detail` link with direct linked text where the target is resolved.

Needs more work before implementation:

- Stable condition identifiers and alias/source ID handling.
- Miss behavior for `/api/conditions/:idOrName`; navigation should not auto-create placeholder conditions.
- Indexed condition search and independent search loading/error states.
- Section-specific link eligibility, especially symptoms, contraindications, and interactions.
- Route helper/tests for encoded names and special characters.

The spec is directionally solid, but it currently treats display strings as data model keys. That is the main flaw to fix before this goes into the app.
