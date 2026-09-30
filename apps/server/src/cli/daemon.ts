import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { HealthInfo } from "@crewdesk/shared";
import { ensureAccessToken, isWildcardHost, readAccessToken } from "../auth.js";
import type { HubConfig } from "../config.js";
import { Logger } from "../logger.js";
import { buildServer } from "../server.js";
import { isPidAlive } from "../util/process.js";

export const pidFile = (cfg: HubConfig) => path.join(cfg.home, "hub.pid");
export const tokenFile = (cfg: HubConfig) => path.join(cfg.home, "hub.token");
export const logFile = (cfg: HubConfig) => path.join(cfg.home, "logs", "hub.log");
export const baseUrl = (cfg: HubConfig) => `http://${isWildcardHost(cfg.host) ? "127.0.0.1" : cfg.host}:${cfg.port}`;

/** Headers for CLI calls to the hub API: the access token whenever one exists (ignored in local mode). */
export function authHeaders(cfg: HubConfig): Record<string, string> {
  const token = readAccessToken(cfg.home);
  return token ? { authorization: `Bearer ${token}` } : {};
}

export function readPid(cfg: HubConfig): number | null {
  try {
    const pid = Number(fs.readFileSync(pidFile(cfg), "utf8").trim());
    return pid > 0 && isPidAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

export async function health(cfg: HubConfig, timeoutMs = 1500): Promise<HealthInfo | null> {
  try {
    const res = await fetch(`${baseUrl(cfg)}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? ((await res.json()) as HealthInfo) : null;
  } catch {
    return null;
  }
}

/** Run the hub in this process (used by `start --foreground` and by the detached daemon). */
export async function runForeground(cfg: HubConfig, opts: { daemon: boolean }) {
  fs.mkdirSync(cfg.home, { recursive: true });
  const token = crypto.randomBytes(24).toString("hex");
  const log = new Logger(cfg.logLevel, opts.daemon ? logFile(cfg) : null, !opts.daemon);
  const accessToken = cfg.remote ? ensureAccessToken(cfg.home) : null;
  const { app, hub } = await buildServer({ ...cfg, adminToken: token, accessToken }, log);
  hub.start();
  try {
    await app.listen({ port: cfg.port, host: cfg.host });
  } catch (err) {
    log.error("Failed to start", { error: (err as Error).message });
    hub.close();
    process.exit(1);
  }
  fs.writeFileSync(pidFile(cfg), String(process.pid));
  fs.writeFileSync(tokenFile(cfg), token, { mode: 0o600 });
  log.info("Server started", { url: baseUrl(cfg), database: cfg.database, remote: cfg.remote });

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    log.info("Shutting down");
    await app.close();
    cleanupPid(cfg);
    log.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("exit", () => cleanupPid(cfg));
  return { app, hub };
}

function cleanupPid(cfg: HubConfig) {
  try {
    if (fs.readFileSync(pidFile(cfg), "utf8").trim() === String(process.pid)) {
      fs.rmSync(pidFile(cfg), { force: true });
      fs.rmSync(tokenFile(cfg), { force: true });
    }
  } catch {
    /* already gone */
  }
}

/** Spawn a detached hub process and wait until /health answers. */
export async function startDaemon(cfg: HubConfig, cliScript: string): Promise<{ pid: number; already: boolean }> {
  const running = readPid(cfg);
  if (running && (await health(cfg))) return { pid: running, already: true };
  if (await health(cfg)) throw new Error(`port ${cfg.port} is already serving another hub or program`);
  fs.mkdirSync(path.dirname(logFile(cfg)), { recursive: true });
  const out = fs.openSync(logFile(cfg), "a");
  const child = spawn(process.execPath, [cliScript, "start", "--foreground", "--daemon"], {
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
    env: {
      ...process.env,
      CREWDESK_HOME: cfg.home,
      CREWDESK_PORT: String(cfg.port),
      CREWDESK_HOST: cfg.host,
      CREWDESK_REMOTE: cfg.remote ? "1" : "0",
    },
  });
  child.unref();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    if (await health(cfg, 500)) return { pid: child.pid!, already: false };
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`hub did not start; see ${logFile(cfg)}`);
}

export async function stopDaemon(cfg: HubConfig): Promise<boolean> {
  const pid = readPid(cfg);
  let token = "";
  try {
    token = fs.readFileSync(tokenFile(cfg), "utf8").trim();
  } catch {
    /* no token */
  }
  if (token) {
    try {
      await fetch(`${baseUrl(cfg)}/api/admin/shutdown`, { method: "POST", headers: { "x-hub-token": token }, signal: AbortSignal.timeout(2000) });
    } catch {
      /* fall through to kill */
    }
  }
  if (!pid) return Boolean(token);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && isPidAlive(pid)) await new Promise((r) => setTimeout(r, 100));
  if (isPidAlive(pid)) {
    try {
      process.kill(pid);
    } catch {
      /* gone */
    }
  }
  fs.rmSync(pidFile(cfg), { force: true });
  fs.rmSync(tokenFile(cfg), { force: true });
  return true;
}
