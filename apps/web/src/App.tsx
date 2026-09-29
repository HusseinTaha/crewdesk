import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent, HubEvent } from "@cch/shared/types";
import { eventSummary } from "./components/ActivityFeed";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { desktopNotify, playChime, usePrefs } from "./hooks/usePrefs";
import { useHub } from "./hooks/useHub";
import { EVENT_LABEL } from "./lib/format";
import { AgentDetail } from "./pages/AgentDetail";
import { Dashboard } from "./pages/Dashboard";
import { History } from "./pages/History";
import { Policies } from "./pages/Policies";

type Route = { page: "dashboard" } | { page: "agent"; id: string } | { page: "history" } | { page: "policies" };

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  const [a, b] = h.split("/");
  if (a === "agents" && b) return { page: "agent", id: decodeURIComponent(b) };
  if (a === "history") return { page: "history" };
  if (a === "policies") return { page: "policies" };
  return { page: "dashboard" };
}

const ATTENTION_TYPES = new Set(["permission.created", "question.created", "prompt.created", "task.failed", "notification.created"]);

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [prefs, setPrefs] = usePrefs();
  const [search, setSearch] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const onEvent = useCallback((ev: HubEvent, agent: Agent | undefined) => {
    if (!ATTENTION_TYPES.has(ev.type) || ev.status !== "PENDING") return;
    const p = prefsRef.current;
    if (p.sound) playChime(ev.type === "permission.created" || ev.priority === "CRITICAL");
    if (p.desktop && document.visibilityState !== "visible") {
      desktopNotify(`${agent?.name ?? "Claude"} needs your attention`, `${EVENT_LABEL[ev.type]}:\n${eventSummary(ev).slice(0, 200)}`);
    }
  }, []);

  const { state, agentFor } = useHub(onEvent);

  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  useEffect(() => {
    const n = state.pending.length;
    document.title = n ? `(${n}) Claude Control Center` : "Claude Control Center";
  }, [state.pending.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
      if (e.key === "Escape") {
        setShowHelp(false);
        if (typing) t.blur();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "?") setShowHelp((s) => !s);
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (hash: string) => {
    location.hash = hash;
  };
  const openAgent = useCallback((id: string) => go(`/agents/${id}`), []);

  const agents = Object.values(state.agents);
  const active = agents.filter((a) => a.status !== "OFFLINE").length;
  const conn = state.connection;

  const toggleDesktop = async () => {
    if (!prefs.desktop && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return;
    }
    setPrefs({ desktop: !prefs.desktop });
  };

  const nav = (label: string, hash: string, on: boolean) => (
    <a href={`#${hash}`} className={`rounded-md px-2 py-1 text-sm ${on ? "bg-card-2 text-fg" : "text-muted hover:text-fg"}`}>
      {label}
    </a>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-card px-4 py-2.5">
        <a href="#/" className="text-base font-semibold tracking-tight">
          Claude Control Center
        </a>
        <span
          data-testid="connection"
          className={`flex items-center gap-1.5 text-xs ${conn === "connected" ? "text-st-green" : conn === "connecting" ? "text-st-yellow" : "text-st-red"}`}
        >
          <span className={`h-2 w-2 rounded-full ${conn === "connected" ? "bg-st-green" : conn === "connecting" ? "bg-st-yellow" : "bg-st-red"}`} />
          {conn === "connected" ? "Connected" : conn === "connecting" ? "Connecting…" : "Disconnected"}
        </span>
        <span className="text-sm text-muted" data-testid="agent-count">
          {active} Agent{active === 1 ? "" : "s"}
        </span>
        <span className={`text-sm font-semibold ${state.pending.length ? "text-st-orange" : "text-muted"}`} data-testid="attention-count">
          {state.pending.length} Need Attention
        </span>
        <nav className="flex gap-1">
          {nav("Dashboard", "/", route.page === "dashboard")}
          {nav("History", "/history", route.page === "history")}
          {nav("Policies", "/policies", route.page === "policies")}
        </nav>
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search events…  /"
          aria-label="Search events"
          className="ml-auto w-56 rounded-md border border-line bg-card-2 px-2 py-1 text-sm placeholder:text-muted focus:border-st-blue focus:outline-none"
        />
        <div className="flex items-center gap-1 text-sm">
          <button
            title="Sound"
            aria-pressed={prefs.sound}
            onClick={() => setPrefs({ sound: !prefs.sound })}
            className={`rounded-md px-2 py-1 ${prefs.sound ? "text-fg" : "text-muted line-through"}`}
          >
            Sound
          </button>
          <button
            title="Desktop notifications"
            aria-pressed={prefs.desktop}
            onClick={toggleDesktop}
            className={`rounded-md px-2 py-1 ${prefs.desktop ? "text-fg" : "text-muted line-through"}`}
          >
            Notify
          </button>
          <button title="Toggle theme" onClick={() => setPrefs({ theme: prefs.theme === "dark" ? "light" : "dark" })} className="rounded-md px-2 py-1 text-muted hover:text-fg">
            {prefs.theme === "dark" ? "☾" : "☀"}
          </button>
          <button title="Keyboard shortcuts (?)" onClick={() => setShowHelp(true)} className="rounded-md px-2 py-1 text-muted hover:text-fg">
            ?
          </button>
        </div>
      </header>

      {route.page === "dashboard" && (
        <Dashboard
          state={state}
          agentFor={agentFor}
          search={search}
          groupByProject={prefs.groupByProject}
          onToggleGroup={() => setPrefs({ groupByProject: !prefs.groupByProject })}
          onOpenAgent={openAgent}
        />
      )}
      {route.page === "agent" && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AgentDetail id={route.id} live={state.agents[route.id]} revision={state.revision} onBack={() => go("/")} />
        </div>
      )}
      {route.page === "history" && <History agents={agents} search={search} revision={state.revision} onOpenAgent={openAgent} />}
      {route.page === "policies" && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Policies />
        </div>
      )}
      {showHelp && <ShortcutsDialog onClose={() => setShowHelp(false)} />}
    </div>
  );
}
