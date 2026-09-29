import type { AgentStatus, EventType, HubEvent } from "@crewdesk/shared/types";

export const STATUS_STYLE: Record<AgentStatus, { dot: string; text: string; label: string; icon: string }> = {
  STARTING: { dot: "bg-st-blue", text: "text-st-blue", label: "Starting", icon: "●" },
  WORKING: { dot: "bg-st-blue", text: "text-st-blue", label: "Working", icon: "●" },
  WAITING: { dot: "bg-st-yellow", text: "text-st-yellow", label: "Waiting", icon: "●" },
  QUESTION: { dot: "bg-st-orange", text: "text-st-orange", label: "Question", icon: "!" },
  PERMISSION: { dot: "bg-st-purple", text: "text-st-purple", label: "Permission", icon: "🔐" },
  ERROR: { dot: "bg-st-red", text: "text-st-red", label: "Error", icon: "✕" },
  COMPLETED: { dot: "bg-st-green", text: "text-st-green", label: "Completed", icon: "✓" },
  OFFLINE: { dot: "bg-st-gray", text: "text-st-gray", label: "Offline", icon: "○" },
};

export const EVENT_LABEL: Record<EventType, string> = {
  "session.started": "Session started",
  "session.updated": "Session updated",
  "session.stopped": "Session ended",
  "question.created": "Question",
  "question.answered": "Question answered",
  "question.cancelled": "Question cancelled",
  "permission.created": "Permission request",
  "permission.approved": "Permission approved",
  "permission.denied": "Permission denied",
  "prompt.created": "Waiting for instructions",
  "prompt.sent": "Instruction sent",
  "prompt.cancelled": "Resumed in terminal",
  "notification.created": "Notification",
  "task.started": "Task started",
  "task.completed": "Task completed",
  "task.failed": "Task failed",
};

/** Attention ordering: permissions, questions, errors, idle prompts, other notifications. */
const CATEGORY_RANK: Partial<Record<EventType, number>> = {
  "permission.created": 0,
  "question.created": 1,
  "task.failed": 2,
  "prompt.created": 3,
  "notification.created": 4,
};
const PRIORITY_RANK = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as const;

export function sortAttention(events: HubEvent[]): HubEvent[] {
  return [...events].sort(
    (a, b) =>
      (CATEGORY_RANK[a.type] ?? 9) - (CATEGORY_RANK[b.type] ?? 9) ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} sec ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const clockSec = (iso: string) => new Date(iso).toLocaleTimeString();
export const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
