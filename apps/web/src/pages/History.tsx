import { useEffect, useState } from "react";
import { EVENT_STATUSES, type Agent, type HubEvent } from "@crewdesk/shared/types";
import { eventSummary } from "../components/ActivityFeed";
import { api } from "../lib/api";
import { dateTime, EVENT_LABEL } from "../lib/format";

const TYPE_GROUPS = ["", "permission", "question", "prompt", "notification", "task", "session"];

// Secondary columns drop out on narrow screens so the table always fits without horizontal scroll.
const SM = "hidden sm:table-cell";
const MD = "hidden md:table-cell";
const COLUMNS: Array<[string, string]> = [
  ["ID", MD],
  ["Agent", ""],
  ["Project", MD],
  ["Type", ""],
  ["Status", SM],
  ["Detail", ""],
  ["Response", MD],
  ["Created", SM],
  ["Resolved", MD],
];

export function History({ agents, search, revision, onOpenAgent }: { agents: Agent[]; search: string; revision: number; onOpenAgent(id: string): void }) {
  const [events, setEvents] = useState<HubEvent[]>([]);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [agent, setAgent] = useState("");
  const [project, setProject] = useState("");
  const [limit, setLimit] = useState(200);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .events({ type, status, agent, project, q: search.trim() || undefined, limit })
        .then(setEvents)
        .catch(() => setEvents([]));
    }, 150);
    return () => clearTimeout(t);
  }, [type, status, agent, project, search, limit, revision]);

  const byId = Object.fromEntries(agents.map((a) => [a.sessionId, a]));
  const projects = [...new Set(agents.map((a) => a.projectName ?? "unknown"))].sort();
  const sel = "rounded-md border border-line bg-card-2 px-2 py-1 text-sm";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4" data-testid="history">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold">Event history</h1>
        <select aria-label="Type" className={sel} value={type} onChange={(e) => setType(e.target.value)}>
          {TYPE_GROUPS.map((t) => (
            <option key={t} value={t}>
              {t ? t[0]!.toUpperCase() + t.slice(1) : "All types"}
            </option>
          ))}
        </select>
        <select aria-label="Status" className={sel} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {EVENT_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select aria-label="Project" className={sel} value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">All Projects</option>
          {projects.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select aria-label="Agent" className={sel} value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">All Agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-muted">{events.length} events</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl border border-line bg-card">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-card-2 text-xs uppercase tracking-wider text-muted">
            <tr>
              {COLUMNS.map(([h, hide]) => (
                <th key={h} className={`whitespace-nowrap px-3 py-2 font-semibold ${hide}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {events.map((ev) => {
              const a = byId[ev.sessionId];
              return (
                <tr key={ev.id} className="hover:bg-card-2">
                  <td className={`whitespace-nowrap px-3 py-1.5 font-mono text-xs text-muted ${MD}`} title={ev.id}>
                    {ev.id.slice(-8)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {a ? (
                      <button className="hover:underline" onClick={() => onOpenAgent(a.id)}>
                        {a.name}
                      </button>
                    ) : (
                      ev.sessionId.slice(0, 8)
                    )}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-1.5 text-muted ${MD}`}>{a?.projectName}</td>
                  <td className="px-3 py-1.5 [overflow-wrap:normal]">{EVENT_LABEL[ev.type]}</td>
                  <td className={`whitespace-nowrap px-3 py-1.5 text-xs ${SM}`}>{ev.status}</td>
                  <td className="min-w-32 px-3 py-1.5 text-muted" title={eventSummary(ev)}>
                    <div className="line-clamp-2">{eventSummary(ev)}</div>
                  </td>
                  <td className={`px-3 py-1.5 text-muted ${MD}`}>
                    <div className="line-clamp-2">{ev.response ? `${ev.response.action}${ev.response.response ? `: ${ev.response.response}` : ""} (${ev.response.source})` : String(ev.payload?.closeReason ?? "")}</div>
                  </td>
                  <td className={`whitespace-nowrap px-3 py-1.5 text-xs text-muted ${SM}`}>{dateTime(ev.createdAt)}</td>
                  <td className={`whitespace-nowrap px-3 py-1.5 text-xs text-muted ${MD}`}>{dateTime(ev.resolvedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {events.length >= limit && (
          <button onClick={() => setLimit((l) => l + 200)} className="w-full py-2 text-sm text-muted hover:text-fg">
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
