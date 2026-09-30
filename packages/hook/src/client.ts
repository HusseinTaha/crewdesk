import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const RETRY_DELAYS_MS = [100, 500, 1000, 2000];

export function hubHome(): string {
  return process.env.CREWDESK_HOME ?? path.join(os.homedir(), ".crewdesk");
}

/** Hub base URL: CREWDESK_URL, else host/port from config.json, else the default. */
export function hubUrl(): string {
  if (process.env.CREWDESK_URL) return process.env.CREWDESK_URL.replace(/\/+$/, "");
  let host = "127.0.0.1";
  let port = 7777;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(hubHome(), "config.json"), "utf8"));
    if (typeof cfg.host === "string") host = cfg.host;
    if (typeof cfg.port === "number") port = cfg.port;
  } catch {
    /* defaults */
  }
  if (process.env.CREWDESK_PORT) port = Number(process.env.CREWDESK_PORT);
  if (host === "0.0.0.0" || host === "::" || host === "[::]") host = "127.0.0.1";
  return `http://${host}:${port}`;
}

let cachedToken: string | null | undefined;
/** Remote-mode access token: CREWDESK_TOKEN, else <home>/access.token (absent in local mode). */
export function accessToken(): string | null {
  if (cachedToken !== undefined) return cachedToken;
  cachedToken = process.env.CREWDESK_TOKEN || null;
  if (!cachedToken) {
    try {
      cachedToken = fs.readFileSync(path.join(hubHome(), "access.token"), "utf8").trim() || null;
    } catch {
      cachedToken = null;
    }
  }
  return cachedToken;
}

export class HubUnavailable extends Error {}

export class HubHttpError extends Error {
  constructor(
    public status: number,
    public body: any,
  ) {
    super(`hub responded ${status}: ${JSON.stringify(body)}`);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RequestOpts {
  timeoutMs?: number;
  /** Delays between attempts; length + 1 = max attempts. */
  retries?: number[];
}

/** JSON request to the hub with retry on connection failures (never on 4xx). */
export async function request<T = any>(method: string, url: string, body?: unknown, opts: RequestOpts = {}): Promise<T> {
  const retries = opts.retries ?? RETRY_DELAYS_MS;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries.length; attempt++) {
    if (attempt > 0) await sleep(retries[attempt - 1]!);
    try {
      const headers: Record<string, string> = body !== undefined ? { "content-type": "application/json" } : {};
      const token = accessToken();
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(hubUrl() + url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : undefined;
      if (!res.ok) {
        if (res.status >= 500) {
          lastErr = new HubHttpError(res.status, json);
          continue;
        }
        throw new HubHttpError(res.status, json);
      }
      return json as T;
    } catch (err) {
      if (err instanceof HubHttpError && err.status < 500) throw err;
      lastErr = err;
    }
  }
  throw new HubUnavailable(`hub unavailable at ${hubUrl()}: ${(lastErr as Error)?.message ?? lastErr}`);
}

export function debugLog(msg: string) {
  if (!process.env.CREWDESK_HOOK_DEBUG) return;
  try {
    const file = path.join(hubHome(), "logs", "hook.log");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${new Date().toISOString()} [${process.pid}] ${msg}\n`);
  } catch {
    /* never fail the hook because of logging */
  }
}
