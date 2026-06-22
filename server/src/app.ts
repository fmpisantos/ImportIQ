/**
 * Express application wiring. Kept separate from `index.ts` so it can be
 * imported by integration tests without binding a port.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { api } from "./routes/index.js";
import { errorHandler } from "./routes/util.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", api);

  // Serve the built client in production, when present.
  const clientDist = path.resolve(here, "..", "..", "client", "dist");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
