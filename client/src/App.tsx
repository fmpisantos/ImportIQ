import { useEffect, useState } from "react";
import type { HealthResponse } from "@importiq/shared";
import { getHealth } from "./api";
import { useHashRoute, type Route } from "./useHashRoute";
import { SearchPage } from "./pages/SearchPage";
import { ConfigPage } from "./pages/ConfigPage";
import { BatchesPage } from "./pages/BatchesPage";

const NAV: { route: Route; label: string }[] = [
  { route: "search", label: "Search" },
  { route: "config", label: "Configuration" },
  { route: "batches", label: "Batches" },
];

export function App() {
  const [route, navigate] = useHashRoute();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    getHealth()
      .then((h) => {
        setHealth(h);
        setHealthError(false);
      })
      .catch(() => setHealthError(true));
  }, []);

  return (
    <div className="app">
      <header className="topnav">
        <div className="topnav__brand">
          ImportIQ
          <span className="topnav__tagline">DE → PT car imports</span>
        </div>
        <nav className="topnav__links">
          {NAV.map((item) => (
            <button
              key={item.route}
              className={`navlink ${route === item.route ? "navlink--active" : ""}`}
              onClick={() => navigate(item.route)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="topnav__health">
          {healthError ? (
            <span className="health health--down" title="Server unreachable">
              ● Server offline
            </span>
          ) : health ? (
            <span
              className={`health ${health.sourceMode === "live" ? "health--live" : "health--mock"}`}
              title={`ISV tables ${health.isvTablesVersion} · ${
                health.isvVerified ? "verified" : "unverified"
              }`}
            >
              ● {health.sourceMode === "live" ? "Live" : "Mock"} ·{" "}
              {health.isvTablesVersion}
              {!health.isvVerified ? " (ISV unverified)" : ""}
            </span>
          ) : (
            <span className="health health--unknown">● …</span>
          )}
        </div>
      </header>

      <main>
        {route === "search" && <SearchPage />}
        {route === "config" && <ConfigPage />}
        {route === "batches" && <BatchesPage />}
      </main>
    </div>
  );
}
