import type { HubEvent, WaitResult } from "@cch/shared";
import type { Logger } from "../logger.js";
import { HookTransport } from "../transport/hook.transport.js";
import type { SessionTransport } from "../transport/transport.js";
import { forbidden } from "./errors.js";
import type { EventService } from "./event.service.js";

/**
 * Routes decisions: event id -> session id -> session transport. Routing never uses agent name,
 * project or terminal; the event's stored session id is authoritative.
 */
export class RoutingService {
  readonly hook: HookTransport;
  private transports: SessionTransport[];

  constructor(
    private events: EventService,
    private log: Logger,
    graceMs: number,
  ) {
    this.hook = new HookTransport(graceMs, (eventId) => this.events.abandoned(eventId));
    this.transports = [this.hook];
    events.setDelivery({
      deliver: async (ev, response) => {
        for (const t of this.transports) {
          if (await t.sendResponse(ev.sessionId, response)) {
            this.log.debug("Delivered", { sessionId: ev.sessionId, eventId: ev.id, transport: t.name });
            return true;
          }
        }
        return false;
      },
      withdraw: (ev, reason) => {
        for (const t of this.transports) t.cancel(ev.sessionId, ev.id, reason);
      },
    });
  }

  /**
   * Long-poll from a hook. Resolves as soon as the event is decided or withdrawn, or with
   * `pending` after timeoutMs. `onClose` must be wired to the HTTP request's close event so a
   * disconnected hook stops counting as a waiter.
   */
  wait(eventId: string, sessionId: string, timeoutMs: number, onClose: (fn: () => void) => void): Promise<WaitResult> {
    const ev = this.events.get(eventId);
    if (ev.sessionId !== sessionId) throw forbidden("SESSION_MISMATCH", "Event does not belong to the given session.");

    const immediate = this.settled(ev);
    if (immediate) return Promise.resolve(immediate);

    return new Promise<WaitResult>((resolve) => {
      let done = false;
      let dispose: () => void = () => {};
      const finish = (result: WaitResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        dispose();
        if (result.state === "resolved") this.events.markDelivered(eventId);
        resolve(result);
      };
      const timer = setTimeout(() => finish({ state: "pending" }), timeoutMs);
      dispose = this.hook.addWaiter(eventId, { sessionId, settle: finish });
      onClose(() => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        dispose();
      });
      // The decision may have landed between the first read and registering the waiter.
      const late = this.settled(this.events.get(eventId));
      if (late) finish(late);
    });
  }

  private settled(ev: HubEvent): WaitResult | null {
    if ((ev.status === "PROCESSING" || ev.status === "RESOLVED") && ev.response) {
      if (ev.status === "PROCESSING") this.events.markDelivered(ev.id);
      return { state: "resolved", response: ev.response };
    }
    if (ev.status === "CANCELLED" || ev.status === "FAILED") {
      return { state: "cancelled", reason: String(ev.payload?.closeReason ?? ev.status) };
    }
    return null;
  }

  /** After a restart, hook-backed pending requests get a (longer) window to re-attach before being abandoned. */
  armRecovered(pending: HubEvent[], graceMs: number) {
    for (const ev of pending) {
      if (ev.payload?.transport === "hook") this.hook.armIdleTimer(ev.id, graceMs);
    }
  }

  sessionHasWaiters(sessionId: string) {
    return this.transports.some((t) => t.sessionHasWaiters(sessionId));
  }

  close() {
    this.hook.close();
  }
}
