import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

export const E2E_PORT = 7788;
export const E2E_HOME = path.join(os.tmpdir(), `crewdesk-e2e-${process.pid}`);
process.env.CREWDESK_E2E_HOME ??= E2E_HOME;

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${E2E_PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: "node bin/crewdesk.mjs start --foreground",
    url: `http://127.0.0.1:${E2E_PORT}/health`,
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      CREWDESK_HOME: process.env.CREWDESK_E2E_HOME!,
      CREWDESK_PORT: String(E2E_PORT),
      CREWDESK_WAITER_GRACE: "800",
      LOG_LEVEL: "warn",
    },
  },
});
