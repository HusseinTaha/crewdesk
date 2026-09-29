import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Agent, HubEvent, WsMessage } from "@cch/shared/types";
import { api } from "../lib/api";

export interface HubState {
  agents: Record<string, Agent>;
  pending: HubEvent[];
  recent: HubEvent[];
  connection: "connecting" | "connected" | "disconnected";
  /** Bumped whenever any event changes, so detail views can refetch. */
  revision: number;
}

type Action =
  | { type: "ws"; msg: WsMessage }
  | { type: "recent"; events: HubEvent[] }
  | { type: "connection"; value: HubState["connection"] };

const RECENT_LIMIT = 100;
const isOpen = (e: HubEvent) => e.status === "PENDING" || e.status === "PROCESSING";

function upsert(list: HubEvent[], ev: HubEvent): HubEvent[] {
  const i = list.findIndex((e) => e.id === ev.id);
  if (i === -1) return [ev, ...list];
  const copy = list.slice();
  copy[i] = ev;
  return copy;
}

function reducer(state: HubState, action: Action): HubState {
  switch (action.type) {
    case "connection":
      return { ...state, connection: action.value };
    case "recent":
      return { ...state, recent: action.events.slice(0, RECENT_LIMIT) };
    case "ws": {
      const msg = action.msg;
      switch (msg.type) {
        case "hello":
          return {
            ...state,
            agents: Object.fromEntries(msg.agents.map((a) => [a.id, a])),
            pending: msg.pending.filter((e) => e.status === "PENDING"),
            revision: state.revision + 1,
          };
        case "agent.created":
        case "agent.updated":
          return { ...state, agents: { ...state.agents, [msg.agent.id]: msg.agent } };
        case "agent.removed": {
          const { [msg.agentId]: _removed, ...rest } = state.agents;
          return { ...state, agents: rest, pending: state.pending.filter((e) => e.agentId !== msg.agentId) };
        }
        case "event.created":
        case "event.updated":
        case "event.resolved": {
          const ev = msg.event;
          // The attention queue shows only what still needs a human (PENDING); PROCESSING = decided.
          const pending = ev.status === "PENDING" ? upsert(state.pending, ev) : state.pending.filter((e) => e.id !== ev.id);
          const recent = upsert(state.recent, ev)
            .sort((a, b) => b.id.localeCompare(a.id))
            .slice(0, RECENT_LIMIT);
          return { ...state, pending, recent, revision: state.revision + 1 };
        }
        case "event.deleted":
          return {
            ...state,
            pending: state.pending.filter((e) => e.id !== msg.eventId),
            recent: state.recent.filter((e) => e.id !== msg.eventId),
            revision: state.revision + 1,
          };
      }
    }
  }
  return state;
}

export function useHub(onEvent?: (ev: HubEvent, agent: Agent | undefined) => void) {
  const [state, dispatch] = useReducer(reducer, {
    agents: {},
    pending: [],
    recent: [],
    connection: "connecting",
    revision: 0,
  });
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const agentsRef = useRef(state.agents);
  agentsRef.current = state.agents;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      dispatch({ type: "connection", value: "connecting" });
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        retry = 0;
        dispatch({ type: "connection", value: "connected" });
        api.events({ limit: RECENT_LIMIT }).then((events) => dispatch({ type: "recent", events }), () => {});
      };
      ws.onmessage = (m) => {
        let msg: WsMessage;
        try {
          msg = JSON.parse(String(m.data));
        } catch {
          return;
        }
        dispatch({ type: "ws", msg });
        if (msg.type === "event.created" && isOpen(msg.event)) {
          const agent = Object.values(agentsRef.current).find((a) => a.sessionId === msg.event.sessionId);
          onEventRef.current?.(msg.event, agent);
        }
      };
      ws.onclose = () => {
        dispatch({ type: "connection", value: "disconnected" });
        if (stopped) return;
        timer = setTimeout(connect, Math.min(10000, 500 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, []);

  const agentFor = useCallback((ev: HubEvent) => Object.values(state.agents).find((a) => a.sessionId === ev.sessionId), [state.agents]);

  return { state, agentFor };
}
