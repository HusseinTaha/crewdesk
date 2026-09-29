import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

export const E2E_PORT = 7788;
export const E2E_HOME = path.join(os.tmpdir(), `cch-e2e-${process.pid}`);
process.env.CCH_E2E_HOME ??= E2E_HOME;

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${E2E_PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: "node bin/claude-hub.mjs start --foreground",
    url: `http://127.0.0.1:${E2E_PORT}/health`,
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      CLAUDE_HUB_HOME: process.env.CCH_E2E_HOME!,
      CLAUDE_HUB_PORT: String(E2E_PORT),
      CLAUDE_HUB_WAITER_GRACE: "800",
      LOG_LEVEL: "warn",
    },
  },
});
