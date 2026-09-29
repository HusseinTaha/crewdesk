import type { HubConfig } from "./config.js";
import { openDatabase, type Db } from "./db/database.js";
import type { Logger } from "./logger.js";
import { AgentService } from "./services/agent.service.js";
import { EventBus } from "./services/bus.js";
import { EventService } from "./services/event.service.js";
import { PolicyService } from "./services/policy.service.js";
import { RoutingService } from "./services/routing.service.js";
import { isPidAlive } from "./util/process.js";

/** The hub's domain core: database + services + liveness sweeper, independent of HTTP. */
export class Hub {
  readonly db: Db;
  readonly bus = new EventBus();
  readonly agents: AgentService;
  readonly events: EventService;
  readonly policies: PolicyService;
  readonly routing: RoutingService;
  readonly startedAt = Date.now();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    readonly config: HubConfig,
    readonly log: Logger,
  ) {
    this.db = openDatabase(config.database);
    this.agents = new AgentService(this.db, this.bus, log);
    this.policies = new PolicyService(config.policyFile, log);
    this.events = new EventService(this.db, this.bus, this.agents, this.policies, log);
    this.routing = new RoutingService(this.events, log, config.waiterGraceMs);
  }

  start(sweepIntervalMs = 5000) {
    // Hooks that were waiting when the hub stopped get time to reconnect before being written off.
    this.routing.armRecovered(this.events.pending(), Math.max(this.config.waiterGraceMs, 30000));
    this.sweeper = setInterval(() => this.sweep(), sweepIntervalMs);
    this.sweeper.unref?.();
  }

  /** Mark dead sessions OFFLINE and expire stale permissions. */
  sweep() {
    const nowMs = Date.now();
    for (const agent of this.agents.list()) {
      if (agent.status === "OFFLINE") continue;
      let offline = false;
      if (agent.pid) {
        offline = !isPidAlive(agent.pid);
      } else if (!this.routing.sessionHasWaiters(agent.sessionId)) {
        const idleMs = nowMs - Date.parse(agent.lastSeenAt);
        // Working sessions may run long tools without firing hooks; give them more room.
        const limit = agent.status === "WORKING" ? this.config.heartbeatTimeout * 10 : this.config.heartbeatTimeout;
        offline = idleMs > limit;
      }
      if (offline) {
        this.log.info("Agent offline", { sessionId: agent.sessionId });
        this.events.cancelAllForSession(agent.sessionId, "Session went offline.");
        this.agents.touch(agent.sessionId, "OFFLINE");
      }
    }
    this.events.expirePermissions(this.config.permissionExpiryMs);
  }

  close() {
    if (this.sweeper) clearInterval(this.sweeper);
    this.routing.close();
    this.db.close();
  }
}
