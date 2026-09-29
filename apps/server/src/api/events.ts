import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CancelSchema,
  CreateEventSchema,
  EventIdSchema,
  ListEventsQuerySchema,
  RespondSchema,
  WaitQuerySchema,
} from "@crewdesk/shared";
import type { Hub } from "../hub.js";
import { parse } from "./validate.js";

const IdParams = z.object({ id: EventIdSchema });

export function registerEventRoutes(app: FastifyInstance, hub: Hub) {
  app.post("/api/events", async (req, reply) => {
    const input = parse(CreateEventSchema, req.body);
    const ev = hub.events.create(input);
    // A hook-backed request starts its abandonment clock immediately, in case the hook dies before polling.
    if (ev.status === "PENDING" && input.payload?.transport === "hook") hub.routing.hook.armIdleTimer(ev.id);
    reply.code(201);
    return { id: ev.id, status: ev.status, event: ev };
  });

  app.get("/api/events", async (req) => {
    const q = parse(ListEventsQuerySchema, req.query);
    return { events: hub.events.list(q) };
  });

  app.get("/api/events/pending", async () => ({ events: hub.events.pending() }));

  app.get("/api/events/:id", async (req) => {
    const { id } = parse(IdParams, req.params);
    return { event: hub.events.get(id) };
  });

  app.post("/api/events/:id/respond", async (req) => {
    const { id } = parse(IdParams, req.params);
    const input = parse(RespondSchema, req.body);
    const ev = await hub.events.respond(id, input);
    return { success: true, eventId: ev.id, status: ev.status, event: ev };
  });

  app.post("/api/events/:id/cancel", async (req) => {
    const { id } = parse(IdParams, req.params);
    const input = parse(CancelSchema, req.body);
    const ev = hub.events.cancel(id, input.reason ?? "Cancelled.", input.sessionId);
    return { success: true, eventId: ev.id, status: ev.status, event: ev };
  });

  app.delete("/api/events/:id", async (req) => {
    const { id } = parse(IdParams, req.params);
    hub.events.deleteEvent(id);
    return { success: true };
  });

  /** Long-poll used by crewdesk-hook while Claude Code waits on a decision. */
  app.get("/api/events/:id/wait", async (req) => {
    const { id } = parse(IdParams, req.params);
    const q = parse(WaitQuerySchema, req.query);
    const result = await hub.routing.wait(id, q.sessionId, q.timeout ?? 25000, (fn) => {
      req.raw.once("close", fn);
    });
    return result;
  });

  app.get("/api/policies", async () => hub.policies.list());
}
