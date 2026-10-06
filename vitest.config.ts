import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    globalSetup: ["tests/global-setup.ts"],
    env: {
      BETTER_AUTH_SECRET: "test-secret-test-secret-test",
      STORAGE_SECRET: "test-storage-secret-test-secret",
      DATABASE_URL: "postgres://exquis:exquis@localhost:5432/exquis_test",
    },
  },
});
