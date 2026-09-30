import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import type { ApiError } from "@crewdesk/shared";
import { registerAgentRoutes } from "./api/agents.js";
import { registerEventRoutes } from "./api/events.js";
import { registerHealthRoutes } from "./api/health.js";
import { ACCESS_COOKIE, COOKIE_MAX_AGE_S, cookieValue, loginPage, tokensEqual } from "./auth.js";
import type { HubConfig } from "./config.js";
import { Hub } from "./hub.js";
import type { Logger } from "./logger.js";
import { HubError } from "./services/errors.js";
import { registerWebSocket } from "./websocket/websocket.js";

export interface BuiltServer {
  app: FastifyInstance;
  hub: Hub;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function hostOf(value: string): string {
  // "127.0.0.1:7777" -> "127.0.0.1", "[::1]:7777" -> "[::1]"
  return value.startsWith("[") ? value.slice(0, value.indexOf("]") + 1) : value.split(":")[0]!;
}

function deny(_req: FastifyRequest, reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } } satisfies ApiError);
}

const TOKEN_REQUIRED = "Access token required (remote mode). Run `crewdesk token` on the hub.";
const CROSS_ORIGIN = "Cross-origin requests are not allowed.";

/**
 * Remote mode: require the access token on every request except /health (liveness only) and the
 * shutdown endpoint (it has its own per-run token). `/?token=…` is the login URL: it sets an HttpOnly,
 * SameSite=Strict cookie and redirects to the same page without the token in the address bar.
 */
async function remoteAuth(req: FastifyRequest, reply: FastifyReply, token: string) {
  const url = new URL(req.url, "http://hub");
  if (url.pathname === "/health" || (url.pathname === "/api/admin/shutdown" && req.method === "POST")) return;

  // Browsers attach Origin to cross-site requests; it must be this hub (same host:port).
  const origin = req.headers.origin;
  if (origin && origin !== "null") {
    let same = false;
    try {
      same = new URL(origin).host === req.headers.host;
    } catch {
      same = false;
    }
    if (!same) return deny(req, reply, 403, "FORBIDDEN_ORIGIN", CROSS_ORIGIN);
  }

  const isApi = url.pathname.startsWith("/api") || url.pathname === "/ws";
  const login = url.searchParams.get("token");
  if (login !== null && req.method === "GET" && !isApi) {
    reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer");
    if (!tokensEqual(login, token)) {
      return reply.code(401).type("text/html").send(loginPage("That token is not valid. It may have been rotated."));
    }
    const secure = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https";
    reply.header(
      "set-cookie",
      `${ACCESS_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_S}${secure ? "; Secure" : ""}`,
    );
    url.searchParams.delete("token");
    return reply.redirect(url.pathname + url.search, 302);
  }

  const auth = req.headers.authorization;
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const cookie = cookieValue(req.headers.cookie, ACCESS_COOKIE);
  if ((bearer && tokensEqual(bearer, token)) || (cookie && tokensEqual(cookie, token))) return;

  if (isApi) return deny(req, reply, 401, "UNAUTHORIZED", TOKEN_REQUIRED);
  return reply.code(401).type("text/html").header("cache-control", "no-store").send(loginPage());
}

export async function buildServer(config: HubConfig, log: Logger): Promise<BuiltServer> {
  const hub = new Hub(config, log);
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024, forceCloseConnections: true });
  const loopbackOnly = !config.remote;
  const accessToken = config.accessToken;
  // Never serve the network without authentication.
  if (config.remote && !accessToken) throw new Error("remote mode requires an access token");

  if (!loopbackOnly) {
    // The dashboard must never be framed by another site (clickjacking the Allow button).
    app.addHook("onSend", async (_req, reply) => {
      reply.header("x-frame-options", "DENY");
      reply.header("content-security-policy", "frame-ancestors 'none'");
    });
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HubError) {
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code, message: err.message, details: err.details } } satisfies ApiError);
    }
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      const code =
        e.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" ? "UNSUPPORTED_MEDIA_TYPE"
        : e.code?.startsWith("FST_ERR_CTP") || /JSON/i.test(e.message) ? "MALFORMED_JSON"
        : "BAD_REQUEST";
      return reply.code(e.statusCode).send({ error: { code, message: e.message } } satisfies ApiError);
    }
    log.error("Unhandled error", { error: e.message });
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error." } } satisfies ApiError);
  });

  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });
  // Registered after the WebSocket plugin on purpose: its onRequest hook marks upgrade requests so the
  // socket is closed after our rejection is sent. Rejecting first would leave rejected sockets open.
  /**
   * Protect a localhost service from the browser: reject DNS-rebinding Host headers and cross-site
   * Origins, so a random web page cannot approve permissions through the user's browser.
   */
  app.addHook("onRequest", async (req, reply) => {
    if (!loopbackOnly) return remoteAuth(req, reply, accessToken!);
    const host = req.headers.host;
    if (host && !LOOPBACK_HOSTS.has(hostOf(host))) {
      return deny(req, reply, 403, "FORBIDDEN_HOST", "Host not allowed.");
    }
    const origin = req.headers.origin;
    if (origin && origin !== "null") {
      let ok = false;
      try {
        ok = LOOPBACK_HOSTS.has(hostOf(new URL(origin).host));
      } catch {
        ok = false;
      }
      if (!ok) return deny(req, reply, 403, "FORBIDDEN_ORIGIN", CROSS_ORIGIN);
    }
  });

  registerHealthRoutes(app, hub);
  registerAgentRoutes(app, hub);
  registerEventRoutes(app, hub);
  registerWebSocket(app, hub);

  const webDir = config.webDir;
  if (webDir && fs.existsSync(path.join(webDir, "index.html"))) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/ws")) {
        return reply.type("text/html").sendFile("index.html");
      }
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found." } } satisfies ApiError);
    });
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found." } } satisfies ApiError),
    );
  }

  app.addHook("onClose", async () => hub.close());
  return { app, hub };
}
