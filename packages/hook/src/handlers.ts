import fs from "node:fs";
import path from "node:path";
import { assessRisk, summarizeToolInput } from "@crewdesk/shared/operations";
import type { HubEvent, HubResponse, QuestionItem, WaitResult } from "@crewdesk/shared/types";
import { debugLog, hubHome, HubHttpError, HubUnavailable, request, sleep } from "./client.js";
import {
  agentMeta,
  findClaudePid,
  removeSessionCache,
  writeSessionCache,
  type HookInput,
} from "./session.js";

/** What the hook prints on stdout (JSON for Claude Code) — null means "no opinion, carry on". */
export type HookOutput = Record<string, unknown> | null;

interface HookSettings {
  /** Max seconds a question waits for the dashboard before Claude shows it in the terminal. */
  questionWaitSeconds: number;
  /** Max seconds an idle session waits for a dashboard follow-up before returning to the prompt. */
  idleWaitSeconds: number;
  /** Max seconds a permission request waits (the terminal dialog stays usable meanwhile). */
  permissionWaitSeconds: number;
  idlePrompts: boolean;
}

export function hookSettings(): HookSettings {
  let cfg: Record<string, unknown> = {};
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(hubHome(), "config.json"), "utf8"));
  } catch {
    /* defaults */
  }
  const num = (env: string, key: string, dflt: number) => {
    const v = process.env[env] ?? cfg[key];
    const n = Number(v);
    return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : dflt;
  };
  const idleEnv = process.env.CREWDESK_IDLE_PROMPTS;
  return {
    questionWaitSeconds: num("CREWDESK_QUESTION_WAIT", "questionWaitSeconds", 600),
    idleWaitSeconds: num("CREWDESK_IDLE_WAIT", "idleWaitSeconds", 1800),
    permissionWaitSeconds: num("CREWDESK_PERMISSION_WAIT", "permissionWaitSeconds", 43200),
    idlePrompts:
      idleEnv !== undefined && idleEnv !== "" ? /^(1|true|yes|on)$/i.test(idleEnv) : cfg.idlePrompts !== false,
  };
}

async function createEvent(input: HookInput, body: Record<string, unknown>): Promise<HubEvent> {
  const res = await request<{ event: HubEvent }>("POST", "/api/events", {
    sessionId: input.session_id,
    agent: agentMeta(input),
    ...body,
  });
  return res.event;
}

/**
 * Block until the hub decides the event, withdraws it, or the deadline passes. Survives hub restarts by
 * retrying the long-poll; gives up (returns null) if the hub stays unreachable.
 */
export async function waitForDecision(ev: HubEvent, sessionId: string, maxWaitMs: number): Promise<HubResponse | null> {
  const deadline = Date.now() + maxWaitMs;
  let failures = 0;
  while (Date.now() < deadline) {
    const pollMs = Math.max(0, Math.min(25000, deadline - Date.now()));
    try {
      const r = await request<WaitResult>(
        "GET",
        `/api/events/${ev.id}/wait?sessionId=${encodeURIComponent(sessionId)}&timeout=${pollMs}`,
        undefined,
        { timeoutMs: pollMs + 10000, retries: [] },
      );
      failures = 0;
      if (r.state === "resolved") return r.response;
      if (r.state === "cancelled") return null;
    } catch (err) {
      if (err instanceof HubHttpError) return null; // 403/404: event gone or not ours
      failures++;
      // ~60s of consecutive failures => the hub is gone; fall back to the terminal.
      if (failures > 30) return null;
      await sleep(Math.min(2000, 100 * 2 ** failures));
    }
  }
  // Deadline: withdraw the request so the dashboard doesn't show a stale prompt.
  await request("POST", `/api/events/${ev.id}/cancel`, { sessionId, reason: "Timed out waiting; continuing in the terminal." }, { retries: [] }).catch(() => {});
  return null;
}

/** SessionStart — register the session (hook is configured async so this never delays startup). */
export async function onSessionStart(input: HookInput): Promise<HookOutput> {
  const pid = findClaudePid();
  writeSessionCache(input.session_id, { pid });
  const meta = agentMeta(input, pid);
  await request("POST", "/api/agents/register", { sessionId: input.session_id, ...meta });
  return null;
}

export async function onSessionEnd(input: HookInput): Promise<HookOutput> {
  removeSessionCache(input.session_id);
  await request(
    "POST",
    "/api/events",
    { sessionId: input.session_id, type: "session.stopped", message: `Session ended (${input.reason ?? "exit"})`, agent: agentMeta(input) },
    { retries: [], timeoutMs: 1000 },
  );
  return null;
}

