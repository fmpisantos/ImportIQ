// Thin API client. Uses relative URLs — Vite proxies /api to the backend in
// dev; in production the frontend is served from the same origin as the API.

async function http(method, path, body) {
  const res = await fetch(path, {
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
  getConfig: () => http('GET', '/api/config'),
  updateConfig: (key, patch) => http('PUT', `/api/config/${key}`, patch),
  setActiveTransport: (method) => http('POST', '/api/config/active', { method }),
};

// Export helpers POST results back and trigger a file download.
export async function downloadExport(format, results) {
  const res = await fetch(`/api/export/${format}`, {
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
