import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app is served under the /importiq/ path prefix (behind the Caddy reverse
// proxy in ../routing, which forwards the full path without stripping). `base`
// makes Vite emit asset URLs under that prefix and exposes it as
// import.meta.env.BASE_URL for the API client. The dev server proxies
// <base>api → backend, which also mounts its routes under the same prefix.
//
// All three knobs are parametrised via env so several instances can run side by
// side on one machine (see the `dev-<name>` scripts in the root package.json):
//   WEB_BASE   path prefix, must end with '/'   (default '/importiq/')
//   WEB_PORT   dev server port                  (default 5173)
//   API_TARGET backend origin the proxy targets (default http://localhost:3001)
const base = process.env.WEB_BASE ?? '/importiq/';
const port = Number(process.env.WEB_PORT ?? 5173);
const apiTarget = process.env.API_TARGET ?? 'http://localhost:3001';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    // Bind on IPv4 explicitly — the Caddy proxy in ../routing targets
    // 127.0.0.1:5173, and Vite's default `localhost` bind can land on ::1 only.
    host: '127.0.0.1',
    port,
    // Requests arrive via Tailscale → Caddy with the tailnet hostname in the
    // Host header; Vite blocks non-localhost hosts unless listed here.
    allowedHosts: ['raspberrypi', '.ts.net'],
    proxy: {
      // base ends with '/', so this is e.g. '/importiq/api' → backend.
      [`${base}api`]: apiTarget,
    },
  },
  preview: {
    port,
  },
});
