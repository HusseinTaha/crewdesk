import type { WsMessage } from "@crewdesk/shared";

type Listener = (msg: WsMessage) => void;

/** In-process pub/sub used to fan domain changes out to WebSocket clients. */
export class EventBus {
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  publish(msg: WsMessage) {
    for (const fn of this.listeners) {
      try {
        fn(msg);
      } catch {
        /* a broken client must not break the hub */
      }
    }
  }

  get size() {
    return this.listeners.size;
  }
}
