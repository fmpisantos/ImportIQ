// Typed fetch wrapper around the ImportIQ backend. Every call returns the
// shared API types; failures throw an `ApiError` carrying the HTTP status so
// callers can render a graceful error state instead of crashing.

import type {
  BatchResult,
  BatchSearch,
  BrandsResponse,
  ConfigResponse,
  HealthResponse,
  SearchFilters,
  SearchRequest,
  SearchResponse,
} from "@importiq/shared";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch (err) {
    // Network failure / server down — surface a friendly message.
    throw new ApiError(
      "Cannot reach the ImportIQ server. Is it running on :8080?",
      0,
    );
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      // body wasn't JSON — keep the default message
    }
    throw new ApiError(message, res.status);
  }

  // 204 / empty body tolerance.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// --- Health -------------------------------------------------------------
export const getHealth = () => request<HealthResponse>("/health");

// --- Brands -------------------------------------------------------------
export const getBrands = () => request<BrandsResponse>("/brands");

// --- Search -------------------------------------------------------------
export const postSearch = (body: SearchRequest) =>
  request<SearchResponse>("/search", {
    method: "POST",
    body: JSON.stringify(body),
  });

// --- Config -------------------------------------------------------------
export const getConfig = () => request<ConfigResponse>("/config");

export const updateConfigRow = (
  key: string,
  patch: { amountEur?: number; enabled?: boolean; notes?: string | null },
) =>
  request<ConfigResponse>(`/config/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });

export const setActiveTransport = (method: string) =>
  request<ConfigResponse>("/config/active", {
    method: "POST",
    body: JSON.stringify({ method }),
  });

export const addOtherConfigRow = (label: string, amountEur: number) =>
  request<ConfigResponse>("/config/other", {
    method: "POST",
    body: JSON.stringify({ label, amountEur }),
  });

export const deleteConfigRow = (key: string) =>
  request<ConfigResponse>(`/config/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });

// --- Batches ------------------------------------------------------------
export const getBatches = () => request<BatchSearch[]>("/batches");

export const createBatch = (name: string, filters: SearchFilters) =>
  request<BatchSearch>("/batches", {
    method: "POST",
    body: JSON.stringify({ name, filters }),
  });

export const updateBatch = (
  id: string,
  patch: { name?: string; filters?: SearchFilters; enabled?: boolean },
) =>
  request<BatchSearch>(`/batches/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });

export const deleteBatch = (id: string) =>
  request<{ ok: true }>(`/batches/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

export const getBatchResults = () =>
  request<BatchResult[]>("/batches/results");
