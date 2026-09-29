import type { Agent, HubEvent, PolicyRule, RespondInput } from "@crewdesk/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? "ERROR", json?.error?.message ?? res.statusText);
  return json as T;
}

export interface Settings {
  notifications: boolean;
  sound: boolean;
  idlePrompts: boolean;
  heartbeatTimeout: number;
  version: string;
}

export const api = {
  agents: () => call<{ agents: Agent[] }>("GET", "/api/agents").then((r) => r.agents),
  agent: (id: string) => call<{ agent: Agent; events: HubEvent[] }>("GET", `/api/agents/${id}`),
  renameAgent: (id: string, name: string) => call<{ agent: Agent }>("PATCH", `/api/agents/${id}`, { name }),
  removeAgent: (id: string) => call("DELETE", `/api/agents/${id}`),
  pending: () => call<{ events: HubEvent[] }>("GET", "/api/events/pending").then((r) => r.events),
  events: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    return call<{ events: HubEvent[] }>("GET", `/api/events?${qs}`).then((r) => r.events);
  },
  respond: (id: string, body: RespondInput) =>
    call<{ event: HubEvent }>("POST", `/api/events/${id}/respond`, { source: "dashboard", ...body }).then((r) => r.event),
  cancel: (id: string, reason?: string) => call<{ event: HubEvent }>("POST", `/api/events/${id}/cancel`, { reason }),
  policies: () => call<{ file: string; rules: PolicyRule[]; error: string | null }>("GET", "/api/policies"),
  settings: () => call<Settings>("GET", "/api/settings"),
};
