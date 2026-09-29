#!/usr/bin/env node
// Simulates four Claude Code sessions against a running hub using the real hook bridge.
// Usage: node scripts/demo.mjs   (hub at CREWDESK_URL, default http://127.0.0.1:7777)
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hookBin = path.join(root, "bin", "crewdesk-hook.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hook(sub, session, project, input = {}) {
  const child = spawn(process.execPath, [hookBin, sub], {
    env: { ...process.env, CLAUDE_PID: String(process.pid), CLAUDE_PROJECT_DIR: `C:/projects/${project}`, CLAUDE_CONFIG_DIR: "" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stdin.end(JSON.stringify({ session_id: session, cwd: `C:/projects/${project}`, ...input }));
  child.on("exit", () => console.log(`[${project}] ${sub} -> ${out || "(no output)"}`));
  return child;
}

const sessions = [
  ["demo-api", "api"],
  ["demo-frontend", "frontend"],
  ["demo-backend", "backend"],
  ["demo-mobile", "mobile"],
];

for (const [s, p] of sessions) {
  hook("register", s, p, { hook_event_name: "SessionStart", source: "startup" });
  await sleep(300);
}
await sleep(500);
hook("prompt", "demo-api", "api", { prompt: "Implement JWT authentication for the REST API" });
hook("prompt", "demo-mobile", "mobile", { prompt: "Run the test suite and fix failures" });
await sleep(800);

hook("question", "demo-frontend", "frontend", {
  hook_event_name: "PreToolUse",
  tool_name: "AskUserQuestion",
  tool_input: {
    questions: [
      {
        question: "Which authentication system should I use?",
        header: "Auth",
        multiSelect: false,
        options: [
          { label: "JWT", description: "Stateless tokens" },
          { label: "Session cookies", description: "Server-side sessions" },
          { label: "OAuth", description: "Delegate to a provider" },
        ],
      },
    ],
  },
});
await sleep(400);
hook("permission", "demo-backend", "backend", { hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm install zod" } });
await sleep(400);
hook("permission", "demo-api", "api", { hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "rm -rf ./build" } });
await sleep(400);
hook("stop", "demo-mobile", "mobile", { hook_event_name: "Stop", last_assistant_message: "All 142 tests pass. I fixed 3 failing snapshot tests in LoginScreen." });
await sleep(400);
hook("notification", "demo-backend", "backend", { message: "Build finished with 2 warnings", notification_type: "info" });

console.log("\nDemo sessions are waiting on the dashboard. Answer them there; Ctrl+C to stop.");
