import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, sleep, startTestHub, type TestHub } from "../../../apps/server/test/helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const hookSrc = path.resolve(here, "../src/cli.ts");

let hub: TestHub;
beforeEach(async () => {
  hub = await startTestHub();
});
afterEach(async () => {
  await hub.close();
});

interface HookRun {
  done: Promise<{ code: number | null; stdout: string }>;
  kill(): void;
}

/** Run the hook CLI from source exactly as Claude Code would: JSON on stdin, JSON on stdout. */
function runHook(sub: string, input: Record<string, unknown>, env: Record<string, string> = {}): HookRun {
  const child = spawn(process.execPath, ["--import", "tsx", hookSrc, sub], {
    env: {
      ...process.env,
      CREWDESK_URL: hub.url,
      CREWDESK_HOME: hub.home,
      CLAUDE_PID: String(process.pid),
      CLAUDE_PROJECT_DIR: "/work/shop",
      CLAUDE_CONFIG_DIR: "/home/me/.claude-accounts/work",
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stdin.end(JSON.stringify({ session_id: "sess-1", cwd: "/work/shop", ...input }));
  return {
    done: new Promise((resolve) => child.on("exit", (code) => resolve({ code, stdout }))),
    kill: () => child.kill(),
  };
}

async function waitForPending(type: string, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const evs = (await api(hub, "GET", "/api/events/pending")).body.events.filter((e: any) => e.type === type);
    if (evs.length) return evs[0];
    await sleep(100);
  }
  throw new Error(`no pending ${type}`);
}

describe("crewdesk-hook in remote mode", () => {
  const TOKEN = "hook-remote-token-0123456789";
  const agents = async () =>
    (await (await fetch(hub.url + "/api/agents", { headers: { authorization: `Bearer ${TOKEN}` } })).json()).agents;
  const remote = async () => {
    await hub.close();
    hub = await startTestHub({ remote: true, accessToken: TOKEN });
  };

  it("sends the access token from <home>/access.token", async () => {
    await remote();
    fs.writeFileSync(path.join(hub.home, "access.token"), TOKEN);
    const r = await runHook("register", { hook_event_name: "SessionStart", source: "startup" }).done;
    expect(r.code).toBe(0);
    expect((await agents()).map((a: any) => a.sessionId)).toEqual(["sess-1"]);
  });

  it("fails open when the token is missing: exit 0, nothing registered", async () => {
    await remote();
    const r = await runHook("register", { hook_event_name: "SessionStart", source: "startup" }).done;
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(await agents()).toEqual([]);
  });
});

describe("crewdesk-hook", () => {
  it("register creates an agent with project, account and pid", async () => {
    const r = await runHook("register", { hook_event_name: "SessionStart", source: "startup" }).done;
    expect(r.code).toBe(0);
    const [agent] = (await api(hub, "GET", "/api/agents")).body.agents;
    expect(agent).toMatchObject({ sessionId: "sess-1", name: "shop #1", projectName: "shop", account: "work", pid: process.pid });
  });

  it("permission: dashboard Allow is printed in PermissionRequest format", async () => {
    const run = runHook("permission", { hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm install zod" } });
    const ev = await waitForPending("permission.created");
    expect(ev.payload.summary).toBe("npm install zod");
    await api(hub, "POST", `/api/events/${ev.id}/respond`, { action: "allow", sessionId: "sess-1" });
    const r = await run.done;
    expect(JSON.parse(r.stdout)).toEqual({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
    expect((await api(hub, "GET", `/api/events/${ev.id}`)).body.event.status).toBe("RESOLVED");
  });

  it("permission: deny carries the reason", async () => {
    const run = runHook("permission", { tool_name: "Bash", tool_input: { command: "rm -rf build" } });
    const ev = await waitForPending("permission.created");
    expect(ev.payload.destructive).toBe(true);
    await api(hub, "POST", `/api/events/${ev.id}/respond`, { action: "deny", response: "not now" });
    const out = JSON.parse((await run.done).stdout);
    expect(out.hookSpecificOutput.decision).toEqual({ behavior: "deny", message: "Denied by Crewdesk: not now" });
  });

  it("permission answered in the terminal: hook killed -> event cancelled", async () => {
    const run = runHook("permission", { tool_name: "Bash", tool_input: { command: "ls" } });
    const ev = await waitForPending("permission.created");
    run.kill();
    await run.done;
    await sleep(hub.config.waiterGraceMs + 500);
    expect((await api(hub, "GET", `/api/events/${ev.id}`)).body.event.status).toBe("CANCELLED");
  });

  it("question: answers are returned as AskUserQuestion updatedInput", async () => {
    const questions = [{ question: "Which database?", header: "DB", multiSelect: false, options: [{ label: "PostgreSQL" }, { label: "SQLite" }] }];
    const run = runHook("question", { hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: { questions } });
    const ev = await waitForPending("question.created");
    await api(hub, "POST", `/api/events/${ev.id}/respond`, { action: "answer", answers: { "Which database?": "PostgreSQL" } });
    const out = JSON.parse((await run.done).stdout);
    expect(out.hookSpecificOutput).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Answered from Crewdesk",
      updatedInput: { questions, answers: { "Which database?": "PostgreSQL" } },
    });
  });

  it("question dismissed ('answer in terminal') prints nothing", async () => {
    const run = runHook("question", { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Q?", options: [{ label: "a" }, { label: "b" }] }] } });
    const ev = await waitForPending("question.created");
    await api(hub, "POST", `/api/events/${ev.id}/respond`, { action: "dismiss" });
    expect((await run.done).stdout).toBe("");
  });

  it("stop: a dashboard follow-up blocks the stop with the new instruction", async () => {
    const run = runHook("stop", { hook_event_name: "Stop", last_assistant_message: "All done.", stop_hook_active: false });
    const ev = await waitForPending("prompt.created");
    expect(ev.message).toBe("All done.");
    await api(hub, "POST", `/api/events/${ev.id}/respond`, { action: "prompt", response: "Now write tests" });
    expect(JSON.parse((await run.done).stdout)).toEqual({ decision: "block", reason: "Now write tests" });
  });

  it("stop: gives up after idle wait and withdraws the prompt", async () => {
    const r = await runHook("stop", { last_assistant_message: "x" }, { CREWDESK_IDLE_WAIT: "1" }).done;
    expect(r.stdout).toBe("");
    const evs = (await api(hub, "GET", "/api/events?type=prompt.created")).body.events;
    expect(evs[0].status).toBe("CANCELLED");
  });

  it("fails open when the hub is down", async () => {
    const start = Date.now();
    const r = await runHook("permission", { tool_name: "Bash", tool_input: { command: "ls" } }, { CREWDESK_URL: "http://127.0.0.1:9" }).done;
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(Date.now() - start).toBeLessThan(15000);
  });

  it("tolerates garbage stdin", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", hookSrc, "permission"], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.end("not json");
    const code = await new Promise((r) => child.on("exit", r));
    expect(code).toBe(0);
  });

  it("notifications: permission_prompt is silent, others need attention", async () => {
    await runHook("notification", { message: "Claude needs your permission", notification_type: "permission_prompt" }).done;
    await runHook("notification", { message: "Build broke", notification_type: "error" }).done;
    const pending = (await api(hub, "GET", "/api/events/pending")).body.events;
    expect(pending.map((e: any) => e.message)).toEqual(["Build broke"]);
  });

  it("prompt + session-end update agent status", async () => {
    await runHook("prompt", { prompt: "Refactor auth" }).done;
    let [agent] = (await api(hub, "GET", "/api/agents")).body.agents;
    expect(agent.status).toBe("WORKING");
    expect(agent.activity).toBe("Refactor auth");
    await runHook("session-end", { reason: "prompt_input_exit" }).done;
    [agent] = (await api(hub, "GET", "/api/agents")).body.agents;
    expect(agent.status).toBe("OFFLINE");
  });
});
