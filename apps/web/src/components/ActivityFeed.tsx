import type { Agent, HubEvent } from "@cch/shared/types";
import { clock, EVENT_LABEL } from "../lib/format";

const COLOR: Partial<Record<HubEvent["type"], string>> = {
  "permission.approved": "text-st-green",
  "permission.denied": "text-st-red",
  "question.answered": "text-st-green",
  "task.completed": "text-st-green",
  "task.failed": "text-st-red",
  "task.started": "text-st-blue",
  "prompt.sent": "text-st-yellow",
  "session.stopped": "text-muted",
};

export function eventSummary(ev: HubEvent): string {
  if (ev.type === "permission.created") return String(ev.payload?.summary ?? ev.message ?? "");
  return ev.message ?? "";
}

export function ActivityFeed({ events, agentFor, limit = 25 }: { events: HubEvent[]; agentFor(ev: HubEvent): Agent | undefined; limit?: number }) {
  const rows = events.slice(0, limit);
  if (!rows.length) return <div className="text-sm text-muted">No activity yet.</div>;
  return (
    <ul className="divide-y divide-line text-sm" data-testid="activity-feed">
      {rows.map((ev) => (
        <li key={ev.id} className="flex items-baseline gap-3 py-1.5">
          <span className="w-16 shrink-0 whitespace-nowrap font-mono text-xs text-muted">{clock(ev.createdAt)}</span>
          <span className="w-36 shrink-0 truncate font-medium">{agentFor(ev)?.name ?? ev.sessionId.slice(0, 8)}</span>
          <span className={`w-44 shrink-0 ${COLOR[ev.type] ?? ""}`}>
            {EVENT_LABEL[ev.type]}
            {ev.status === "CANCELLED" && <span className="text-muted"> (cancelled)</span>}
            {ev.response?.source === "policy" && <span className="text-muted"> (policy)</span>}
          </span>
          <span className="min-w-0 truncate text-muted">{eventSummary(ev)}</span>
        </li>
      ))}
    </ul>
  );
}
