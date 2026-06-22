/**
 * Shared HTTP helper for the live adapters (Specification §3.5).
 *
 * Provides realistic browser headers and a single global pacing gate so we never
 * hammer a source — paged requests are serialised with a minimum gap. Live
 * adapters use this; the `mock` source never touches the network.
 */

import { config } from "../config.js";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9,pt;q=0.8,de;q=0.7",
};

let pacingChain: Promise<void> = Promise.resolve();

/** Serialise all live requests behind a minimum inter-request delay. */
function paced<T>(task: () => Promise<T>): Promise<T> {
  const run = pacingChain.then(task);
  pacingChain = run.then(
    () => sleep(config.sourcePacingMs),
    () => sleep(config.sourcePacingMs),
  );
  return run;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<string> {
  return paced(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { ...DEFAULT_HEADERS, ...(init.headers ?? {}) },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  });
}

/**
 * Extract and parse the JSON embedded in `<script id="__NEXT_DATA__">…</script>`
 * (used by AutoScout24 and Standvirtual). Returns `null` if absent.
 */
export function extractNextData(html: string): unknown | null {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!);
  } catch {
    return null;
  }
}

/**
 * Extract the JSON assigned to `window.__INITIAL_STATE__` (mobile.de SSR).
 * Returns `null` when the anti-bot shell omitted it.
 */
export function extractInitialState(html: string): unknown | null {
  const m = /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!);
  } catch {
    return null;
  }
}
