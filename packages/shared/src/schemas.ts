import { z } from "zod";
import { AGENT_STATUSES, EVENT_TYPES, EVENT_STATUSES, PRIORITIES, RESPONSE_ACTIONS } from "./types.js";

/** Claude Code session ids are UUIDs; accept any conservative token-ish id. */
export const SessionIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/, "invalid session id");

export const EventIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^evt_[0-9A-Z]{26}$/, "invalid event id");

export const AgentIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^agent_[0-9A-Z]{26}$/, "invalid agent id");

export const RegisterAgentSchema = z.object({
  sessionId: SessionIdSchema,
  name: z.string().min(1).max(100).optional(),
  project: z.string().max(200).optional(),
  cwd: z.string().max(1000).optional(),
  pid: z.number().int().positive().optional(),
  account: z.string().max(200).optional(),
  source: z.string().max(50).optional(),
});
export type RegisterAgentInput = z.infer<typeof RegisterAgentSchema>;

export const UpdateAgentSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    status: z.enum(AGENT_STATUSES).optional(),
    activity: z.string().max(500).nullable().optional(),
  })
  .strict();
export type UpdateAgentInput = z.infer<typeof UpdateAgentSchema>;

export const HeartbeatSchema = z.object({
  sessionId: SessionIdSchema,
  status: z.enum(AGENT_STATUSES).optional(),
  activity: z.string().max(500).nullable().optional(),
});

export const CreateEventSchema = z.object({
  sessionId: SessionIdSchema,
  type: z.enum(EVENT_TYPES),
  message: z.string().max(20000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  /** Optional agent metadata so an event can implicitly register its session. */
  agent: RegisterAgentSchema.omit({ sessionId: true }).optional(),
});
export type CreateEventInput = z.infer<typeof CreateEventSchema>;

export const RespondSchema = z.object({
  action: z.enum(RESPONSE_ACTIONS),
  /** Must match the event's session when supplied (wrong-session protection). */
  sessionId: SessionIdSchema.optional(),
  response: z.string().max(20000).optional(),
  /** Alias accepted for compatibility with the spec's `answer` field. */
  answer: z.string().max(20000).optional(),
  answers: z.record(z.string(), z.string().max(20000)).optional(),
  source: z.enum(["dashboard", "terminal", "policy", "system"]).optional(),
  /** Required for destructive permissions when action=allow. */
  confirm: z.boolean().optional(),
});
export type RespondInput = z.infer<typeof RespondSchema>;

export const CancelSchema = z.object({
  sessionId: SessionIdSchema.optional(),
  reason: z.string().max(1000).optional(),
});

export const ListEventsQuerySchema = z.object({
  status: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.enum(EVENT_STATUSES))
    .optional(),
  type: z.string().max(50).optional(),
  agent: z.string().max(64).optional(),
  session: SessionIdSchema.optional(),
  project: z.string().max(200).optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  before: z.string().max(64).optional(),
});
export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;

export const WaitQuerySchema = z.object({
  sessionId: SessionIdSchema,
  timeout: z.coerce.number().int().min(0).max(60000).optional(),
});

export const PolicyRuleSchema = z.object({
  /** Tool name glob, e.g. "Bash", "Write", "mcp__*". Defaults to any tool. */
  tool: z.string().min(1).max(200).optional(),
  /** Glob matched against the operation summary (the command for Bash, path for file tools). */
  match: z.string().min(1).max(1000),
  action: z.enum(["allow", "deny", "ask"]),
  reason: z.string().max(500).optional(),
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const PolicyFileSchema = z.object({
  permissions: z.array(PolicyRuleSchema).default([]),
});
export type PolicyFile = z.infer<typeof PolicyFileSchema>;
