import type { HubResponse, WaitResult } from "@cch/shared";

/**
 * Delivers decisions back to a Claude Code session. The rest of the hub only talks to this interface,
 * so the delivery mechanism (hook long-poll today; IPC/PTY later) can change without touching routing.
 */
export interface SessionTransport {
  readonly name: string;
  /** Deliver a response. Resolves true when a live session endpoint received it, false if it is queued. */
  sendResponse(sessionId: string, response: HubResponse): Promise<boolean>;
  /** Tell any waiting session endpoint that the request was withdrawn. */
  cancel(sessionId: string, eventId: string, reason: string): void;
  /** Whether a live endpoint for this event is currently connected. */
  isWaiting(eventId: string): boolean;
  /** Whether any endpoint for the session is currently connected. */
  sessionHasWaiters(sessionId: string): boolean;
}

export interface Waiter {
  sessionId: string;
  settle(result: WaitResult): void;
}
