// Thin API client. URLs are prefixed with the app's base path (import.meta.env
// .BASE_URL, e.g. "/importiq/"), so calls go to /importiq/api/* — matching the
// Caddy route in ../routing and the backend's mount prefix. In dev, Vite
// proxies /importiq/api to the backend.
const apiBase = import.meta.env.BASE_URL.replace(/\/$/, '');

async function http(method, path, body) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error ?? `${method} ${path} failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  getBrands: () => http('GET', '/api/brands'),
  runSearch: (filters) => http('POST', '/api/search', filters),
  recompute: (result, emissionStandard) =>
    http('POST', '/api/recompute', { result, emissionStandard }),
  getConfig: () => http('GET', '/api/config'),
  updateConfig: (key, patch) => http('PUT', `/api/config/${key}`, patch),
  setActiveTransport: (method) => http('POST', '/api/config/active', { method }),
  matchVehicle: (q, limit = 8) =>
    http('GET', `/api/vehicles/match?q=${encodeURIComponent(q)}&limit=${limit}`),
  getVehicleStats: () => http('GET', '/api/vehicles/stats'),
  getSettings: () => http('GET', '/api/settings'),
  updateSettings: (updates, clear = []) => http('PUT', '/api/settings', { updates, clear }),
  testConnection: () => http('POST', '/api/settings/test'),
};

// Export helpers POST results back and trigger a file download.
export async function downloadExport(format, results) {
  const res = await fetch(`${apiBase}/api/export/${format}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ results }),
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `importiq-results.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

export const eur = (n) =>
  n == null
    ? '—'
    : new Intl.NumberFormat('pt-PT', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(n);
