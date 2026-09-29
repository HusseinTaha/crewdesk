import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { hubHome } from "./client.js";

/** Common fields Claude Code passes on stdin to every hook. */
export interface HookInput {
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  permission_mode?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  message?: string;
  notification_type?: string;
  type?: string;
  prompt?: string;
  source?: string;
  reason?: string;
  last_assistant_message?: string;
  stop_hook_active?: boolean;
  [key: string]: unknown;
}

export interface AgentMeta {
  name?: string;
  project?: string;
  cwd?: string;
  pid?: number;
  account?: string;
  source?: string;
}

function sessionCacheFile(sessionId: string) {
  return path.join(hubHome(), "sessions", `${sessionId.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`);
}

export function readSessionCache(sessionId: string): { pid?: number } {
  try {
    return JSON.parse(fs.readFileSync(sessionCacheFile(sessionId), "utf8"));
  } catch {
    return {};
  }
}

export function writeSessionCache(sessionId: string, data: { pid?: number }) {
  try {
    const file = sessionCacheFile(sessionId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  } catch {
    /* best effort */
  }
}

export function removeSessionCache(sessionId: string) {
  try {
    fs.rmSync(sessionCacheFile(sessionId), { force: true });
  } catch {
    /* ignore */
  }
}

export function agentMeta(input: HookInput, pid?: number): AgentMeta {
  const cwd = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  return {
    name: process.env.CLAUDE_HUB_AGENT_NAME || undefined,
    project: process.env.CLAUDE_HUB_PROJECT || path.basename(cwd),
    cwd,
    pid: pid ?? readSessionCache(input.session_id).pid,
    account: configDir ? path.basename(configDir) : undefined,
    source: "hook",
  };
}

interface Proc {
  pid: number;
  ppid: number;
  name: string;
}

function processTable(): Map<number, Proc> {
  const table = new Map<number, Proc>();
  if (process.platform === "win32") {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)\" }",
      ],
      { encoding: "utf8", timeout: 8000, windowsHide: true },
    );
    for (const line of out.split(/\r?\n/)) {
      const [pid, ppid, name] = line.split("\t");
      if (pid && ppid) table.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), name: name ?? "" });
    }
  } else {
    const out = execFileSync("ps", ["-A", "-o", "pid=,ppid=,comm="], { encoding: "utf8", timeout: 5000 });
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (m) table.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), name: path.basename(m[3]!) });
    }
  }
  return table;
}

/**
 * Find the Claude Code process that spawned this hook by walking up the process tree. Used for liveness
 * (the hub marks a session OFFLINE when this pid dies). Returns undefined when it can't be determined.
 */
export function findClaudePid(): number | undefined {
  if (process.env.CLAUDE_HUB_CLAUDE_PID) return Number(process.env.CLAUDE_HUB_CLAUDE_PID) || undefined;
  // Claude Code exports its own pid to hooks (observed in 2.1.x); prefer it over walking the tree.
  if (process.env.CLAUDE_PID && Number(process.env.CLAUDE_PID) > 0) return Number(process.env.CLAUDE_PID);
  try {
    const table = processTable();
    let cur = table.get(process.pid);
    const seen = new Set<number>();
    let nodeCandidate: number | undefined;
    while (cur && !seen.has(cur.pid)) {
      seen.add(cur.pid);
      const name = cur.name.toLowerCase();
      if (cur.pid !== process.pid) {
        if (/^claude(\.exe)?$/.test(name)) return cur.pid;
        if (!nodeCandidate && /^(node|bun)(\.exe)?$/.test(name)) nodeCandidate = cur.pid;
      }
      cur = table.get(cur.ppid);
    }
    return nodeCandidate;
  } catch {
    return undefined;
  }
}
