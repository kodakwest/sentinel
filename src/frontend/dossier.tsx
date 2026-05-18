import { ArrowLeft, ClipboardList, Download, Image as ImageIcon, Printer, ToggleLeft, ToggleRight } from "lucide-react";
import { useEffect, useState } from "react";
import { ExplainButton, ExplainTerm, type AssistantContext } from "./assistant";

interface Drug {
  id?: number;
  name: string;
  generic_name?: string;
  drug_class?: string;
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
  allergies?: string;
  administration?: string;
  pregnancy_category?: string;
  images: string[];
  assembled_at?: string;
  enriched_at?: string;
}

interface Props {
  id: string;
  onExplain: (context: AssistantContext) => void;
}

export function DrugDossierView({ id, onExplain }: Props) {
  const [drug, setDrug] = useState<Drug | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`/api/drugs/${encodeURIComponent(id)}`)
      .then(async (response) => {
        const data = await response.json() as { drug?: Drug; error?: string };
        if (!response.ok) throw new Error(data.error || "Unable to load drug");
        setDrug(data.drug ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load drug"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!drug?.name) return;
    const recent = JSON.parse(localStorage.getItem("sentinel-recent-dossiers") || "[]") as string[];
    const updated = [drug.name, ...recent.filter((name) => name.toLowerCase() !== drug.name.toLowerCase())].slice(0, 6);
    localStorage.setItem("sentinel-recent-dossiers", JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent("dossier-viewed"));
  }, [drug?.name]);

  if (loading) return <div className="page-state">Loading dossier...</div>;
  if (error) return <div className="page-state alert danger">{error}</div>;
  if (!drug) return <div className="page-state">No dossier found.</div>;

  const drugName = drug.name;
  const hasRawSections = Boolean(
    drug.indications_raw?.length
    || drug.contraindications_raw?.length
    || drug.side_effects_raw?.length
    || drug.interactions_raw?.length
    || drug.monitoring_raw?.length
  );
  const sectionItems = (summary: string[], raw?: string[]): string[] => showRaw && raw?.length ? raw : summary;

  return (
    <article className="dossier-page">
      <a className="back-link" href="#/"><ArrowLeft size={17} /> Back to search</a>

      <section className="dossier-header">
        <div>
          <h1>{drug.name}</h1>
          <p>
            <ExplainTerm term={drug.drug_class || "drug class"} drug={drugName} context="Drug class" onExplain={onExplain}>
              {drug.drug_class || "Drug class pending"}
            </ExplainTerm>
          </p>
          <p className="muted">Brand: {drug.brand_names.length ? drug.brand_names.join(", ") : "No brand names cached"}</p>
          <div className="dossier-meta-row">
            <span className={`enrichment-badge ${drug.enriched_at === "STALE" ? "pending" : ""}`}>{formatEnrichedAt(drug.enriched_at)}</span>
            {showRaw && !hasRawSections && <span className="enrichment-badge">Raw FDA not yet captured</span>}
          </div>
          <div className="dossier-actions">
            <button className="primary-button" type="button" onClick={() => window.print()}>
              <Printer size={17} /> Print / PDF
            </button>
            <button className="primary-button" type="button" onClick={() => exportHtml(drug)}>
              <Download size={17} /> Export HTML
            </button>
            <button className="primary-button" type="button" onClick={() => setShowRaw((value) => !value)} aria-pressed={showRaw}>
              {showRaw ? <ToggleRight size={17} /> : <ToggleLeft size={17} />} {showRaw ? "Raw FDA" : "Summary"}
            </button>
            <a className="primary-button" href={`#/drug/${encodeURIComponent(drug.name || id)}/cheatsheet`}>
              <ClipboardList size={17} /> Cheat Sheet
            </a>
          </div>
        </div>
        <div className="drug-image" aria-label="Drug image placeholder">
          {drug.images[0] ? <img src={drug.images[0]} alt={`${drug.name} pill`} /> : <ImageIcon size={34} />}
        </div>
      </section>

      <DossierSection title="What It Treats" items={sectionItems(drug.indications, drug.indications_raw)} drug={drugName} context="Indications and usage" onExplain={onExplain} linkConditions />
      <DossierSection title="Don't Give If" items={sectionItems(drug.contraindications, drug.contraindications_raw)} drug={drugName} context="Contraindications" onExplain={onExplain} tone="danger" />
      <DossierSection title="Black Box Warnings" items={drug.black_box_warnings} drug={drugName} context="Boxed warning" onExplain={onExplain} tone="warning" />
      <DossierSection title="Watch For" items={sectionItems(drug.side_effects, drug.side_effects_raw)} drug={drugName} context="Adverse reactions" onExplain={onExplain} />
      <DossierSection title="Monitor" items={sectionItems(drug.monitoring, drug.monitoring_raw)} drug={drugName} context="Nursing monitoring parameters" onExplain={onExplain} tone="info" />
      <DossierSection title="Interactions" items={sectionItems(drug.interactions, drug.interactions_raw)} drug={drugName} context="Drug interactions" onExplain={onExplain} />

      <section className="dossier-section">
        <h2>Administration</h2>
        <p>{drug.administration || "Administration guidance is not cached yet."} <ExplainButton term="administration precautions" drug={drugName} context={drug.administration} onExplain={onExplain} /></p>
      </section>

      <section className="dossier-section">
        <h2>Pregnancy Category</h2>
        <p>{drug.pregnancy_category || "Review current pregnancy and lactation guidance."} <ExplainButton term="pregnancy and lactation risk" drug={drugName} context={drug.pregnancy_category} onExplain={onExplain} /></p>
      </section>
    </article>
  );
}

