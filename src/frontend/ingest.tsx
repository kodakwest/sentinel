import { FileText, UploadCloud } from "lucide-react";
import { ChangeEvent, FormEvent, useState } from "react";

interface GraphSeed {
  entities: Array<{ type: string; name: string; properties?: Record<string, unknown> }>;
  edges: Array<{ source: string; target: string; relationship: string; weight?: number }>;
  merged: boolean;
}

const sources = ["Class Notes", "ATI Med Table", "Clinical Guideline", "Research Paper", "Other"];

export function IngestView() {
  const [text, setText] = useState("");
  const [source, setSource] = useState(sources[0]);
  const [merge, setMerge] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GraphSeed | null>(null);
  const [error, setError] = useState("");

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setText(await file.text());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source, merge })
      });
      const data = await response.json() as GraphSeed & { error?: string };
      if (!response.ok) throw new Error(data.error || "Ingest failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="ingest-page">
      <div className="page-heading">
        <FileText size={28} aria-hidden="true" />
        <div>
          <h1>Knowledge Ingest</h1>
          <p>Extract drugs, conditions, monitoring facts, and relationships from study material.</p>
        </div>
      </div>

      <form className="ingest-form" onSubmit={submit}>
        <label>
          Source Type
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            {sources.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="file-picker">
          <UploadCloud size={18} />
          <span>Upload text file</span>
          <input type="file" accept=".txt,.md,.csv" onChange={readFile} />
        </label>
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Paste class notes, med tables, or guideline excerpts..." />
        <label className="check-row">
          <input type="checkbox" checked={merge} onChange={(event) => setMerge(event.target.checked)} />
          Merge into graph database after extraction
        </label>
        <button className="primary-button" type="submit" disabled={loading || !text.trim()}>{loading ? "Extracting" : "Extract Knowledge"}</button>
      </form>

      {error && <div className="alert danger">{error}</div>}
      {result && (
        <section className="ingest-preview">
          <h2>Extracted Entities</h2>
          <div className="entity-grid">
            {result.entities.map((entity, index) => (
              <div className="mini-card" key={`${entity.name}-${index}`}>
                <span>{entity.type}</span>
                <strong>{entity.name}</strong>
              </div>
            ))}
          </div>
          <h2>Edges</h2>
          <div className="edge-list">
            {result.edges.map((edge, index) => (
              <div key={`${edge.source}-${edge.target}-${index}`}>{edge.source} <strong>{edge.relationship}</strong> {edge.target}</div>
            ))}
          </div>
          <p className="muted">{result.merged ? "Merged into graph database." : "Preview only. Enable merge to persist these records."}</p>
        </section>
      )}
    </section>
  );
}
