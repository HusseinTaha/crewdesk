export const AGENT_STATUSES = [
  "STARTING",
  "WORKING",
  "WAITING",
  "QUESTION",
  "PERMISSION",
  "ERROR",
  "COMPLETED",
  "OFFLINE",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const EVENT_TYPES = [
  "session.started",
  "session.updated",
  "session.stopped",
  "question.created",
  "question.answered",
  "question.cancelled",
  "permission.created",
  "permission.approved",
  "permission.denied",
  "prompt.created",
  "prompt.sent",
  "prompt.cancelled",
  "notification.created",
  "task.started",
  "task.completed",
  "task.failed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Event types that wait for a human decision and can be responded to. */
export const REQUEST_EVENT_TYPES = ["permission.created", "question.created", "prompt.created"] as const;
export type RequestEventType = (typeof REQUEST_EVENT_TYPES)[number];

export const EVENT_STATUSES = ["PENDING", "PROCESSING", "RESOLVED", "CANCELLED", "FAILED"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const RESPONSE_ACTIONS = ["allow", "deny", "answer", "prompt", "dismiss"] as const;
export type ResponseAction = (typeof RESPONSE_ACTIONS)[number];

export interface Agent {
  id: string;
  sessionId: string;
  name: string;
  projectName: string | null;
  cwd: string | null;
  pid: number | null;
  account: string | null;
  status: AgentStatus;
  activity: string | null;
  createdAt: string;
  lastSeenAt: string;
  pendingCount: number;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}

/** Payload shapes per request type (stored as JSON in events.payload). */
export interface PermissionPayload {
  toolName: string;
  toolInput: Record<string, unknown>;
  /** Human-readable summary of the operation (command, file path...). */
  summary: string;
  cwd?: string;
  destructive?: boolean;
  destructiveReason?: string;
}

export interface QuestionPayload {
  questions: QuestionItem[];
}

export interface PromptPayload {
  lastMessage?: string;
}

export interface HubEvent {
  id: string;
  sessionId: string;
  agentId: string | null;
  type: EventType;
  status: EventStatus;
  priority: Priority;
  message: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt: string | null;
  response: HubResponse | null;
}

export interface HubResponse {
  id: string;
  eventId: string;
  sessionId: string;
  action: ResponseAction;
  /** Free-text answer / follow-up prompt / denial reason. */
  response: string | null;
  /** For questions: question text -> answer. */
  answers: Record<string, string> | null;
  /** Where the decision came from. */
  source: "dashboard" | "terminal" | "policy" | "system";
  createdAt: string;
}

/** What the hook receives when it long-polls for a decision. */
export type WaitResult =
  | { state: "pending" }
  | { state: "resolved"; response: HubResponse }
  | { state: "cancelled"; reason?: string };

export type WsMessage =
  | { type: "hello"; agents: Agent[]; pending: HubEvent[] }
  | { type: "agent.created"; agent: Agent }
  | { type: "agent.updated"; agent: Agent }
  | { type: "agent.removed"; agentId: string }
  | { type: "event.created"; event: HubEvent }
  | { type: "event.updated"; event: HubEvent }
  | { type: "event.resolved"; event: HubEvent }
  | { type: "event.deleted"; eventId: string };

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface HealthInfo {
  status: "ok";
  database: "ok" | "error";
  websocket: "ok";
  uptime: number;
  version: string;
  pid: number;
}
