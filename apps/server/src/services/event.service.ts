import { ulid } from "ulid";
import {
  REQUEST_EVENT_TYPES,
  type AgentStatus,
  type CreateEventInput,
  type EventStatus,
  type EventType,
  type HubEvent,
  type HubResponse,
  type ListEventsQuery,
  type Priority,
  type RespondInput,
} from "@crewdesk/shared";
import type { Db } from "../db/database.js";
import type { Logger } from "../logger.js";
import type { AgentService } from "./agent.service.js";
import { now } from "./agent.service.js";
import type { EventBus } from "./bus.js";
import { conflict, forbidden, HubError, notFound, unprocessable } from "./errors.js";
import type { PolicyService } from "./policy.service.js";

interface EventRow {
  id: string;
  session_id: string;
  type: string;
  status: string;
  priority: string;
  message: string | null;
  payload: string | null;
  created_at: string;
  resolved_at: string | null;
  agent_id: string | null;
  r_id: string | null;
  r_action: string | null;
  r_response: string | null;
  r_answers: string | null;
  r_source: string | null;
  r_created_at: string | null;
}

const SELECT = `
  SELECT e.*, a.id AS agent_id,
         r.id AS r_id, r.action AS r_action, r.response AS r_response, r.answers AS r_answers,
         r.source AS r_source, r.created_at AS r_created_at
  FROM events e
  LEFT JOIN agents a ON a.session_id = e.session_id
  LEFT JOIN responses r ON r.event_id = e.id`;

