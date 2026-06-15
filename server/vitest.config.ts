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
      ADMIN_PASSWORD: "test-password-123",
      ADMIN_SESSION_SECRET: "test-session-secret-which-is-long-enough",
      UPLOAD_DIR: join(tmpdir(), "play-a-sync-test-uploads"),
      PUBLIC_BASE_URL: "http://localhost:3000",
    },
    // Socket.IO integration tests share a module-level store/io singleton, so
    // run files sequentially in one process.
    fileParallelism: false,
    testTimeout: 10000,
  },
});
