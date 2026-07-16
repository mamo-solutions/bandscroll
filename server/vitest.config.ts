import { defineConfig } from "vitest/config";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Deterministic env for tests. dotenv (in env.ts) does not override values that
// are already present in process.env, so these win over any root .env.
export default defineConfig({
  test: {
    environment: "node",
    env: {
      NODE_ENV: "test",
      // Keep suites quiet; logger.test.ts overrides this per-case via stubEnv.
      LOG_LEVEL: "error",
      ADMIN_PASSWORD: "test-password-123",
      ADMIN_SESSION_SECRET: "test-session-secret-which-is-long-enough",
      AI_CONFIG_ENCRYPTION_KEY: "test-ai-config-encryption-key",
      STORAGE: "memory",
      DATA_DIR: join(tmpdir(), "bandscroll-test-data"),
      UPLOAD_DIR: join(tmpdir(), "bandscroll-test-uploads"),
      SHARE_PREVIEW_DIR: join(tmpdir(), "bandscroll-test-share-previews"),
      PUBLIC_BASE_URL: "http://localhost:3000",
    },
    // Socket.IO integration tests share a module-level store/io singleton, so
    // run files sequentially in one process.
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    testTimeout: 10000,
  },
});