function formatEnrichedAt(value?: string): string {
  if (value === "STALE") return "Refresh pending...";
  if (!value) return "Not AI-enriched";

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Enrichment date unknown";

  const days = Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Enriched today";
  if (days === 1) return "Enriched 1 day ago";
  return `Enriched ${days} days ago`;
}

function exportHtml(drug: Drug): void {
  const sections = ([
    ["Indications", drug.indications],
    ["Contraindications", drug.contraindications],
    ["Black Box Warnings", drug.black_box_warnings],
    ["Side Effects", drug.side_effects],
    ["Monitoring", drug.monitoring],
    ["Interactions", drug.interactions],
    ["Administration", drug.administration ? [drug.administration] : []],
    ["Pregnancy", drug.pregnancy_category ? [drug.pregnancy_category] : []]
  ] as [string, string[]][]).filter(([, items]) => items.length > 0);

  const safeName = escapeHtml(drug.name);
  const safeClass = drug.drug_class ? `${escapeHtml(drug.drug_class)} - ` : "";
  const safeBrands = drug.brand_names.length ? drug.brand_names.map(escapeHtml).join(", ") : "N/A";
  const generatedDate = new Date().toISOString().split("T")[0];
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeName} - Sentinel Drug Dossier</title>
<style>
  body { font-family: Inter, system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #0f172a; line-height: 1.5; }
  h1 { font-size: 2rem; margin-bottom: 4px; }
  .meta { color: #64748b; margin-top: 0; }
  h2 { font-size: 1.1rem; margin: 20px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  .bbw { background: #fef2f2; border-left: 4px solid #dc2626; padding: 10px 14px; border-radius: 6px; }
  ul { margin: 6px 0; padding-left: 20px; }
  li { margin: 4px 0; }
  @media print { body { margin: 0; padding: 10px; } section { break-inside: avoid; } }
</style>
</head>
<body>
<h1>${safeName}</h1>
<p class="meta">${safeClass}Brand: ${safeBrands}</p>
${sections.map(([title, items]) => `
<section${title === "Black Box Warnings" ? ` class="bbw"` : ""}>
<h2>${escapeHtml(title)}</h2>
<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
</section>`).join("")}
<p style="margin-top: 30px; color: #94a3b8; font-size: 0.85rem;">Generated by Sentinel - ${generatedDate}</p>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${drug.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "drug"}-dossier.html`;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function DossierSection({
  title,
  items,
  drug,
  tone,
  linkConditions,
  onExplain
}: {
  title: string;
  items: string[];
  drug: string;
  context: string;
  tone?: "danger" | "warning" | "info";
  linkConditions?: boolean;
  onExplain: (context: AssistantContext) => void;
}) {
  const fullContext = `${title}: ${items.join("; ")}`;

  return (
    <section className={`dossier-section ${tone ?? ""}`}>
      <div className="dossier-section-heading">
        <h2>{title}</h2>
        <button className="explore-section" type="button" onClick={() => onExplain({ term: `Explore: ${title}`, drug, context: fullContext })}>
          Explore
        </button>
      </div>
      {items.length ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>
              <ExplainTerm term={item} drug={drug} context={fullContext} onExplain={onExplain}>{item}</ExplainTerm>
              <ExplainButton term={item} drug={drug} context={fullContext} onExplain={onExplain} />
              {linkConditions && item.length < 80 && <a className="inline-arrow" href={`#/condition/${encodeURIComponent(item)}`}>detail</a>}
            </li>
          ))}
        </ul>
      ) : (
        <p>No official label entries cached. <ExplainButton term={title} drug={drug} context={fullContext} onExplain={onExplain} /></p>
      )}
    </section>
  );
}
