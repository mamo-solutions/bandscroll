import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Standalone config (no PWA/react plugins needed) — the sync math is pure TS.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environmentMatchGlobs: [["src/**/*.a11y.test.tsx", "jsdom"]],
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
