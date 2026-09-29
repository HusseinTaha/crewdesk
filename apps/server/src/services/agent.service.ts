import path from "node:path";
import { ulid } from "ulid";
import type { Agent, AgentStatus, RegisterAgentInput, UpdateAgentInput } from "@crewdesk/shared";
import type { Db } from "../db/database.js";
import type { EventBus } from "./bus.js";
import { notFound } from "./errors.js";
import type { Logger } from "../logger.js";

interface AgentRow {
  id: string;
  session_id: string;
  name: string;
  project_name: string | null;
  cwd: string | null;
  pid: number | null;
  account: string | null;
  status: string;
  activity: string | null;
  created_at: string;
  last_seen_at: string;
  pending_count?: number;
}

const PENDING_SQL = `(SELECT COUNT(*) FROM events e WHERE e.session_id = a.session_id AND e.status IN ('PENDING','PROCESSING'))`;

function toAgent(r: AgentRow): Agent {
  return {
    id: r.id,
    sessionId: r.session_id,
    name: r.name,
    projectName: r.project_name,
    cwd: r.cwd,
    pid: r.pid,
    account: r.account,
    status: r.status as AgentStatus,
    activity: r.activity,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    pendingCount: r.pending_count ?? 0,
  };
}

export const now = () => new Date().toISOString();

export class AgentService {
  constructor(
    private db: Db,
    private bus: EventBus,
    private log: Logger,
  ) {}

  list(): Agent[] {
    const rows = this.db
      .prepare(`SELECT a.*, ${PENDING_SQL} AS pending_count FROM agents a ORDER BY a.created_at`)
      .all() as unknown as AgentRow[];
    return rows.map(toAgent);
  }

  get(id: string): Agent {
    const row = this.db
      .prepare(`SELECT a.*, ${PENDING_SQL} AS pending_count FROM agents a WHERE a.id = ?`)
      .get(id) as unknown as AgentRow | undefined;
    if (!row) throw notFound("AGENT_NOT_FOUND", "Agent was not found.");
    return toAgent(row);
  }

  findBySession(sessionId: string): Agent | null {
    const row = this.db
      .prepare(`SELECT a.*, ${PENDING_SQL} AS pending_count FROM agents a WHERE a.session_id = ?`)
      .get(sessionId) as unknown as AgentRow | undefined;
    return row ? toAgent(row) : null;
  }

  getBySession(sessionId: string): Agent {
    const agent = this.findBySession(sessionId);
    if (!agent) throw notFound("SESSION_NOT_FOUND", "Session is not registered.");
    return agent;
  }

  /** Pick "<project> #N" with the smallest N not used by another online agent of that project. */
  private defaultName(project: string): string {
    const rows = this.db
      .prepare(`SELECT name FROM agents WHERE project_name = ? AND status != 'OFFLINE'`)
      .all(project) as Array<{ name: string }>;
    const taken = new Set(rows.map((r) => r.name));
    for (let n = 1; ; n++) {
      const candidate = `${project} #${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  /**
   * Register (or re-register) a session. Idempotent per session id: a reconnecting session keeps its
   * agent id and name, fills in missing metadata and comes back from OFFLINE.
   */
  register(input: RegisterAgentInput, initialStatus: AgentStatus = "STARTING"): { agent: Agent; created: boolean } {
    const existing = this.findBySession(input.sessionId);
    const ts = now();
    if (existing) {
      const status = existing.status === "OFFLINE" || initialStatus !== "STARTING" ? initialStatus : existing.status;
      this.db
        .prepare(
          `UPDATE agents SET
             name = COALESCE(?, name),
             project_name = COALESCE(?, project_name),
             cwd = COALESCE(?, cwd),
             pid = COALESCE(?, pid),
             account = COALESCE(?, account),
             status = ?,
             last_seen_at = ?
           WHERE session_id = ?`,
        )
        .run(
          input.name ?? null,
          input.project ?? null,
          input.cwd ?? null,
          input.pid ?? null,
          input.account ?? null,
          status,
          ts,
          input.sessionId,
        );
      const agent = this.getBySession(input.sessionId);
      if (existing.status === "OFFLINE") this.log.info("Agent reconnected", { sessionId: input.sessionId });
      this.bus.publish({ type: "agent.updated", agent });
      return { agent, created: false };
    }

    const project = input.project ?? (input.cwd ? path.basename(input.cwd) : "unknown");
    const agent: Agent = {
      id: `agent_${ulid()}`,
      sessionId: input.sessionId,
      name: input.name ?? this.defaultName(project),
      projectName: project,
      cwd: input.cwd ?? null,
      pid: input.pid ?? null,
      account: input.account ?? null,
      status: initialStatus,
      activity: null,
      createdAt: ts,
      lastSeenAt: ts,
      pendingCount: 0,
    };
    this.db
      .prepare(
        `INSERT INTO agents (id, session_id, name, project_name, cwd, pid, account, status, activity, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        agent.id,
        agent.sessionId,
        agent.name,
        agent.projectName,
        agent.cwd,
        agent.pid,
        agent.account,
        agent.status,
        null,
        ts,
        ts,
      );
    this.log.info("Agent registered", { sessionId: agent.sessionId, name: agent.name });
    this.bus.publish({ type: "agent.created", agent });
    return { agent, created: true };
  }

  update(id: string, patch: UpdateAgentInput): Agent {
    const current = this.get(id);
    this.db
      .prepare(`UPDATE agents SET name = ?, status = ?, activity = ? WHERE id = ?`)
      .run(
        patch.name ?? current.name,
        patch.status ?? current.status,
        patch.activity === undefined ? current.activity : patch.activity,
        id,
      );
    const agent = this.get(id);
    this.bus.publish({ type: "agent.updated", agent });
    return agent;
  }

  /** Record activity from a session: bumps last_seen_at and optionally changes status/activity. */
  touch(sessionId: string, status?: AgentStatus, activity?: string | null): Agent | null {
    const current = this.findBySession(sessionId);
    if (!current) return null;
    this.db
      .prepare(`UPDATE agents SET last_seen_at = ?, status = ?, activity = ? WHERE session_id = ?`)
      .run(
        now(),
        status ?? current.status,
        activity === undefined ? current.activity : activity,
        sessionId,
      );
    const agent = this.getBySession(sessionId);
    this.bus.publish({ type: "agent.updated", agent });
    return agent;
  }

  /** Re-broadcast an agent (e.g. after its pending count changed). */
  refresh(sessionId: string) {
    const agent = this.findBySession(sessionId);
    if (agent) this.bus.publish({ type: "agent.updated", agent });
  }

  remove(id: string) {
    const agent = this.get(id);
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`DELETE FROM responses WHERE session_id = ?`).run(agent.sessionId);
      this.db.prepare(`DELETE FROM events WHERE session_id = ?`).run(agent.sessionId);
      this.db.prepare(`DELETE FROM agents WHERE id = ?`).run(id);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    this.bus.publish({ type: "agent.removed", agentId: id });
  }
}
