import { defineConfig } from "vitest/config";

// Standalone config (no PWA/react plugins needed) — the sync math is pure TS.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
