import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app is served under the /importiq/ path prefix (behind the Caddy reverse
// proxy in ../routing, which forwards the full path without stripping). `base`
// makes Vite emit asset URLs under /importiq/ and exposes it as
// import.meta.env.BASE_URL for the API client. The dev server proxies
// /importiq/api → backend, which also mounts its routes under that prefix.
export default defineConfig({
  base: '/importiq/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/importiq/api': 'http://localhost:3001',
    },
  },
  preview: {
    port: 5173,
  },
});
