import { spawn } from "node:child_process";
import path from "node:path";

export const HUB = "http://127.0.0.1:7788";
const hookBin = path.resolve("bin/crewdesk-hook.mjs");

export interface HookRun {
  done: Promise<{ code: number | null; stdout: string }>;
  kill(): void;
}

/** Simulate one Claude Code hook invocation for a session using the real built hook bridge. */
export function hook(sub: string, sessionId: string, project: string, input: Record<string, unknown> = {}): HookRun {
  const child = spawn(process.execPath, [hookBin, sub], {
    env: {
      ...process.env,
      CREWDESK_URL: HUB,
      CREWDESK_HOME: process.env.CREWDESK_E2E_HOME!,
      CLAUDE_PID: String(process.pid),
      CLAUDE_PROJECT_DIR: `/projects/${project}`,
      CLAUDE_CONFIG_DIR: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stdin.end(JSON.stringify({ session_id: sessionId, cwd: `/projects/${project}`, ...input }));
  return {
    done: new Promise((resolve) => child.on("exit", (code) => resolve({ code, stdout }))),
    kill: () => child.kill(),
  };
}

export async function register(sessionId: string, project: string) {
  await hook("register", sessionId, project, { hook_event_name: "SessionStart", source: "startup" }).done;
}

export function permission(sessionId: string, project: string, command: string) {
  return hook("permission", sessionId, project, { hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command } });
}

export function question(sessionId: string, project: string, text: string, options: string[]) {
  return hook("question", sessionId, project, {
    hook_event_name: "PreToolUse",
    tool_name: "AskUserQuestion",
    tool_input: { questions: [{ question: text, header: "Choice", multiSelect: false, options: options.map((label) => ({ label })) }] },
  });
}

/** Wipe hub state between tests through the public API. */
export async function resetHub() {
  const pending = (await (await fetch(`${HUB}/api/events/pending`)).json()).events as Array<{ id: string }>;
  for (const e of pending) await fetch(`${HUB}/api/events/${e.id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const agents = (await (await fetch(`${HUB}/api/agents`)).json()).agents as Array<{ id: string }>;
  for (const a of agents) await fetch(`${HUB}/api/agents/${a.id}`, { method: "DELETE" });
}
