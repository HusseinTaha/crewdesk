import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, type HubConfig } from "../src/config.js";
import { Logger } from "../src/logger.js";
import { buildServer, type BuiltServer } from "../src/server.js";

export interface TestHub extends BuiltServer {
  url: string;
  home: string;
  config: HubConfig;
  close(): Promise<void>;
}

export function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cch-test-"));
}

/** Start a real hub on an ephemeral port with an isolated home directory. */
export async function startTestHub(overrides: Partial<HubConfig> = {}): Promise<TestHub> {
  const home = overrides.home ?? tempHome();
  const config = loadConfig({ home, port: 0, host: "127.0.0.1", waiterGraceMs: 300, logLevel: "error", ...overrides });
  const log = new Logger(config.logLevel, null, false);
  const built = await buildServer(config, log);
  built.hub.start(100000);
  await built.app.listen({ port: config.port, host: config.host });
  const addr = built.app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    ...built,
    home,
    config,
    url: `http://127.0.0.1:${port}`,
    async close() {
      await built.app.close();
    },
  };
}

export async function api<T = any>(hub: { url: string }, method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(hub.url + url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : (undefined as T) };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