export async function onPromptSubmit(input: HookInput): Promise<HookOutput> {
  await createEvent(input, { type: "task.started", message: String(input.prompt ?? "").slice(0, 2000) });
  return null;
}

const QUIET_NOTIFICATIONS = new Set(["permission_prompt", "idle_prompt"]);

export async function onNotification(input: HookInput): Promise<HookOutput> {
  const notificationType = String(input.notification_type ?? input.type ?? "");
  await createEvent(input, {
    type: "notification.created",
    message: String(input.message ?? "Claude needs your attention"),
    // Permission/idle notifications duplicate requests the hub already shows; log them silently.
    payload: { notificationType, silent: QUIET_NOTIFICATIONS.has(notificationType) },
  });
  return null;
}

/** PermissionRequest — the terminal dialog stays live meanwhile; whichever answers first wins. */
export async function onPermission(input: HookInput): Promise<HookOutput> {
  const toolName = String(input.tool_name ?? "");
  const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
  if (toolName === "AskUserQuestion") return null; // handled by the PreToolUse question hook
  const summary = summarizeToolInput(toolName, toolInput);
  const risk = assessRisk(toolName, toolInput);
  const ev = await createEvent(input, {
    type: "permission.created",
    message: `${toolName}: ${summary}`.slice(0, 2000),
    payload: {
      toolName,
      toolInput,
      summary,
      cwd: input.cwd,
      destructive: risk.destructive,
      destructiveReason: risk.reason,
      permissionMode: input.permission_mode,
      transport: "hook",
    },
  });
  const response =
    ev.response && (ev.status === "PROCESSING" || ev.status === "RESOLVED")
      ? ev.response
      : await waitForDecision(ev, input.session_id, hookSettings().permissionWaitSeconds * 1000);
  if (!response) return null;
  if (response.action === "allow") {
    return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } };
  }
  if (response.action === "deny") {
    const via = response.source === "policy" ? "a Crewdesk policy" : "Crewdesk";
    return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message: response.response ? `Denied by ${via}: ${response.response}` : `Denied by ${via}.` },
      },
    };
  }
  return null;
}

/** Map a hub response onto AskUserQuestion's `answers` (question text -> answer string). */
export function buildAnswers(questions: QuestionItem[], response: HubResponse): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const a = response.answers?.[q.question] ?? response.response;
    if (a) answers[q.question] = a;
  }
  return answers;
}

/** PreToolUse(AskUserQuestion) — answer Claude's question from the dashboard. */
export async function onQuestion(input: HookInput): Promise<HookOutput> {
  if (input.tool_name !== "AskUserQuestion") return null;
  const toolInput = (input.tool_input ?? {}) as { questions?: QuestionItem[] };
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
  if (questions.length === 0) return null;
  const ev = await createEvent(input, {
    type: "question.created",
    message: questions.map((q) => q.question).join("\n"),
    payload: { questions, transport: "hook" },
  });
  const response = await waitForDecision(ev, input.session_id, hookSettings().questionWaitSeconds * 1000);
  if (!response || response.action !== "answer") return null; // dismissed => ask in the terminal
  const answers = buildAnswers(questions, response);
  if (Object.keys(answers).length === 0) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Answered from Crewdesk",
      updatedInput: { ...toolInput, answers },
    },
  };
}

/** Stop — the turn finished. Optionally wait for a follow-up instruction from the dashboard. */
export async function onStop(input: HookInput): Promise<HookOutput> {
  const settings = hookSettings();
  const last = typeof input.last_assistant_message === "string" ? input.last_assistant_message : "";
  const message = last.length > 4000 ? last.slice(0, 3997) + "..." : last;
  await createEvent(input, { type: "task.completed", message: message.slice(0, 500) || "Turn finished" });
  if (!settings.idlePrompts || settings.idleWaitSeconds <= 0) return null;
  const ev = await createEvent(input, {
    type: "prompt.created",
    message: message || "Claude finished and is waiting for your next instruction.",
    payload: { lastMessage: message, stopHookActive: Boolean(input.stop_hook_active), transport: "hook" },
  });
  const response = await waitForDecision(ev, input.session_id, settings.idleWaitSeconds * 1000);
  if (!response || response.action !== "prompt" || !response.response?.trim()) return null;
  return { decision: "block", reason: response.response };
}

export const HANDLERS: Record<string, (input: HookInput) => Promise<HookOutput>> = {
  register: onSessionStart,
  "session-start": onSessionStart,
  "session-end": onSessionEnd,
  end: onSessionEnd,
  prompt: onPromptSubmit,
  notification: onNotification,
  permission: onPermission,
  question: onQuestion,
  stop: onStop,
};

export { HubUnavailable, debugLog };
