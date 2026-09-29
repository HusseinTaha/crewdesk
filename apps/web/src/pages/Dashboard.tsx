import { useEffect, useMemo, useRef, useState } from "react";
import type { Agent, AgentStatus, HubEvent } from "@crewdesk/shared/types";
import { ActivityFeed, eventSummary } from "../components/ActivityFeed";
import { AgentCard } from "../components/AgentCard";
import { RequestCard, type RequestCardHandle } from "../components/RequestCard";
import type { HubState } from "../hooks/useHub";
import { sortAttention } from "../lib/format";

export const STATUS_FILTERS: Array<{ key: string; label: string; match(a: Agent, pending: HubEvent[]): boolean }> = [
  { key: "all", label: "All", match: () => true },
  { key: "working", label: "Working", match: (a) => a.status === "WORKING" || a.status === "STARTING" },
  { key: "waiting", label: "Waiting", match: (a) => a.status === "WAITING" },
  { key: "questions", label: "Questions", match: (a) => a.status === "QUESTION" },
  { key: "permissions", label: "Permissions", match: (a) => a.status === "PERMISSION" },
  { key: "errors", label: "Errors", match: (a) => a.status === "ERROR" },
  { key: "completed", label: "Completed", match: (a) => a.status === "COMPLETED" },
];

const EVENT_FILTER: Record<string, (e: HubEvent) => boolean> = {
  questions: (e) => e.type === "question.created",
  permissions: (e) => e.type === "permission.created",
  errors: (e) => e.type === "task.failed",
  waiting: (e) => e.type === "prompt.created",
};

interface Props {
  state: HubState;
  agentFor(ev: HubEvent): Agent | undefined;
  search: string;
  groupByProject: boolean;
  onOpenAgent(id: string): void;
  onToggleGroup(): void;
}

