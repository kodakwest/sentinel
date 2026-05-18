import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { ExplainButton, ExplainTerm, type AssistantContext } from "./assistant";

interface Condition {
  id?: number;
  name: string;
  description?: string;
  symptoms: string[];
  treatments: string[];
  related_conditions: string[];
}

interface Props {
  id: string;
  onExplain: (context: AssistantContext) => void;
}

export function ConditionView({ id, onExplain }: Props) {
  const [condition, setCondition] = useState<Condition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/conditions/${encodeURIComponent(id)}`)
      .then(async (response) => {
        const data = await response.json() as { condition?: Condition; error?: string };
        if (!response.ok) throw new Error(data.error || "Unable to load condition");
        setCondition(data.condition ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load condition"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="page-state">Loading condition...</div>;
  if (error) return <div className="page-state alert danger">{error}</div>;
  if (!condition) return <div className="page-state">No condition found.</div>;

  return (
    <article className="dossier-page">
      <a className="back-link" href="#/"><ArrowLeft size={17} /> Back</a>
      <section className="dossier-header simple">
        <div>
          <h1>{condition.name}</h1>
          <p className="muted">Condition deep-dive</p>
        </div>
      </section>

      <section className="dossier-section">
        <h2>Description</h2>
        <p>{condition.description} <ExplainButton term={condition.name} context="Condition description" onExplain={onExplain} /></p>
      </section>

      <ConditionList title="Signs & Symptoms" items={condition.symptoms} context="Signs and symptoms" onExplain={onExplain} />
      <ConditionList title="Common Medications" items={condition.treatments} context="Common treatments" onExplain={onExplain} drugLinks />
      <ConditionList title="Related Conditions" items={condition.related_conditions} context="Related conditions" onExplain={onExplain} />
    </article>
  );
}

function ConditionList({ title, items, context, drugLinks, onExplain }: { title: string; items: string[]; context: string; drugLinks?: boolean; onExplain: (context: AssistantContext) => void }) {
  return (
    <section className="dossier-section">
      <h2>{title}</h2>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item}>
              <ExplainTerm term={item} context={context} onExplain={onExplain}>{item}</ExplainTerm>
              <ExplainButton term={item} context={context} onExplain={onExplain} />
              {drugLinks && <a className="inline-arrow" href={`#/drug/${encodeURIComponent(item)}`}>open</a>}
            </li>
          ))}
        </ul>
      ) : (
        <p>Not yet linked in the graph. <ExplainButton term={title} context={context} onExplain={onExplain} /></p>
      )}
    </section>
  );
}
