import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import type { ApiError } from "@crewdesk/shared";
import { registerAgentRoutes } from "./api/agents.js";
import { registerEventRoutes } from "./api/events.js";
import { registerHealthRoutes } from "./api/health.js";
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

export async function buildServer(config: HubConfig, log: Logger): Promise<BuiltServer> {
  const hub = new Hub(config, log);
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024, forceCloseConnections: true });
  const loopbackOnly = LOOPBACK_HOSTS.has(config.host) || config.host === "::1";

  /**
   * Protect a localhost service from the browser: reject DNS-rebinding Host headers and cross-site
   * Origins, so a random web page cannot approve permissions through the user's browser.
   */
  app.addHook("onRequest", async (req, reply) => {
    if (!loopbackOnly) return;
    const host = req.headers.host;
    if (host && !LOOPBACK_HOSTS.has(hostOf(host))) {
      return reply.code(403).send({ error: { code: "FORBIDDEN_HOST", message: "Host not allowed." } } satisfies ApiError);
    }
    const origin = req.headers.origin;
    if (origin && origin !== "null") {
      let ok = false;
      try {
        ok = LOOPBACK_HOSTS.has(hostOf(new URL(origin).host));
      } catch {
        ok = false;
      }
      if (!ok) {
        return reply
          .code(403)
          .send({ error: { code: "FORBIDDEN_ORIGIN", message: "Cross-origin requests are not allowed." } } satisfies ApiError);
      }
    }
  });

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
