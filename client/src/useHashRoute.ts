import { useEffect, useState } from "react";

export type Route = "search" | "config" | "batches";

const ROUTES: Route[] = ["search", "config", "batches"];

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  return (ROUTES as string[]).includes(raw) ? (raw as Route) : "search";
}

/** Minimal dependency-free hash router for the three top-level views. */
export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(parse);

  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = (r: Route) => {
    window.location.hash = `/${r}`;
  };

  return [route, navigate];
}
