import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { api, sleep, startTestHub, type TestHub } from "./helpers.js";

let hub: TestHub;
beforeEach(async () => {
  hub = await startTestHub();
});
afterEach(async () => {
  await hub.close();
});

const register = (sessionId: string, project = "my-api", name?: string) =>
  api(hub, "POST", "/api/agents/register", { sessionId, project, cwd: `/p/${project}`, name });

const question = (sessionId: string, message: string, transport?: string) =>
  api(hub, "POST", "/api/events", {
    sessionId,
    type: "question.created",
    message,
    payload: { questions: [{ question: message, options: [{ label: "A" }, { label: "B" }] }], ...(transport ? { transport } : {}) },
  });

const permission = (sessionId: string, command: string, extra: Record<string, unknown> = {}) =>
  api(hub, "POST", "/api/events", {
    sessionId,
    type: "permission.created",
    message: command,
    payload: { toolName: "Bash", toolInput: { command }, summary: command, ...extra },
  });

describe("agents", () => {
  it("registers four agents and lists them (Test 1)", async () => {
    for (const [i, p] of ["api", "frontend", "backend", "mobile"].entries()) {
      const r = await register(`session_${i}`, p);
      expect(r.status).toBe(201);
      expect(r.body.agentId).toMatch(/^agent_/);
    }
    const list = await api(hub, "GET", "/api/agents");
    expect(list.body.agents).toHaveLength(4);
    expect(list.body.agents.map((a: any) => a.name)).toEqual(["api #1", "frontend #1", "backend #1", "mobile #1"]);
  });

  it("numbers multiple sessions of one project and does not duplicate on re-register", async () => {
    const a = await register("s1", "shop");
    const b = await register("s2", "shop");
    expect(a.body.agent.name).toBe("shop #1");
    expect(b.body.agent.name).toBe("shop #2");
    const again = await register("s1", "shop");
    expect(again.status).toBe(200);
    expect(again.body.agentId).toBe(a.body.agentId);
    expect((await api(hub, "GET", "/api/agents")).body.agents).toHaveLength(2);
  });

  it("reconnects an OFFLINE session without creating a duplicate", async () => {
    const a = await register("s1");
    await api(hub, "POST", "/api/events", { sessionId: "s1", type: "session.stopped" });
    expect((await api(hub, "GET", `/api/agents/${a.body.agentId}`)).body.agent.status).toBe("OFFLINE");
    await api(hub, "POST", "/api/events", { sessionId: "s1", type: "task.started", message: "go" });
    const agent = (await api(hub, "GET", `/api/agents/${a.body.agentId}`)).body.agent;
    expect(agent.status).toBe("WORKING");
    expect((await api(hub, "GET", "/api/agents")).body.agents).toHaveLength(1);
  });

  it("renames an agent", async () => {
    const a = await register("s1");
    const r = await api(hub, "PATCH", `/api/agents/${a.body.agentId}`, { name: "Payments bot" });
    expect(r.body.agent.name).toBe("Payments bot");
  });

  it("rejects invalid session ids and malformed JSON", async () => {
    const bad = await api(hub, "POST", "/api/agents/register", { sessionId: "a b; rm -rf" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    const res = await fetch(hub.url + "/api/agents/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("MALFORMED_JSON");
  });

  it("returns 404 in the standard error format", async () => {
    const r = await api(hub, "GET", "/api/agents/agent_01J00000000000000000000000");
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: { code: "AGENT_NOT_FOUND", message: "Agent was not found." } });
  });
});

describe("events and routing", () => {
  it("creates a question as PENDING and implicitly registers unknown sessions", async () => {
    const r = await question("new_session", "Which database should I use?");
    expect(r.status).toBe(201);
    expect(r.body.id).toMatch(/^evt_[0-9A-Z]{26}$/);
    expect(r.body.status).toBe("PENDING");
    const agents = (await api(hub, "GET", "/api/agents")).body.agents;
    expect(agents[0].sessionId).toBe("new_session");
    expect(agents[0].status).toBe("QUESTION");
    expect(agents[0].pendingCount).toBe(1);
  });

  it("answers independent questions without cross-talk (Test 2)", async () => {
    await register("s1");
    await register("s2");
    const qa = (await question("s1", "Question A")).body.id;
    const qb = (await question("s2", "Question B")).body.id;
    const r = await api(hub, "POST", `/api/events/${qb}/respond`, { action: "answer", response: "B!", sessionId: "s2" });
    expect(r.status).toBe(200);
    const b = (await api(hub, "GET", `/api/events/${qb}`)).body.event;
    expect(b.response.sessionId).toBe("s2");
    expect(b.response.response).toBe("B!");
    const a = (await api(hub, "GET", `/api/events/${qa}`)).body.event;
    expect(a.status).toBe("PENDING");
    expect(a.sessionId).toBe("s1");
  });

  it("approves one permission while another stays pending (Test 3)", async () => {
    await register("s1");
    await register("s3");
    const pa = (await permission("s1", "npm install zod")).body.id;
    const pb = (await permission("s3", "npm test")).body.id;
    await api(hub, "POST", `/api/events/${pb}/respond`, { action: "allow" });
    expect((await api(hub, "GET", `/api/events/${pa}`)).body.event.status).toBe("PENDING");
    expect((await api(hub, "GET", `/api/events/${pb}`)).body.event.response.action).toBe("allow");
  });

  it("rejects a response aimed at the wrong session (Test 6)", async () => {
    await register("sA");
    await register("sB");
    const ev = (await question("sA", "For A only")).body.id;
    const r = await api(hub, "POST", `/api/events/${ev}/respond`, { action: "answer", response: "x", sessionId: "sB" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("SESSION_MISMATCH");
    const wait = await api(hub, "GET", `/api/events/${ev}/wait?sessionId=sB&timeout=0`);
    expect(wait.status).toBe(403);
    expect((await api(hub, "GET", `/api/events/${ev}`)).body.event.status).toBe("PENDING");
  });

  it("refuses to answer twice", async () => {
    const ev = (await question("s1", "Once")).body.id;
    await api(hub, "POST", `/api/events/${ev}/respond`, { action: "answer", response: "a" });
    const again = await api(hub, "POST", `/api/events/${ev}/respond`, { action: "answer", response: "b" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("EVENT_NOT_PENDING");
  });

  it("validates actions per event type", async () => {
    const ev = (await permission("s1", "ls")).body.id;
    const r = await api(hub, "POST", `/api/events/${ev}/respond`, { action: "answer", response: "yes" });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("INVALID_ACTION");
  });

  it("requires confirmation for destructive permissions", async () => {
    const ev = (await permission("s1", "rm -rf ./build", { destructive: true })).body;
    expect(ev.event.priority).toBe("CRITICAL");
    const r = await api(hub, "POST", `/api/events/${ev.id}/respond`, { action: "allow" });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("CONFIRMATION_REQUIRED");
    const ok = await api(hub, "POST", `/api/events/${ev.id}/respond`, { action: "allow", confirm: true });
    expect(ok.status).toBe(200);
    // Denying never needs confirmation.
    const ev2 = (await permission("s1", "rm -rf /tmp/x", { destructive: true })).body.id;
    expect((await api(hub, "POST", `/api/events/${ev2}/respond`, { action: "deny" })).status).toBe(200);
  });

  it("delivers a decision to a waiting hook through long-poll", async () => {
    await register("s1");
    const ev = (await permission("s1", "npm install zod")).body.id;
    const waiting = api(hub, "GET", `/api/events/${ev}/wait?sessionId=s1&timeout=5000`);
    await sleep(100);
    const r = await api(hub, "POST", `/api/events/${ev}/respond`, { action: "allow" });
    expect(r.body.status).toBe("RESOLVED");
    const w = await waiting;
    expect(w.body.state).toBe("resolved");
    expect(w.body.response.action).toBe("allow");
    const agent = (await api(hub, "GET", "/api/agents")).body.agents[0];
    expect(agent.status).toBe("WORKING");
  });

  it("queues a decision made while the hook is reconnecting (PROCESSING -> RESOLVED)", async () => {
    const ev = (await question("s1", "Later?")).body.id;
    const r = await api(hub, "POST", `/api/events/${ev}/respond`, { action: "answer", answers: { "Later?": "A" } });
    expect(r.body.status).toBe("PROCESSING");
    const w = await api(hub, "GET", `/api/events/${ev}/wait?sessionId=s1&timeout=1000`);
    expect(w.body.state).toBe("resolved");
    expect(w.body.response.answers).toEqual({ "Later?": "A" });
    expect((await api(hub, "GET", `/api/events/${ev}`)).body.event.status).toBe("RESOLVED");
  });

  it("returns pending on long-poll timeout", async () => {
    const ev = (await question("s1", "Slow")).body.id;
    const w = await api(hub, "GET", `/api/events/${ev}/wait?sessionId=s1&timeout=50`);
    expect(w.body).toEqual({ state: "pending" });
  });

  it("cancels a request once its hook goes away (answered in the terminal)", async () => {
    const ev = (await permission("s1", "git push", { transport: "hook" })).body.id;
    const ctrl = new AbortController();
    const p = fetch(`${hub.url}/api/events/${ev}/wait?sessionId=s1&timeout=5000`, { signal: ctrl.signal }).catch(() => null);
    await sleep(100);
    ctrl.abort();
    await p;
    await sleep(hub.config.waiterGraceMs + 300);
    const e = (await api(hub, "GET", `/api/events/${ev}`)).body.event;
    expect(e.status).toBe("CANCELLED");
    expect(e.payload.closeReason).toMatch(/terminal/);
    const w = await api(hub, "GET", `/api/events/${ev}/wait?sessionId=s1&timeout=0`);
    expect(w.body.state).toBe("cancelled");
  });

  it("does not cancel while the hook keeps re-polling", async () => {
    const ev = (await question("s1", "Keep", "hook")).body.id;
    for (let i = 0; i < 4; i++) await api(hub, "GET", `/api/events/${ev}/wait?sessionId=s1&timeout=150`);
    expect((await api(hub, "GET", `/api/events/${ev}`)).body.event.status).toBe("PENDING");
  });

  it("cancel endpoint withdraws a pending request and wakes the waiter", async () => {
    const ev = (await question("s1", "Nevermind")).body.id;
    const waiting = api(hub, "GET", `/api/events/${ev}/wait?sessionId=s1&timeout=5000`);
    await sleep(50);
    const c = await api(hub, "POST", `/api/events/${ev}/cancel`, { reason: "no longer needed" });
    expect(c.body.status).toBe("CANCELLED");
    expect((await waiting).body).toEqual({ state: "cancelled", reason: "no longer needed" });
  });

  it("idle prompt: sends a follow-up and is superseded when the user types in the terminal", async () => {
    await register("s1");
    const p1 = (await api(hub, "POST", "/api/events", { sessionId: "s1", type: "prompt.created", message: "Done." })).body.id;
    const r = await api(hub, "POST", `/api/events/${p1}/respond`, { action: "prompt", response: "Now add tests" });
    expect(r.status).toBe(200);
    const p2 = (await api(hub, "POST", "/api/events", { sessionId: "s1", type: "prompt.created", message: "Done again." })).body.id;
    await api(hub, "POST", "/api/events", { sessionId: "s1", type: "task.started", message: "typed in terminal" });
    expect((await api(hub, "GET", `/api/events/${p2}`)).body.event.status).toBe("CANCELLED");
    const empty = await api(hub, "POST", `/api/events/${p2}/respond`, { action: "prompt", response: " " });
    expect(empty.status).toBe(409);
  });

  it("session end cancels outstanding requests", async () => {
    const q = (await question("s1", "Q")).body.id;
    await api(hub, "POST", "/api/events", { sessionId: "s1", type: "session.stopped" });
    expect((await api(hub, "GET", `/api/events/${q}`)).body.event.status).toBe("CANCELLED");
  });

  it("filters and searches events", async () => {
    await register("s1", "alpha");
    await register("s2", "beta");
    await question("s1", "Which ORM?");
    await permission("s2", "npm install prisma");
    const byType = (await api(hub, "GET", "/api/events?type=permission")).body.events;
    expect(byType).toHaveLength(1);
    const byProject = (await api(hub, "GET", "/api/events?project=alpha&type=question")).body.events;
    expect(byProject[0].message).toBe("Which ORM?");
    const search = (await api(hub, "GET", "/api/events?q=prisma")).body.events;
    expect(search).toHaveLength(1);
    const pending = (await api(hub, "GET", "/api/events?status=pending")).body.events;
    expect(pending).toHaveLength(2);
  });

  it("notifications are dismissable attention items", async () => {
    const n = (await api(hub, "POST", "/api/events", { sessionId: "s1", type: "notification.created", message: "Build finished" })).body;
    expect(n.status).toBe("PENDING");
    const r = await api(hub, "POST", `/api/events/${n.id}/respond`, { action: "dismiss" });
    expect(r.body.status).toBe("RESOLVED");
  });
});

describe("policies", () => {
  it("auto-allows matching commands, never chained or destructive ones", async () => {
    fs.writeFileSync(
      path.join(hub.home, "policies.yaml"),
      `permissions:\n  - match: "npm install *"\n    action: allow\n  - match: "curl *"\n    action: deny\n  - tool: "Bash"\n    match: "rm -rf *"\n    action: allow\n`,
    );
    const ok = (await permission("s1", "npm install zod")).body.event;
    expect(ok.status).toBe("PROCESSING");
    expect(ok.response).toMatchObject({ action: "allow", source: "policy" });
    const denied = (await permission("s1", "curl http://x")).body.event;
    expect(denied.response.action).toBe("deny");
    const chained = (await permission("s1", "npm install x && rm -rf ~")).body.event;
    expect(chained.status).toBe("PENDING");
    const destructive = (await permission("s1", "rm -rf ./dist", { destructive: true })).body.event;
    expect(destructive.status).toBe("PENDING");
    const list = (await api(hub, "GET", "/api/policies")).body;
    expect(list.rules).toHaveLength(3);
  });
});

describe("security", () => {
  it("rejects cross-origin and rebinding requests", async () => {
    const evil = await fetch(hub.url + "/api/agents", { headers: { origin: "https://evil.example" } });
    expect(evil.status).toBe(403);
    // fetch() refuses to override Host, so use a raw request for the DNS-rebinding case.
    const rebindStatus = await new Promise<number>((resolve, reject) => {
      const u = new URL(hub.url);
      http
        .get({ host: u.hostname, port: u.port, path: "/api/agents", headers: { host: "evil.example:7777" } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        })
        .on("error", reject);
    });
    expect(rebindStatus).toBe(403);
    const same = await fetch(hub.url + "/api/agents", { headers: { origin: hub.url } });
    expect(same.status).toBe(200);
  });

  it("health check", async () => {
    const h = await api(hub, "GET", "/health");
    expect(h.body).toMatchObject({ status: "ok", database: "ok", websocket: "ok" });
  });
});

describe("websocket", () => {
  it("pushes hello and live updates", async () => {
    await register("s1");
    const ws = new WebSocket(hub.url.replace("http", "ws") + "/ws");
    const messages: any[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(String(d))));
    await new Promise((r) => ws.once("open", r));
    await sleep(100);
    expect(messages[0].type).toBe("hello");
    expect(messages[0].agents).toHaveLength(1);
    await question("s1", "Live?");
    await sleep(150);
    expect(messages.some((m) => m.type === "event.created" && m.event.message === "Live?")).toBe(true);
    expect(messages.some((m) => m.type === "agent.updated" && m.agent.status === "QUESTION")).toBe(true);
    ws.close();
  });
});

describe("persistence", () => {
  it("keeps pending events and history across a restart (Test 4)", async () => {
    await register("s1");
    const ev = (await question("s1", "Survive restart?")).body.id;
    const home = hub.home;
    await hub.close();
    hub = await startTestHub({ home });
    const e = (await api(hub, "GET", `/api/events/${ev}`)).body.event;
    expect(e.status).toBe("PENDING");
    expect((await api(hub, "GET", "/api/agents")).body.agents).toHaveLength(1);
    const r = await api(hub, "POST", `/api/events/${ev}/respond`, { action: "answer", response: "yes" });
    expect(r.status).toBe(200);
  });
});
