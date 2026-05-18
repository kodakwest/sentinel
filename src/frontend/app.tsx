import { Moon, Stethoscope, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantPanel, type AssistantContext } from "./assistant";
import { CheatSheetView } from "./cheatsheet";
import { ConditionView } from "./condition";
import { DrugDossierView } from "./dossier";
import { IngestView } from "./ingest";
import { SearchView } from "./search";
import "./style.css";

type Route =
  | { page: "search" }
  | { page: "drug"; id: string }
  | { page: "drug-cheatsheet"; id: string }
  | { page: "condition"; id: string }
  | { page: "ingest" };

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const [page, id, subpage] = hash.split("/");
  if (page === "drug" && id) {
    if (subpage === "cheatsheet") return { page: "drug-cheatsheet", id: decodeURIComponent(id) };
    return { page: "drug", id: decodeURIComponent(id) };
  }
  if (page === "condition" && id) return { page: "condition", id: decodeURIComponent(id) };
  if (page === "ingest") return { page: "ingest" };
  return { page: "search" };
}

function App() {
  const [route, setRoute] = useState<Route>(parseRoute);
  const [theme, setTheme] = useState(() => localStorage.getItem("sentinel-theme") || "light");
  const [assistantContext, setAssistantContext] = useState<AssistantContext | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("sentinel-theme", theme);
  }, [theme]);

  const routeTitle = useMemo(() => {
    if (route.page === "drug") return "Drug dossier";
    if (route.page === "drug-cheatsheet") return "Drug cheat sheet";
    if (route.page === "condition") return "Condition deep-dive";
    if (route.page === "ingest") return "Knowledge ingest";
    return "Search";
  }, [route]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#/">
          <Stethoscope size={24} aria-hidden="true" />
          <span>Sentinel</span>
        </a>
        <nav className="nav-links" aria-label="Primary">
          <a href="#/">Search</a>
          <a href="#/ingest">Ingest</a>
        </nav>
        <span className="route-title">{routeTitle}</span>
        <button
          className="icon-button"
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle dark mode"
          title="Toggle dark mode"
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      <main>
        {route.page === "search" && <SearchView />}
        {route.page === "drug" && <DrugDossierView id={route.id} onExplain={setAssistantContext} />}
        {route.page === "drug-cheatsheet" && <CheatSheetView id={route.id} />}
        {route.page === "condition" && <ConditionView id={route.id} onExplain={setAssistantContext} />}
        {route.page === "ingest" && <IngestView />}
      </main>

      <AssistantPanel context={assistantContext} onContextConsumed={() => setAssistantContext(null)} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
