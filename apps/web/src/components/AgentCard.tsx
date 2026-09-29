import type { Agent } from "@crewdesk/shared/types";
import { STATUS_STYLE, timeAgo } from "../lib/format";

export function StatusBadge({ status }: { status: Agent["status"] }) {
  const s = STATUS_STYLE[status];
  const live = status === "WORKING" || status === "QUESTION" || status === "PERMISSION";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${s.text}`} data-testid="agent-status">
      <span className={`h-2 w-2 rounded-full ${s.dot} ${live ? "pulse-dot" : ""}`} />
      {status}
    </span>
  );
}

export function AgentCard({ agent, onOpen, now }: { agent: Agent; onOpen(): void; now: number }) {
  const needs = agent.pendingCount > 0;
  return (
    <button
      onClick={onOpen}
      data-testid="agent-card"
      data-session={agent.sessionId}
      className={`w-full rounded-xl border bg-card p-3 text-left transition hover:border-st-blue/60 ${
        needs ? "border-st-orange/60" : "border-line"
      } ${agent.status === "OFFLINE" ? "opacity-60" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-semibold" data-testid="agent-name">
          {agent.name}
        </span>
        <StatusBadge status={agent.status} />
      </div>
      <div className="mt-1 truncate text-sm text-muted">
        {agent.projectName}
        {agent.account ? ` · ${agent.account}` : ""}
      </div>
      {agent.activity && agent.status === "WORKING" && <div className="mt-1 truncate text-xs text-muted">↳ {agent.activity}</div>}
      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>Last activity: {timeAgo(agent.lastSeenAt, now)}</span>
        {needs && (
          <span className="rounded bg-st-orange/15 px-1.5 py-0.5 font-semibold text-st-orange">
            {agent.pendingCount} pending
          </span>
        )}
      </div>
    </button>
  );
}