export function Dashboard({ state, agentFor, search, groupByProject, onOpenAgent, onToggleGroup }: Props) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [project, setProject] = useState("");
  const [agentId, setAgentId] = useState("");
  const [showOffline, setShowOffline] = useState(false);
  const [selected, setSelected] = useState(0);
  const [now, setNow] = useState(Date.now());
  const cardRefs = useRef(new Map<string, RequestCardHandle>());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const agents = Object.values(state.agents);
  const projects = [...new Set(agents.map((a) => a.projectName ?? "unknown"))].sort();
  const q = search.trim().toLowerCase();

  const matchesAgent = (a: Agent | undefined) =>
    (!project || a?.projectName === project) && (!agentId || a?.id === agentId);

  const visibleAgents = agents
    .filter((a) => showOffline || a.status !== "OFFLINE" || a.pendingCount > 0)
    .filter((a) => STATUS_FILTERS.find((f) => f.key === statusFilter)!.match(a, state.pending))
    .filter((a) => matchesAgent(a))
    .filter((a) => !q || [a.name, a.projectName, a.cwd, a.account].some((v) => v?.toLowerCase().includes(q)));

  const attention = useMemo(() => {
    const byType = EVENT_FILTER[statusFilter];
    return sortAttention(
      state.pending.filter((e) => {
        const a = agentFor(e);
        if (!matchesAgent(a)) return false;
        if (byType && !byType(e)) return false;
        if (!q) return true;
        const hay = [a?.name, a?.projectName, e.type, e.message, eventSummary(e), JSON.stringify(e.payload ?? {})].join(" ").toLowerCase();
        return hay.includes(q);
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pending, state.agents, statusFilter, project, agentId, q]);

  const recent = state.recent.filter((e) => {
    if (e.status === "PENDING") return false;
    const a = agentFor(e);
    if (!matchesAgent(a)) return false;
    return !q || [a?.name, a?.projectName, e.type, e.message].join(" ").toLowerCase().includes(q);
  });

  useEffect(() => {
    if (selected >= attention.length) setSelected(Math.max(0, attention.length - 1));
  }, [attention.length, selected]);

  // Keyboard shortcuts for the attention queue.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || e.ctrlKey || e.metaKey || e.altKey) return;
      const current = attention[selected];
      const handle = current ? cardRefs.current.get(current.id) : undefined;
      switch (e.key.toLowerCase()) {
        case "j":
          setSelected((s) => Math.min(attention.length - 1, s + 1));
          break;
        case "k":
          setSelected((s) => Math.max(0, s - 1));
          break;
        case "a":
          handle?.allow();
          break;
        case "d":
          handle?.deny();
          break;
        case "r":
          e.preventDefault();
          handle?.focusResponse();
          break;
        case "enter": {
          const a = current && agentFor(current);
          if (a) onOpenAgent(a.id);
          break;
        }
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attention, selected, agentFor, onOpenAgent]);

  useEffect(() => {
    const current = attention[selected];
    if (current) document.querySelector(`[data-event-id="${current.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected, attention]);

  const grouped = groupByProject
    ? Object.entries(
        visibleAgents.reduce<Record<string, Agent[]>>((acc, a) => {
          (acc[a.projectName ?? "unknown"] ??= []).push(a);
          return acc;
        }, {}),
      ).sort(([x], [y]) => x.localeCompare(y))
    : [["", visibleAgents] as [string, Agent[]]];

  const select = "rounded-md border border-line bg-card-2 px-2 py-1 text-sm";

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-y-auto p-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:content-stretch lg:overflow-hidden">
      <aside className="flex min-w-0 flex-col gap-3 lg:min-h-0">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Agents · {visibleAgents.length}</h2>
          <label className="flex items-center gap-1 text-xs text-muted">
            <input type="checkbox" checked={groupByProject} onChange={onToggleGroup} /> Group
          </label>
        </div>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Status filter">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={statusFilter === f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`rounded-full px-2.5 py-0.5 text-xs ${statusFilter === f.key ? "bg-st-blue text-white" : "bg-card-2 text-muted hover:text-fg"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <select aria-label="Project" className={`${select} min-w-0 flex-1`} value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select aria-label="Agent" className={`${select} min-w-0 flex-1`} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">All Agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2 pr-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {grouped.map(([group, list]) => (
            <div key={group || "all"} className="space-y-2">
              {group && <div className="pt-2 text-xs font-semibold uppercase tracking-wider text-muted">Project: {group}</div>}
              {list.map((a) => (
                <AgentCard key={a.id} agent={a} now={now} onOpen={() => onOpenAgent(a.id)} />
              ))}
            </div>
          ))}
          {visibleAgents.length === 0 && (
            <div className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
              {agents.length === 0 ? "Waiting for Claude Code sessions… Start `claude` in any project with hooks configured." : "No agents match the filters."}
            </div>
          )}
        </div>
        <label className="flex items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={showOffline} onChange={(e) => setShowOffline(e.target.checked)} /> Show offline agents
        </label>
      </aside>

      <main className="flex min-w-0 flex-col gap-4 lg:min-h-0">
        <section className="flex flex-col lg:min-h-0 lg:flex-1">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted" data-testid="attention-heading">
            Needs attention — {attention.length}
          </h2>
          <div className="space-y-3 overflow-x-hidden pr-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto" data-testid="attention-queue">
            {attention.map((ev, i) => (
              <RequestCard
                key={ev.id}
                ref={(h) => {
                  if (h) cardRefs.current.set(ev.id, h);
                  else cardRefs.current.delete(ev.id);
                }}
                event={ev}
                agent={agentFor(ev)}
                selected={i === selected}
                onSelect={() => setSelected(i)}
              />
            ))}
            {attention.length === 0 && (
              <div className="rounded-xl border border-dashed border-line p-8 text-center text-muted">All clear — nothing needs you right now.</div>
            )}
          </div>
        </section>
        <section className="max-h-72 shrink-0 overflow-y-auto rounded-xl border border-line bg-card p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Recent activity</h2>
          <ActivityFeed events={recent} agentFor={agentFor} />
        </section>
      </main>
    </div>
  );
}

export type { AgentStatus };
