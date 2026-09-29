import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/live/**/*.live.test.ts"],
    testTimeout: 300000,
    hookTimeout: 120000,
    pool: "forks",
    fileParallelism: false,
  },
});
