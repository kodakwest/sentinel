import { ArrowLeft, Printer } from "lucide-react";
import { useEffect, useState } from "react";

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
  allergies?: string;
  administration?: string;
  pregnancy_category?: string;
}

interface Props {
  id: string;
}

type CheatSheetRow = {
  label: string;
  items: string | string[] | undefined;
  className: string;
};

export function CheatSheetView({ id }: Props) {
  const [drug, setDrug] = useState<Drug | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  if (loading) return <div className="page-state">Loading cheat sheet...</div>;
  if (error) return <div className="page-state alert danger">{error}</div>;
  if (!drug) return <div className="page-state">No cheat sheet found.</div>;

  const rows: CheatSheetRow[] = [
    { label: "Indications", items: drug.indications, className: "ind" },
    { label: "CI", items: drug.contraindications, className: "ci" },
    { label: "BBW", items: drug.black_box_warnings, className: "bbw" },
    { label: "SE", items: drug.side_effects, className: "se" },
    { label: "Mon", items: drug.monitoring, className: "mon" },
    { label: "Int", items: drug.interactions, className: "int" },
    { label: "Adm", items: drug.administration, className: "adm" },
    { label: "Preg", items: drug.pregnancy_category, className: "preg" }
  ].filter((row) => Array.isArray(row.items) ? row.items.length > 0 : Boolean(row.items));

  return (
    <div className="cheatsheet">
      <div className="cheatsheet-actions">
        <a className="back-link" href={`#/drug/${encodeURIComponent(drug.name || id)}`}>
          <ArrowLeft size={17} /> Full dossier
        </a>
        <button className="primary-button" type="button" onClick={() => window.print()}>
          <Printer size={17} /> Print
        </button>
      </div>

      <div className="cheatsheet-card">
        <header className="cheatsheet-header">
          <h1>{drug.name}</h1>
          <p>{[drug.drug_class, drug.brand_names.length ? drug.brand_names.join(", ") : ""].filter(Boolean).join(" - ")}</p>
        </header>

        {rows.map(({ label, items, className }) => (
          <div className={`cs-row ${className}`} key={label}>
            <strong>{label}:</strong>
            <span>{Array.isArray(items) ? items.join(", ") : items}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
