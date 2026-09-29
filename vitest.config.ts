import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/*/test/**/*.test.ts", "packages/*/test/**/*.test.ts", "scripts/test/**/*.test.ts"],
    exclude: ["**/*.live.test.ts", "**/node_modules/**"],
    testTimeout: 20000,
    hookTimeout: 30000,
    pool: "forks",
  },
});
