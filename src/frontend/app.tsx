import { Moon, Sun, LogOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantPanel, type AssistantContext } from "./assistant";
import { CheatSheetView } from "./cheatsheet";
import { ConditionView } from "./condition";
import { DrugDossierView } from "./dossier";
import { IngestView } from "./ingest";
import { SearchView } from "./search";
import { LoginView } from "./login";
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
  const [theme, setTheme] = useState(() => localStorage.getItem("sentinel-theme") || "dark");
  const [assistantContext, setAssistantContext] = useState<AssistantContext | null>(null);
  
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(res => {
        if (res.ok) setIsAuthenticated(true);
        else setIsAuthenticated(false);
      })
      .catch(() => setIsAuthenticated(false));
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("sentinel-theme", theme);
  }, [theme]);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setIsAuthenticated(false);
      window.location.hash = "";
    } catch (e) {
      console.error("Logout failed", e);
    }
  };

  const routeTitle = useMemo(() => {
    if (route.page === "drug") return "Drug dossier";
    if (route.page === "drug-cheatsheet") return "Drug cheat sheet";
    if (route.page === "condition") return "Condition deep-dive";
    if (route.page === "ingest") return "Knowledge ingest";
    return "Search";
  }, [route]);

  if (isAuthenticated === null) {
    return <div className="app-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div>Loading...</div></div>;
  }

  if (isAuthenticated === false) {
    return <LoginView />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#/">
          <DoseAtlasMark />
          <span>DoseAtlas</span>
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
        <button
          className="icon-button"
          type="button"
          onClick={handleLogout}
          aria-label="Log out"
          title="Log out"
        >
          <LogOut size={18} />
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

function DoseAtlasMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="25" y="20" width="50" height="65" rx="4" stroke="#fb7185" strokeWidth="6" strokeLinejoin="round" />
      <path d="M40 20V12C40 9.79086 41.7909 8 44 8H56C58.2091 8 60 9.79086 60 12V20" stroke="#fb7185" strokeWidth="6" strokeLinejoin="round" />
      <path d="M50 40V65" stroke="#e07d5f" strokeWidth="6" strokeLinecap="round" />
      <path d="M38 52.5H62" stroke="#e07d5f" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
