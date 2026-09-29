/**
 * Opt-in: drives a REAL Claude Code session (`pnpm test:live`, uses tokens). Hooks are passed with
 * `--settings`, so no user settings are modified. Requires `pnpm build` and `claude` on PATH.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { mergeOurHooks } from "../../apps/server/src/cli/hooks-config.js";
import { api, sleep, startTestHub, type TestHub } from "../../apps/server/test/helpers.js";

let hub: TestHub;
let work: string;
let settingsFile: string;

beforeAll(async () => {
  hub = await startTestHub({ waiterGraceMs: 3000 });
  work = fs.mkdtempSync(path.join(os.tmpdir(), "cch-live-"));
  settingsFile = path.join(work, "hub-settings.json");
  const hooks = mergeOurHooks({}, path.resolve("bin/claude-hub-hook.mjs"));
  fs.writeFileSync(settingsFile, JSON.stringify({ hooks }, null, 2));
});

afterAll(async () => {
  await hub?.close();
});

function claude(prompt: string) {
  const child = spawn(
    "claude",
    ["-p", prompt, "--settings", settingsFile, "--permission-mode", "default", "--model", "haiku", "--output-format", "text"],
    {
      cwd: work,
      shell: process.platform === "win32",
      env: { ...process.env, CLAUDE_HUB_URL: hub.url, CLAUDE_HUB_HOME: hub.home, CLAUDE_HUB_IDLE_PROMPTS: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  return new Promise<{ code: number | null; out: string }>((resolve) => child.on("exit", (code) => resolve({ code, out })));
}

async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 120000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(500);
  }
  throw new Error("timed out");
}

it("real Claude Code: session registers, permission is approved from the hub, command runs", async () => {
  const run = claude("Use the Bash tool to run exactly this command: echo live-ok > live.txt . Then reply DONE.");
  const ev = await waitFor(async () =>
    (await api(hub, "GET", "/api/events/pending")).body.events.find((e: any) => e.type === "permission.created"),
  );
  expect(ev.payload.toolName).toBe("Bash");
  expect(ev.payload.summary).toContain("live-ok");
  const agents = (await api(hub, "GET", "/api/agents")).body.agents;
  expect(agents.find((a: any) => a.sessionId === ev.sessionId)).toBeTruthy();
  await api(hub, "POST", `/api/events/${ev.id}/respond`, { action: "allow", sessionId: ev.sessionId });
  const result = await run;
  expect(result.code, result.out).toBe(0);
  expect(fs.readFileSync(path.join(work, "live.txt"), "utf8").trim()).toBe("live-ok");
  expect((await api(hub, "GET", `/api/events/${ev.id}`)).body.event.status).toBe("RESOLVED");
});

it("real Claude Code: a denied permission blocks the command", async () => {
  const run = claude("Use the Bash tool to run exactly: echo nope > denied.txt . If it is denied, reply DENIED.");
  const ev = await waitFor(async () =>
    (await api(hub, "GET", "/api/events/pending")).body.events.find((e: any) => e.type === "permission.created"),
  );
  await api(hub, "POST", `/api/events/${ev.id}/respond`, { action: "deny", response: "live test" });
  await run;
  expect(fs.existsSync(path.join(work, "denied.txt"))).toBe(false);
});
