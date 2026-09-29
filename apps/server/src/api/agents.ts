import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AgentIdSchema, HeartbeatSchema, RegisterAgentSchema, UpdateAgentSchema } from "@cch/shared";
import type { Hub } from "../hub.js";
import { parse } from "./validate.js";

const IdParams = z.object({ id: AgentIdSchema });

export function registerAgentRoutes(app: FastifyInstance, hub: Hub) {
  app.post("/api/agents/register", async (req, reply) => {
    const input = parse(RegisterAgentSchema, req.body);
    const { agent, created } = hub.agents.register(input);
    if (created) {
      hub.events.create({ sessionId: agent.sessionId, type: "session.started", message: `${agent.name} started` });
    }
    reply.code(created ? 201 : 200);
    return { success: true, agentId: agent.id, agent: hub.agents.get(agent.id) };
  });

  app.post("/api/agents/heartbeat", async (req) => {
    const input = parse(HeartbeatSchema, req.body);
    const agent = hub.agents.getBySession(input.sessionId);
    const status = agent.status === "OFFLINE" ? (input.status ?? "WORKING") : input.status;
    return { success: true, agent: hub.agents.touch(input.sessionId, status, input.activity) };
  });

  app.get("/api/agents", async () => ({ agents: hub.agents.list() }));

  app.get("/api/agents/:id", async (req) => {
    const { id } = parse(IdParams, req.params);
    const agent = hub.agents.get(id);
    const events = hub.events.list({ session: agent.sessionId, limit: 100 });
    return { agent, events };
  });

  app.patch("/api/agents/:id", async (req) => {
    const { id } = parse(IdParams, req.params);
    return { agent: hub.agents.update(id, parse(UpdateAgentSchema, req.body)) };
  });

  app.delete("/api/agents/:id", async (req) => {
    const { id } = parse(IdParams, req.params);
    const agent = hub.agents.get(id);
    hub.events.cancelAllForSession(agent.sessionId, "Agent removed from the dashboard.");
    hub.agents.remove(id);
    return { success: true };
  });
}
