import { Search } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

interface DrugSearchResult {
  id: number;
  name: string;
  generic_name?: string;
  drug_class?: string;
  brand_names: string[];
  indications: string[];
}

interface DrugClassSummary {
  name: string;
  count: number;
}

// Will be replaced by top classes from API on first load
const FALLBACK_CATEGORIES = ["NSAID", "Laxatives", "Proton pump inhibitors", "Thrombolytic", "Corticosteroids", "Antiseizure"];

export function SearchView() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DrugSearchResult[]>([]);
  const [classes, setClasses] = useState<DrugClassSummary[]>([]);
  const [recent, setRecent] = useState<string[]>(() => JSON.parse(localStorage.getItem("sentinel-recent") || "[]") as string[]);
  const [viewedDrugs, setViewedDrugs] = useState<string[]>(
    () => JSON.parse(localStorage.getItem("sentinel-recent-dossiers") || "[]") as string[]
  );
  const [discussedDrugs, setDiscussedDrugs] = useState<string[]>(
    () => JSON.parse(localStorage.getItem("sentinel-recent-discussed") || "[]") as string[]
  );
  const [loading, setLoading] = useState(false);
  const [classLoading, setClassLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeClass, setActiveClass] = useState("");

  useEffect(() => {
    setClassLoading(true);
    fetch("/api/drugs/classes")
      .then(async (response) => {
        const data = await response.json() as { classes?: DrugClassSummary[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Unable to load drug classes");
        setClasses(data.classes ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load drug classes"))
      .finally(() => setClassLoading(false));
  }, []);

  useEffect(() => {
    localStorage.setItem("sentinel-recent", JSON.stringify(recent));
  }, [recent]);

  useEffect(() => {
    const handler = () => {
      setViewedDrugs(JSON.parse(localStorage.getItem("sentinel-recent-dossiers") || "[]") as string[]);
    };
    window.addEventListener("dossier-viewed", handler);
    return () => window.removeEventListener("dossier-viewed", handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      setDiscussedDrugs(JSON.parse(localStorage.getItem("sentinel-recent-discussed") || "[]") as string[]);
    };
    window.addEventListener("storage", handler);
    window.addEventListener("focus", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("focus", handler);
    };
  }, []);

  async function runSearch(nextQuery = query) {
    const q = nextQuery.trim();
    if (!q) return;
    setLoading(true);
    setError("");
    setActiveClass("");
    try {
      const response = await fetch(`/api/drugs/search?q=${encodeURIComponent(q)}&limit=20`);
      const data = await response.json() as { results?: DrugSearchResult[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Search failed");
      setResults(data.results ?? []);
      setRecent((current) => [q, ...current.filter((item) => item.toLowerCase() !== q.toLowerCase())].slice(0, 6));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function runClassSearch(className: string) {
    const name = className.trim();
    if (!name) return;
    setLoading(true);
    setError("");
    setQuery("");
    setActiveClass(name);
    try {
      const response = await fetch(`/api/drugs/by-class/${encodeURIComponent(name)}?limit=50`);
      const data = await response.json() as { results?: DrugSearchResult[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Class browse failed");
      setResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Class browse failed");
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void runSearch();
  }

  return (
    <section className="search-page">
      <div className="search-hero">
        <h1>Drug reference for nurses</h1>
        <form className="search-box" onSubmit={submit}>
          <Search size={22} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a drug: digoxin, furosemide, amiodarone" autoFocus />
          <button type="submit">{loading ? "Searching" : "Search"}</button>
        </form>
        <div className="pill-row" aria-label="Drug categories">
          {(classes.length > 0 ? classes.slice(0, 7).map(c => c.name) : FALLBACK_CATEGORIES).map((category) => (
            <button key={category} type="button" onClick={() => { void runClassSearch(category); }}>{category}</button>
          ))}
        </div>
      </div>

      {!query.trim() && !activeClass && (
        <section className="content-band">
          <div className="section-title-row">
            <h2>Browse Drug Classes</h2>
            {classLoading && <span>Loading...</span>}
          </div>
          <div className="class-grid">
            {classes.map((drugClass) => (
              <button className="class-card" key={drugClass.name} type="button" onClick={() => { void runClassSearch(drugClass.name); }}>
                <strong>{drugClass.name}</strong>
                <span>{drugClass.count} {drugClass.count === 1 ? "drug" : "drugs"}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="content-band compact">
          <h2>Recent Searches</h2>
          <div className="recent-list">
            {recent.map((item) => (
              <button key={item} type="button" onClick={() => { setQuery(item); void runSearch(item); }}>{item}</button>
            ))}
          </div>
        </section>
      )}

      {viewedDrugs.length > 0 && discussedDrugs.length > 0 && (
        <section className="content-band compact">
          <h2>Recent Dossiers</h2>
          <div className="recent-list">
            {viewedDrugs.map((name) => {
              const discussed = discussedDrugs.some((drugName) => drugName.toLowerCase() === name.toLowerCase());
              return (
                <a
                  key={name}
                  href={`#/drug/${encodeURIComponent(name)}`}
                  className={`recent-pill ${discussed ? "discussed" : ""}`}
                >
                  {name}{discussed ? " 💬" : ""}
                </a>
              );
            })}
          </div>
        </section>
      )}

      <section className="result-list" aria-live="polite">
        {error && <div className="alert danger">{error}</div>}
        {activeClass && <h2>{activeClass}</h2>}
        {loading && <div className="page-state">Loading...</div>}
        {results.map((drug) => (
          <a className="drug-result" key={drug.id || drug.name} href={`#/drug/${encodeURIComponent(String(drug.id || drug.name))}`}>
            <div>
              <strong>{drug.name}</strong>
              <span>{drug.drug_class || "Drug class pending"}</span>
            </div>
            <p>{drug.brand_names.length ? `Brand: ${drug.brand_names.slice(0, 3).join(", ")}` : drug.generic_name}</p>
          </a>
        ))}
      </section>
    </section>
  );
}