function parseJson<T>(s: string | null): T | null {
  if (s == null) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function toEvent(r: EventRow): HubEvent {
  const response: HubResponse | null = r.r_id
    ? {
        id: r.r_id,
        eventId: r.id,
        sessionId: r.session_id,
        action: r.r_action as HubResponse["action"],
        response: r.r_response,
        answers: parseJson(r.r_answers),
        source: (r.r_source ?? "dashboard") as HubResponse["source"],
        createdAt: r.r_created_at!,
      }
    : null;
  return {
    id: r.id,
    sessionId: r.session_id,
    agentId: r.agent_id,
    type: r.type as EventType,
    status: r.status as EventStatus,
    priority: r.priority as Priority,
    message: r.message,
    payload: parseJson(r.payload),
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    response,
  };
}

export const isRequestType = (t: string) => (REQUEST_EVENT_TYPES as readonly string[]).includes(t);
/** Informational events that still need a human to look at them (dismissable). */
const ATTENTION_INFO_TYPES = new Set<string>(["notification.created", "task.failed"]);

/** Status an agent gets when an event of this type arrives. */
const STATUS_ON_CREATE: Partial<Record<EventType, AgentStatus>> = {
  "session.started": "WAITING",
  "session.stopped": "OFFLINE",
  "permission.created": "PERMISSION",
  "question.created": "QUESTION",
  "prompt.created": "WAITING",
  "task.started": "WORKING",
  "task.completed": "COMPLETED",
  "task.failed": "ERROR",
};

/** Activity-log event emitted when a request is resolved. */
function resolutionType(ev: HubEvent, action: string): EventType | null {
  if (ev.type === "permission.created") return action === "allow" ? "permission.approved" : "permission.denied";
  if (ev.type === "question.created") return "question.answered";
  if (ev.type === "prompt.created") return action === "prompt" ? "prompt.sent" : null;
  return null;
}

function cancelType(ev: HubEvent): EventType | null {
  if (ev.type === "question.created") return "question.cancelled";
  if (ev.type === "prompt.created") return "prompt.cancelled";
  return null;
}

export interface DeliveryHooks {
  /** Push a response to the session. Returns true if a live endpoint received it. */
  deliver(ev: HubEvent, response: HubResponse): Promise<boolean>;
  /** Withdraw a request from any waiting endpoint. */
  withdraw(ev: HubEvent, reason: string): void;
}

export class EventService {
  private delivery: DeliveryHooks | null = null;

  constructor(
    private db: Db,
    private bus: EventBus,
    private agents: AgentService,
    private policies: PolicyService,
    private log: Logger,
  ) {}

  setDelivery(d: DeliveryHooks) {
    this.delivery = d;
  }

  get(id: string): HubEvent {
    const row = this.db.prepare(`${SELECT} WHERE e.id = ?`).get(id) as unknown as EventRow | undefined;
    if (!row) throw notFound("EVENT_NOT_FOUND", "Event was not found.");
    return toEvent(row);
  }

  list(q: ListEventsQuery = {}): HubEvent[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (q.status) {
      where.push("e.status = ?");
      params.push(q.status);
    }
    if (q.type) {
      // "question" matches every question.* type; a full type matches exactly.
      if (q.type.includes(".")) {
        where.push("e.type = ?");
        params.push(q.type);
      } else {
        where.push("e.type LIKE ?");
        params.push(`${q.type}.%`);
      }
    }
    if (q.agent) {
      where.push("a.id = ?");
      params.push(q.agent);
    }
    if (q.session) {
      where.push("e.session_id = ?");
      params.push(q.session);
    }
    if (q.project) {
      where.push("a.project_name = ?");
      params.push(q.project);
    }
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
      where.push(
        `(e.message LIKE ? ESCAPE '\\' OR e.payload LIKE ? ESCAPE '\\' OR e.type LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR a.project_name LIKE ? ESCAPE '\\')`,
      );
      params.push(like, like, like, like, like);
    }
    if (q.before) {
      where.push("e.id < ?");
      params.push(q.before);
    }
    const sql = `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY e.id DESC LIMIT ?`;
    params.push(q.limit ?? 200);
    return (this.db.prepare(sql).all(...params) as unknown as EventRow[]).map(toEvent);
  }

  /** Every event still waiting on a human, oldest first. */
  pending(): HubEvent[] {
    return (
      this.db
        .prepare(`${SELECT} WHERE e.status IN ('PENDING','PROCESSING') ORDER BY e.id ASC`)
        .all() as unknown as EventRow[]
    ).map(toEvent);
  }

  private insert(
    sessionId: string,
    type: EventType,
    status: EventStatus,
    priority: Priority,
    message: string | null,
    payload: Record<string, unknown> | null,
  ): HubEvent {
    const id = `evt_${ulid()}`;
    const ts = now();
    const terminal = status !== "PENDING" && status !== "PROCESSING";
    this.db
      .prepare(
        `INSERT INTO events (id, session_id, type, status, priority, message, payload, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, sessionId, type, status, priority, message, payload ? JSON.stringify(payload) : null, ts, terminal ? ts : null);
    return this.get(id);
  }

  /** Log a purely informational activity entry. */
  private logActivity(sessionId: string, type: EventType, message: string | null, payload: Record<string, unknown> | null = null) {
    const ev = this.insert(sessionId, type, "RESOLVED", "LOW", message, payload);
    this.bus.publish({ type: "event.created", event: ev });
    return ev;
  }

  private defaultPriority(input: CreateEventInput): Priority {
    if (input.priority) return input.priority;
    if (input.type === "permission.created") return input.payload?.destructive ? "CRITICAL" : "HIGH";
    if (input.type === "question.created" || input.type === "task.failed") return "HIGH";
    if (input.type === "prompt.created" || input.type === "notification.created") return "NORMAL";
    return "LOW";
  }

  create(input: CreateEventInput): HubEvent {
    // Implicitly register unknown sessions so a hub started mid-session still works.
    let agent = this.agents.findBySession(input.sessionId);
    if (!agent || agent.status === "OFFLINE" || input.type === "session.started") {
      agent = this.agents.register({ sessionId: input.sessionId, ...input.agent }).agent;
    }

    const payload = input.payload ?? null;
    let status: EventStatus = isRequestType(input.type) || ATTENTION_INFO_TYPES.has(input.type) ? "PENDING" : "RESOLVED";
    if (input.type === "notification.created" && payload?.silent) status = "RESOLVED";
    const priority = this.defaultPriority(input);

    // Session-level side effects that happen before the new event exists.
    if (input.type === "task.started") {
      this.cancelSession(input.sessionId, ["prompt.created"], "User continued in the terminal.");
      this.dismissInfo(input.sessionId);
    }
    if (input.type === "session.stopped") {
      this.cancelSession(input.sessionId, null, "Session ended.");
    }
    if (input.type === "prompt.created") {
      // A new idle wait supersedes an older one from the same session.
      this.cancelSession(input.sessionId, ["prompt.created"], "Superseded by a newer idle prompt.");
    }

    const ev = this.insert(input.sessionId, input.type, status, priority, input.message ?? null, payload);
    this.log.info(`Event ${input.type}`, { sessionId: ev.sessionId, eventId: ev.id });
    this.bus.publish({ type: "event.created", event: ev });

    const nextStatus = STATUS_ON_CREATE[input.type];
    const activity =
      input.type === "task.started" ? (input.message ?? null)?.slice(0, 200) ?? null
      : input.type === "session.stopped" ? null
      : undefined;
    if (input.type === "notification.created" && payload?.notificationType === "idle_prompt") {
      this.agents.touch(input.sessionId, "WAITING");
    } else if (nextStatus) {
      this.agents.touch(input.sessionId, nextStatus, activity);
    } else {
      this.agents.touch(input.sessionId);
    }

    if (input.type === "permission.created") return this.applyPolicy(ev);
    return this.get(ev.id);
  }

  private applyPolicy(ev: HubEvent): HubEvent {
    const p = ev.payload ?? {};
    const decision = this.policies.evaluate(
      String(p.toolName ?? ""),
      String(p.summary ?? ""),
      Boolean(p.destructive),
    );
    if (!decision || decision.action === "ask") return ev;
    this.log.info(`Policy ${decision.action}`, { eventId: ev.id, match: decision.rule.match });
    return this.resolve(ev, {
      action: decision.action,
      response: decision.rule.reason ?? `Matched policy "${decision.rule.match}"`,
      source: "policy",
    });
  }

  /** Validate and record a human decision, then hand it to the transport. */
  async respond(id: string, input: RespondInput): Promise<HubEvent> {
    const ev = this.get(id);
    if (input.sessionId && input.sessionId !== ev.sessionId) {
      throw forbidden("SESSION_MISMATCH", "Event does not belong to the given session.");
    }
    if (ev.status !== "PENDING") {
      throw conflict("EVENT_NOT_PENDING", `Event is already ${ev.status}.`);
    }
    const text = input.response ?? input.answer;
    const allowed: Record<string, string[]> = {
      "permission.created": ["allow", "deny"],
      "question.created": ["answer", "dismiss"],
      "prompt.created": ["prompt", "dismiss"],
      "notification.created": ["dismiss"],
      "task.failed": ["dismiss"],
    };
    const actions = allowed[ev.type];
    if (!actions) throw unprocessable("EVENT_NOT_ACTIONABLE", `Events of type ${ev.type} cannot be responded to.`);
    if (!actions.includes(input.action)) {
      throw unprocessable("INVALID_ACTION", `Action "${input.action}" is not valid for ${ev.type}. Use: ${actions.join(", ")}.`);
    }
    if (ev.type === "permission.created" && input.action === "allow" && ev.payload?.destructive && !input.confirm) {
      throw unprocessable("CONFIRMATION_REQUIRED", "This operation may be destructive; resend with confirm=true.");
    }
    if (input.action === "answer" && !text && !(input.answers && Object.keys(input.answers).length)) {
      throw unprocessable("ANSWER_REQUIRED", "Provide an answer.");
    }
    if (input.action === "prompt" && !text?.trim()) {
      throw unprocessable("PROMPT_REQUIRED", "Provide the instruction to send.");
    }
    const resolved = this.resolve(ev, {
      action: input.action,
      response: text ?? null,
      answers: input.answers ?? null,
      source: input.source ?? "dashboard",
    });
    return this.deliver(resolved);
  }

  /** Record the response row and move the event to PROCESSING (awaiting delivery). */
  private resolve(
    ev: HubEvent,
    r: { action: HubResponse["action"]; response?: string | null; answers?: Record<string, string> | null; source: HubResponse["source"] },
  ): HubEvent {
    const responseId = `resp_${ulid()}`;
    const ts = now();
    // Dismissing info events needs no delivery; everything else waits for the session to pick it up.
    const infoOnly = ATTENTION_INFO_TYPES.has(ev.type);
    const status: EventStatus = infoOnly ? "RESOLVED" : "PROCESSING";
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const res = this.db
        .prepare(`UPDATE events SET status = ?, resolved_at = ? WHERE id = ? AND status = 'PENDING'`)
        .run(status, infoOnly ? ts : null, ev.id);
      if (res.changes === 0) throw conflict("EVENT_NOT_PENDING", "Event is no longer pending.");
      this.db
        .prepare(
          `INSERT INTO responses (id, event_id, session_id, action, response, answers, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(responseId, ev.id, ev.sessionId, r.action, r.response ?? null, r.answers ? JSON.stringify(r.answers) : null, r.source, ts);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    this.log.info("Response received", { sessionId: ev.sessionId, eventId: ev.id, action: r.action, source: r.source });
    const updated = this.get(ev.id);
    this.bus.publish({ type: infoOnly ? "event.resolved" : "event.updated", event: updated });

    const logType = resolutionType(ev, r.action);
    if (logType) {
      const summary =
        ev.type === "permission.created" ? String(ev.payload?.summary ?? ev.message ?? "")
        : r.action === "prompt" ? (r.response ?? "")
        : ev.message ?? "";
      this.logActivity(ev.sessionId, logType, summary.slice(0, 500), { requestId: ev.id, source: r.source });
    }
    if (!infoOnly) this.recomputeAgentStatus(ev.sessionId, "WORKING");
    else this.agents.refresh(ev.sessionId);
    return updated;
  }

  /** Try to push a PROCESSING event's response to the live session endpoint. */
  async deliver(ev: HubEvent): Promise<HubEvent> {
    if (ev.status !== "PROCESSING" || !ev.response || !this.delivery) return ev;
    const delivered = await this.delivery.deliver(ev, ev.response);
    return delivered ? this.markDelivered(ev.id) : ev;
  }

  /** The session endpoint received the response. */
  markDelivered(id: string): HubEvent {
    const res = this.db
      .prepare(`UPDATE events SET status = 'RESOLVED', resolved_at = ? WHERE id = ? AND status = 'PROCESSING'`)
      .run(now(), id);
    const ev = this.get(id);
    if (res.changes > 0) {
      this.log.info("Event resolved", { sessionId: ev.sessionId, eventId: id });
      this.bus.publish({ type: "event.resolved", event: ev });
      this.agents.refresh(ev.sessionId);
    }
    return ev;
  }

  cancel(id: string, reason = "Cancelled.", sessionId?: string): HubEvent {
    const ev = this.get(id);
    if (sessionId && sessionId !== ev.sessionId) {
      throw forbidden("SESSION_MISMATCH", "Event does not belong to the given session.");
    }
    if (ev.status !== "PENDING" && ev.status !== "PROCESSING") {
      throw conflict("EVENT_NOT_PENDING", `Event is already ${ev.status}.`);
    }
    return this.finish(ev, "CANCELLED", reason);
  }

  /** Close an event without a delivered decision (cancelled, expired, delivery failed). */
  finish(ev: HubEvent, status: "CANCELLED" | "FAILED", reason: string): HubEvent {
    const payload = { ...(ev.payload ?? {}), closeReason: reason };
    const res = this.db
      .prepare(
        `UPDATE events SET status = ?, resolved_at = ?, payload = ? WHERE id = ? AND status IN ('PENDING','PROCESSING')`,
      )
      .run(status, now(), JSON.stringify(payload), ev.id);
    const updated = this.get(ev.id);
    if (res.changes === 0) return updated;
    this.delivery?.withdraw(updated, reason);
    this.log.info(`Event ${status.toLowerCase()}`, { sessionId: ev.sessionId, eventId: ev.id, reason });
    this.bus.publish({ type: "event.resolved", event: updated });
    const log = status === "CANCELLED" ? cancelType(ev) : null;
    if (log) this.logActivity(ev.sessionId, log, reason, { requestId: ev.id });
    this.recomputeAgentStatus(ev.sessionId);
    return updated;
  }

  /** The hook endpoint for this event vanished: Claude Code resolved it some other way. */
  abandoned(id: string) {
    let ev: HubEvent;
    try {
      ev = this.get(id);
    } catch {
      return;
    }
    if (ev.status === "PENDING") {
      const reason =
        ev.type === "prompt.created" ? "Session resumed from the terminal." : "Handled in the terminal (or the hook timed out).";
      this.finish(ev, "CANCELLED", reason);
    } else if (ev.status === "PROCESSING") {
      this.finish(ev, "FAILED", "The session stopped waiting before the decision was delivered.");
    }
  }

  private cancelSession(sessionId: string, types: string[] | null, reason: string) {
    const rows = this.db
      .prepare(`SELECT id, type FROM events WHERE session_id = ? AND status IN ('PENDING','PROCESSING')`)
      .all(sessionId) as Array<{ id: string; type: string }>;
    for (const r of rows) {
      if (types && !types.includes(r.type)) continue;
      if (!types && ATTENTION_INFO_TYPES.has(r.type)) continue;
      this.finish(this.get(r.id), "CANCELLED", reason);
    }
  }

  /** Auto-dismiss stale notifications once a session is busy again. */
  private dismissInfo(sessionId: string) {
    const rows = this.db
      .prepare(`SELECT id FROM events WHERE session_id = ? AND status = 'PENDING' AND type = 'notification.created'`)
      .all(sessionId) as Array<{ id: string }>;
    for (const r of rows) {
      const ev = this.get(r.id);
      this.resolve(ev, { action: "dismiss", response: "Session resumed.", source: "system" });
    }
  }

  cancelAllForSession(sessionId: string, reason: string) {
    this.cancelSession(sessionId, null, reason);
  }

  /** Derive the agent's status from what it is still waiting on. */
  recomputeAgentStatus(sessionId: string, fallback?: AgentStatus) {
    const agent = this.agents.findBySession(sessionId);
    if (!agent) return;
    const rows = this.db
      .prepare(`SELECT type FROM events WHERE session_id = ? AND status = 'PENDING'`)
      .all(sessionId) as Array<{ type: string }>;
    const types = new Set(rows.map((r) => r.type));
    let status: AgentStatus | undefined;
    if (types.has("permission.created")) status = "PERMISSION";
    else if (types.has("question.created")) status = "QUESTION";
    else if (types.has("prompt.created")) status = "WAITING";
    else if (agent.status === "PERMISSION" || agent.status === "QUESTION") status = fallback ?? "WORKING";
    else if (fallback && agent.status !== "OFFLINE") status = fallback;
    this.agents.touch(sessionId, status);
  }

  /** Expire pending permissions older than maxAgeMs (optional feature). */
  expirePermissions(maxAgeMs: number) {
    if (maxAgeMs <= 0) return;
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const rows = this.db
      .prepare(`SELECT id FROM events WHERE type = 'permission.created' AND status = 'PENDING' AND created_at < ?`)
      .all(cutoff) as Array<{ id: string }>;
    for (const r of rows) this.finish(this.get(r.id), "CANCELLED", "Permission request expired.");
  }

  deleteEvent(id: string) {
    const ev = this.get(id);
    if (ev.status === "PENDING" || ev.status === "PROCESSING") {
      throw new HubError(409, "EVENT_PENDING", "Cancel the event before deleting it.");
    }
    this.db.prepare(`DELETE FROM responses WHERE event_id = ?`).run(id);
    this.db.prepare(`DELETE FROM events WHERE id = ?`).run(id);
    this.bus.publish({ type: "event.deleted", eventId: id });
  }
}
