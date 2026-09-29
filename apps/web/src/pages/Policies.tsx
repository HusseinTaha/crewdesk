import { useEffect, useState } from "react";
import type { PolicyRule } from "@crewdesk/shared";
import { api } from "../lib/api";

export function Policies() {
  const [data, setData] = useState<{ file: string; rules: PolicyRule[]; error: string | null } | null>(null);
  const load = () => api.policies().then(setData, () => {});
  useEffect(() => {
    void load();
  }, []);
  const color = { allow: "text-st-green", deny: "text-st-red", ask: "text-st-yellow" } as const;
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4" data-testid="policies">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Permission policies</h1>
        <button onClick={load} className="rounded-md border border-line px-2 py-1 text-xs">
          Reload
        </button>
      </div>
      <p className="text-sm text-muted">
        Rules are read from <span className="font-mono text-fg">{data?.file}</span>. First matching rule wins. Destructive or chained shell commands
        (<span className="font-mono">&amp;&amp;</span>, <span className="font-mono">;</span>, <span className="font-mono">|</span>…) are never auto-allowed; they
        always reach you. Edit the file and press Reload.
      </p>
      {data?.error && <div className="rounded-md bg-st-red/10 p-3 text-sm text-st-red">Policy file is invalid: {data.error}</div>}
      <div className="overflow-hidden rounded-xl border border-line bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-card-2 text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Tool</th>
              <th className="px-3 py-2">Match</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data?.rules.map((r, i) => (
              <tr key={i}>
                <td className="px-3 py-1.5 text-muted">{i + 1}</td>
                <td className="px-3 py-1.5 font-mono">{r.tool ?? "*"}</td>
                <td className="px-3 py-1.5 font-mono">{r.match}</td>
                <td className={`px-3 py-1.5 font-semibold uppercase ${color[r.action]}`}>{r.action}</td>
                <td className="px-3 py-1.5 text-muted">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.rules.length === 0 && <div className="p-4 text-sm text-muted">No rules — every permission request comes to the dashboard.</div>}
      </div>
      <pre className="rounded-xl border border-line bg-card-2 p-3 font-mono text-xs text-muted">{`permissions:
  - tool: "Bash"
    match: "git status"
    action: allow
  - match: "npm install *"
    action: allow
  - match: "curl *"
    action: deny
    reason: "No network from agents"`}</pre>
    </div>
  );
}
