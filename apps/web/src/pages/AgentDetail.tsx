import { useEffect, useState } from "react";
import type { Agent, HubEvent } from "@cch/shared/types";
import { ActivityFeed } from "../components/ActivityFeed";
import { StatusBadge } from "../components/AgentCard";
import { RequestCard } from "../components/RequestCard";
import { api } from "../lib/api";
import { clockSec, sortAttention } from "../lib/format";

export function AgentDetail({ id, live, revision, onBack }: { id: string; live: Agent | undefined; revision: number; onBack(): void }) {
  const [data, setData] = useState<{ agent: Agent; events: HubEvent[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    api.agent(id).then(setData, (e) => setError((e as Error).message));
  }, [id, revision]);

  if (error) return <div className="p-6 text-st-red">{error}</div>;
  if (!data) return <div className="p-6 text-muted">Loading…</div>;
  const agent = live ?? data.agent;
  const pending = sortAttention(data.events.filter((e) => e.status === "PENDING"));
  const history = data.events.filter((e) => e.status !== "PENDING");

  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted">{k}</dt>
      <dd className="mt-0.5 break-all font-mono text-sm">{v}</dd>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4" data-testid="agent-detail">
      <button onClick={onBack} className="text-sm text-muted hover:text-fg">
        ← Dashboard
      </button>
      <div className="flex flex-wrap items-center gap-3">
        {renaming ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (name.trim()) await api.renameAgent(agent.id, name.trim());
              setRenaming(false);
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
              className="rounded-md border border-line bg-card-2 px-2 py-1 text-xl font-semibold"
            />
          </form>
        ) : (
          <h1 className="text-2xl font-semibold">{agent.name}</h1>
        )}
        <StatusBadge status={agent.status} />
        {!renaming && (
          <button
            onClick={() => {
              setName(agent.name);
              setRenaming(true);
            }}
            className="text-xs text-muted underline hover:text-fg"
          >
            Rename
          </button>
        )}
        {agent.status === "OFFLINE" && (
          <button
            onClick={async () => {
              if (confirm(`Remove ${agent.name} and its history?`)) {
                await api.removeAgent(agent.id);
                onBack();
              }
            }}
            className="ml-auto text-xs text-st-red underline"
          >
            Remove agent
          </button>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-4 rounded-xl border border-line bg-card p-4 md:grid-cols-4">
        <Row k="Project" v={agent.projectName ?? "—"} />
        <Row k="Directory" v={agent.cwd ?? "—"} />
        <Row k="PID" v={agent.pid ?? "—"} />
        <Row k="Account" v={agent.account ?? "default"} />
        <Row k="Session" v={agent.sessionId} />
        <Row k="Started" v={clockSec(agent.createdAt)} />
        <Row k="Last activity" v={clockSec(agent.lastSeenAt)} />
        <Row k="Current task" v={agent.activity ?? "—"} />
      </dl>
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Current requests — {pending.length}</h2>
        <div className="space-y-3">
          {pending.map((ev) => (
            <RequestCard key={ev.id} event={ev} agent={agent} selected={false} onSelect={() => {}} />
          ))}
          {pending.length === 0 && <div className="text-sm text-muted">Nothing pending.</div>}
        </div>
      </section>
      <section className="rounded-xl border border-line bg-card p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Recent activity</h2>
        <ActivityFeed events={history} agentFor={() => agent} limit={100} />
      </section>
    </div>
  );
}
