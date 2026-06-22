import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite dev server runs on 5173 and proxies all /api traffic to the backend on
// :8080, so the browser only ever talks to a single origin in development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
