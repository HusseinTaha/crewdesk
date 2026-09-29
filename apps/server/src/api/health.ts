import type { FastifyInstance } from "fastify";
import type { HealthInfo } from "@cch/shared";
import type { Hub } from "../hub.js";
import { VERSION } from "../version.js";

export function registerHealthRoutes(app: FastifyInstance, hub: Hub) {
  const health = async (): Promise<HealthInfo> => {
    let database: HealthInfo["database"] = "ok";
    try {
      hub.db.prepare("SELECT 1").get();
    } catch {
      database = "error";
    }
    return {
      status: "ok",
      database,
      websocket: "ok",
      uptime: Math.round((Date.now() - hub.startedAt) / 1000),
      version: VERSION,
      pid: process.pid,
    };
  };
  app.get("/health", health);
  app.get("/api/health", health);

  /** UI settings the dashboard needs at boot. */
  app.get("/api/settings", async () => ({
    notifications: hub.config.notifications,
    sound: hub.config.sound,
    idlePrompts: hub.config.idlePrompts,
    heartbeatTimeout: hub.config.heartbeatTimeout,
    version: VERSION,
  }));
}
