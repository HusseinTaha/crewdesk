import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Remote access: when the hub listens beyond loopback, every request (except /health) must carry the
 * access token, either as the `crewdesk_auth` cookie set by the login URL or as `Authorization: Bearer`.
 */
export const ACCESS_COOKIE = "crewdesk_auth";
export const COOKIE_MAX_AGE_S = 30 * 24 * 3600;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
export const isLoopbackHost = (host: string) => LOOPBACK.has(host);
/** Hosts that mean "every interface"; clients reach them through 127.0.0.1. */
export const isWildcardHost = (host: string) => host === "0.0.0.0" || host === "::" || host === "[::]";

export const accessTokenFile = (home: string) => path.join(home, "access.token");

export function readAccessToken(home: string): string | null {
  try {
    return fs.readFileSync(accessTokenFile(home), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Return the persisted access token, creating it (or a new one with `rotate`) readable only by the owner. */
export function ensureAccessToken(home: string, rotate = false): string {
  const existing = rotate ? null : readAccessToken(home);
  if (existing) return existing;
  fs.mkdirSync(home, { recursive: true });
  const token = crypto.randomBytes(32).toString("base64url");
  fs.writeFileSync(accessTokenFile(home), token, { mode: 0o600 });
  return token;
}

/** Constant-time comparison that also hides the length of the expected token. */
export function tokensEqual(given: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Login URLs for the given bind address: one per non-internal IPv4 interface for a wildcard bind. */
export function loginUrls(host: string, port: number, token: string): string[] {
  let hosts = [host];
  if (isWildcardHost(host)) {
    hosts = Object.values(os.networkInterfaces())
      .flat()
      .filter((i): i is os.NetworkInterfaceInfo => Boolean(i && i.family === "IPv4" && !i.internal))
      .map((i) => i.address);
    if (!hosts.length) hosts = [os.hostname()];
  }
  const fmt = (h: string) => (h.includes(":") && !h.startsWith("[") ? `[${h}]` : h);
  return hosts.map((h) => `http://${fmt(h)}:${port}/?token=${encodeURIComponent(token)}`);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Minimal sign-in page shown to browsers without a valid cookie. */
export function loginPage(message?: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Crewdesk · Sign in</title><link rel="icon" href="/favicon.svg">
<style>
:root{color-scheme:dark;--bg:#0b0d10;--card:#151922;--line:#252b36;--fg:#f4f7fa;--muted:#8b95a5}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#f5f7fa;--card:#fff;--line:#d9dee6;--fg:#111827;--muted:#5b6574}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 Inter,system-ui,sans-serif;padding:16px}
main{max-width:440px;width:100%;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px}
h1{margin:0 0 8px;font-size:20px}p{margin:0 0 16px;color:var(--muted)}code{font-family:ui-monospace,Consolas,monospace;color:var(--fg)}
form{display:flex;gap:8px}input{flex:1;min-width:0;padding:9px 11px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:inherit}
button{padding:9px 14px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font:inherit;font-weight:600;cursor:pointer}
.err{color:#ef4444}
</style></head><body><main>
<h1>Crewdesk</h1>
${message ? `<p class="err">${esc(message)}</p>` : ""}
<p>This hub is in remote mode and needs its access token. Open the login link printed by <code>crewdesk token</code> on the server, or paste the token here.</p>
<form method="get" action="/"><input name="token" type="password" placeholder="Access token" autocomplete="off" required autofocus><button>Sign in</button></form>
</main></body></html>`;
}
