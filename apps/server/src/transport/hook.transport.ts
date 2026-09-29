import type { HubResponse, WaitResult } from "@crewdesk/shared";
import type { SessionTransport, Waiter } from "./transport.js";

/**
 * Hook long-poll transport. A `crewdesk-hook` process blocks inside a Claude Code hook and polls
 * `GET /api/events/:id/wait`; each open poll is a Waiter. Delivering a response settles the waiters
 * for that event, and the hook prints the decision in the format Claude Code expects.
 */
export class HookTransport implements SessionTransport {
  readonly name = "hook";
  private waiters = new Map<string, Set<Waiter>>();
  private idleTimers = new Map<string, NodeJS.Timeout>();

  /**
   * @param onAbandoned called when every waiter for an event has gone away and none came back within the
   *   grace period, i.e. the hook exited: Claude Code resolved the request some other way.
   */
  constructor(
    private graceMs: number,
    private onAbandoned: (eventId: string) => void,
  ) {}

  /** Register a waiter; returns a disposer that removes it (on timeout or client disconnect). */
  addWaiter(eventId: string, waiter: Waiter): () => void {
    this.clearIdleTimer(eventId);
    let set = this.waiters.get(eventId);
    if (!set) this.waiters.set(eventId, (set = new Set()));
    set.add(waiter);
    return () => {
      const current = this.waiters.get(eventId);
      if (!current?.delete(waiter)) return;
      if (current.size === 0) {
        this.waiters.delete(eventId);
        this.armIdleTimer(eventId);
      }
    };
  }

  /** Start the abandonment clock for an event that has no waiters (used after restart too). */
  armIdleTimer(eventId: string, graceMs = this.graceMs) {
    this.clearIdleTimer(eventId);
    const t = setTimeout(() => {
      this.idleTimers.delete(eventId);
      if (!this.waiters.has(eventId)) this.onAbandoned(eventId);
    }, graceMs);
    t.unref?.();
    this.idleTimers.set(eventId, t);
  }

  clearIdleTimer(eventId: string) {
    const t = this.idleTimers.get(eventId);
    if (t) clearTimeout(t);
    this.idleTimers.delete(eventId);
  }

  private settle(eventId: string, result: WaitResult): boolean {
    const set = this.waiters.get(eventId);
    this.waiters.delete(eventId);
    this.clearIdleTimer(eventId);
    if (!set || set.size === 0) return false;
    for (const w of set) w.settle(result);
    return true;
  }

  async sendResponse(sessionId: string, response: HubResponse): Promise<boolean> {
    const set = this.waiters.get(response.eventId);
    if (!set) return false;
    // Never hand a response to a waiter belonging to a different session.
    for (const w of set) if (w.sessionId !== sessionId) set.delete(w);
    return this.settle(response.eventId, { state: "resolved", response });
  }

  cancel(_sessionId: string, eventId: string, reason: string) {
    this.settle(eventId, { state: "cancelled", reason });
  }

  isWaiting(eventId: string) {
    return (this.waiters.get(eventId)?.size ?? 0) > 0;
  }

  sessionHasWaiters(sessionId: string) {
    for (const set of this.waiters.values()) for (const w of set) if (w.sessionId === sessionId) return true;
    return false;
  }

  close() {
    for (const t of this.idleTimers.values()) clearTimeout(t);
    this.idleTimers.clear();
    for (const [eventId] of this.waiters) this.settle(eventId, { state: "pending" });
  }
}
