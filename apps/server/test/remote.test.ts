import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { accessTokenFile, cookieValue, ensureAccessToken, loginUrls, tokensEqual } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { Logger } from "../src/logger.js";
import { buildServer } from "../src/server.js";
import { startTestHub, tempHome, type TestHub } from "./helpers.js";

const TOKEN = "test-access-token-0123456789abcdef";
let hub: TestHub | undefined;
afterEach(async () => {
  await hub?.close();
  hub = undefined;
  delete process.env.CREWDESK_REMOTE;
  delete process.env.CREWDESK_HOST;
});

const remoteHub = async () => (hub = await startTestHub({ remote: true, accessToken: TOKEN }));
const get = (url: string, headers: Record<string, string> = {}) => fetch(hub!.url + url, { headers, redirect: "manual" });
const bearer = { authorization: `Bearer ${TOKEN}` };
const cookie = { cookie: `crewdesk_auth=${TOKEN}` };

describe("remote mode config", () => {
  it("is off by default and binds loopback", () => {
    const cfg = loadConfig({ home: tempHome() });
    expect(cfg.remote).toBe(false);
    expect(cfg.host).toBe("127.0.0.1");
  });

  it("--remote / CREWDESK_REMOTE binds every interface", () => {
    process.env.CREWDESK_REMOTE = "1";
    const cfg = loadConfig({ home: tempHome() });
    expect(cfg.remote).toBe(true);
    expect(cfg.host).toBe("0.0.0.0");
  });

  it("any non-loopback host turns remote mode on, so the network never gets an unauthenticated hub", () => {
    process.env.CREWDESK_HOST = "0.0.0.0";
    expect(loadConfig({ home: tempHome() }).remote).toBe(true);
    process.env.CREWDESK_HOST = "192.168.1.20";
    const cfg = loadConfig({ home: tempHome() });
    expect(cfg.remote).toBe(true);
    expect(cfg.host).toBe("192.168.1.20");
  });

  it("refuses to build a remote server without an access token", async () => {
    const cfg = loadConfig({ home: tempHome(), remote: true, accessToken: null });
    await expect(buildServer(cfg, new Logger("error", null, false))).rejects.toThrow(/access token/);
  });
});

describe("access token file", () => {
  it("is created once, reused, and replaced on rotate", () => {
    const home = tempHome();
    const a = ensureAccessToken(home);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ensureAccessToken(home)).toBe(a);
    const b = ensureAccessToken(home, true);
    expect(b).not.toBe(a);
    expect(fs.readFileSync(accessTokenFile(home), "utf8")).toBe(b);
    if (process.platform !== "win32") expect(fs.statSync(accessTokenFile(home)).mode & 0o077).toBe(0);
  });

  it("compares tokens in constant time and parses cookies", () => {
    expect(tokensEqual(TOKEN, TOKEN)).toBe(true);
    expect(tokensEqual("x", TOKEN)).toBe(false);
    expect(cookieValue("a=1; crewdesk_auth=abc; b=2", "crewdesk_auth")).toBe("abc");
    expect(cookieValue(undefined, "crewdesk_auth")).toBeNull();
  });

  it("builds login URLs for a specific host", () => {
    expect(loginUrls("10.0.0.5", 7777, "t/k")).toEqual(["http://10.0.0.5:7777/?token=t%2Fk"]);
    expect(loginUrls("0.0.0.0", 7777, "t").every((u) => u.startsWith("http://") && u.endsWith(":7777/?token=t"))).toBe(true);
  });
});

describe("remote mode requests", () => {
  it("keeps /health open for liveness checks", async () => {
    await remoteHub();
    expect((await get("/health")).status).toBe(200);
  });

  it("rejects API calls without a valid token", async () => {
    await remoteHub();
    const none = await get("/api/agents");
    expect(none.status).toBe(401);
    expect((await none.json()).error.code).toBe("UNAUTHORIZED");
    expect((await get("/api/agents", { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await get("/api/agents", { cookie: "crewdesk_auth=wrong" })).status).toBe(401);
  });

  it("accepts the token as a bearer header or cookie", async () => {
    await remoteHub();
    expect((await get("/api/agents", bearer)).status).toBe(200);
    expect((await get("/api/agents", cookie)).status).toBe(200);
  });

  it("shows the sign-in page to browsers without a session", async () => {
    await remoteHub();
    const res = await get("/");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("Sign in");
  });

  it("login URL sets an HttpOnly SameSite=Strict cookie and strips the token from the address bar", async () => {
    await remoteHub();
    const res = await get(`/?token=${TOKEN}&view=history`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?view=history");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`crewdesk_auth=${TOKEN}`);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).not.toMatch(/Secure/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("marks the cookie Secure behind an HTTPS proxy", async () => {
    await remoteHub();
    const res = await get(`/?token=${TOKEN}`, { "x-forwarded-proto": "https" });
    expect(res.headers.get("set-cookie")).toMatch(/; Secure/);
  });

  it("rejects a wrong login token without setting a cookie", async () => {
    await remoteHub();
    const res = await get("/?token=nope");
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).toContain("not valid");
  });

  it("rejects cross-site requests even with a valid cookie", async () => {
    await remoteHub();
    const host = new URL(hub!.url).host;
    expect((await get("/api/agents", { ...cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await get("/api/agents", { ...cookie, origin: `http://${host}` })).status).toBe(200);
  });

  it("forbids framing the dashboard", async () => {
    await remoteHub();
    const res = await get("/api/agents", bearer);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("requires the token for the WebSocket", async () => {
    await remoteHub();
    const wsUrl = hub!.url.replace("http", "ws") + "/ws";
    const denied = await new Promise<number>((resolve) => {
      const ws = new WebSocket(wsUrl);
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("open", () => resolve(101));
    });
    expect(denied).toBe(401);
    const hello = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { headers: cookie });
      ws.on("message", (m) => {
        resolve(JSON.parse(String(m)).type);
        ws.close();
      });
      ws.on("error", reject);
    });
    expect(hello).toBe("hello");
  });

  it("leaves the shutdown endpoint to its own admin token", async () => {
    await remoteHub();
    const res = await fetch(hub!.url + "/api/admin/shutdown", { method: "POST" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toMatch(/admin token/);
  });
});

describe("local mode is unchanged", () => {
  it("needs no token and still blocks foreign Host headers", async () => {
    hub = await startTestHub();
    expect((await fetch(hub.url + "/api/agents")).status).toBe(200);
    const port = new URL(hub.url).port;
    const res = await new Promise<number>((resolve) => {
      import("node:http").then(({ default: http }) =>
        http.get({ host: "127.0.0.1", port, path: "/api/agents", headers: { host: `evil.example:${port}` } }, (r) => resolve(r.statusCode ?? 0)),
      );
    });
    expect(res).toBe(403);
    expect(fs.existsSync(path.join(hub.home, "access.token"))).toBe(false);
  });
});
