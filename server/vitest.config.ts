import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Isolated, deterministic environment: mock sources and a throwaway DB.
    env: {
      SOURCE_MODE: "mock",
      PT_SOURCE_MODE: "mock",
      DB_PATH: path.resolve(here, "data", "test.db"),
    },
  },
});
