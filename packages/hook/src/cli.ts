import { debugLog, HANDLERS } from "./handlers.js";
import type { HookInput } from "./session.js";

const USAGE = `crewdesk-hook <command>

Claude Code hook bridge for Crewdesk. Reads the hook JSON from stdin.

Commands:
  register       SessionStart: register the session with the hub
  permission     PermissionRequest: forward and wait for Allow/Deny
  question       PreToolUse(AskUserQuestion): answer from the dashboard
  notification   Notification: forward notifications
  prompt         UserPromptSubmit: mark the session as working
  stop           Stop: report completion and wait for a follow-up prompt
  session-end    SessionEnd: mark the session offline

Environment:
  CREWDESK_URL          hub base URL (default http://127.0.0.1:7777)
  CREWDESK_AGENT_NAME   display name for this session
  CREWDESK_HOOK_DEBUG   log to ~/.crewdesk/logs/hook.log
`;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<number> {
  const cmd = process.argv[2];
  if (!cmd || cmd === "--help" || cmd === "-h") {
    process.stdout.write(USAGE);
    return cmd ? 0 : 1;
  }
  const handler = HANDLERS[cmd];
  if (!handler) {
    process.stderr.write(`crewdesk-hook: unknown command "${cmd}"\n`);
    return 0; // never break Claude Code because of a misconfiguration
  }
  let input: HookInput;
  try {
    input = JSON.parse(await readStdin()) as HookInput;
    if (!input || typeof input.session_id !== "string") throw new Error("missing session_id");
  } catch (err) {
    debugLog(`${cmd}: bad stdin: ${(err as Error).message}`);
    return 0;
  }
  try {
    const out = await handler(input);
    debugLog(`${cmd}: ${out ? JSON.stringify(out) : "no output"}`);
    // Wait for the write to flush: process.exit() can truncate pending pipe writes.
    if (out) await new Promise<void>((r) => process.stdout.write(JSON.stringify(out), () => r()));
  } catch (err) {
    // Hub down or rejected the request: fail open so Claude Code carries on as if no hook existed.
    debugLog(`${cmd}: ${(err as Error).message}`);
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  () => process.exit(0),
);
