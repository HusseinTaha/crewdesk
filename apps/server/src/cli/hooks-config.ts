import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Marker used to recognise (and later remove) hooks we installed. Never touch anything else. */
export const HOOK_MARKER = "claude-hub-hook";

export interface ConfigTarget {
  dir: string;
  label: string;
  settingsFile: string;
  exists: boolean;
  installed: boolean;
}

interface CommandHook {
  type: "command";
  command: string;
  timeout?: number;
  async?: boolean;
  [k: string]: unknown;
}
interface MatcherGroup {
  matcher?: string;
  hooks: CommandHook[];
  [k: string]: unknown;
}
type HooksSection = Record<string, MatcherGroup[]>;

/** Hook events we register, their CLI subcommand, matcher and Claude Code timeout (seconds). */
export const HOOK_PLAN: Array<{ event: string; sub: string; matcher?: string; timeout: number; async?: boolean }> = [
  { event: "SessionStart", sub: "register", timeout: 30, async: true },
  { event: "UserPromptSubmit", sub: "prompt", timeout: 10, async: true },
  { event: "Notification", sub: "notification", timeout: 10, async: true },
  { event: "PermissionRequest", sub: "permission", timeout: 86400 },
  { event: "PreToolUse", sub: "question", matcher: "AskUserQuestion", timeout: 86400 },
  { event: "Stop", sub: "stop", timeout: 86400 },
  { event: "SessionEnd", sub: "session-end", timeout: 5 },
];

const fwd = (p: string) => p.replace(/\\/g, "/");

/** Shell command Claude Code runs. Absolute node + script so PATH differences don't matter. */
export function hookCommand(hookScript: string, sub: string, nodePath = process.execPath): string {
  return `"${fwd(nodePath)}" "${fwd(hookScript)}" ${sub}`;
}

function isOurs(h: { command?: unknown }): boolean {
  return typeof h.command === "string" && h.command.includes(HOOK_MARKER);
}

/** Candidate Claude Code config dirs: ~/.claude, ~/.claude-accounts/*, and $CLAUDE_CONFIG_DIR. */
export function detectConfigDirs(home = os.homedir(), env = process.env): string[] {
  const dirs = new Set<string>();
  const add = (d: string) => dirs.add(path.resolve(d));
  add(path.join(home, ".claude"));
  const accounts = path.join(home, ".claude-accounts");
  if (fs.existsSync(accounts)) {
    for (const entry of fs.readdirSync(accounts, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const d = path.join(accounts, entry.name);
      if (fs.existsSync(path.join(d, "settings.json")) || fs.existsSync(path.join(d, ".claude.json"))) add(d);
    }
  }
  if (env.CLAUDE_CONFIG_DIR) add(env.CLAUDE_CONFIG_DIR);
  return [...dirs];
}

function readSettings(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${file} is not a JSON object`);
  return parsed as Record<string, unknown>;
}

export function describeTarget(dir: string, home = os.homedir()): ConfigTarget {
  const settingsFile = path.join(dir, "settings.json");
  let installed = false;
  try {
    const hooks = (readSettings(settingsFile).hooks ?? {}) as HooksSection;
    installed = Object.values(hooks).some((groups) => Array.isArray(groups) && groups.some((g) => g?.hooks?.some?.(isOurs)));
  } catch {
    /* unreadable => treat as not installed */
  }
  const rel = path.relative(home, dir);
  return {
    dir,
    label: rel && !rel.startsWith("..") ? `~/${fwd(rel)}` : dir,
    settingsFile,
    exists: fs.existsSync(dir),
    installed,
  };
}

/** Remove our hooks from a hooks section, leaving every other hook (and group) untouched. */
export function stripOurHooks(hooks: HooksSection): HooksSection {
  const out: HooksSection = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      out[event] = groups;
      continue;
    }
    const kept: MatcherGroup[] = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) {
        kept.push(g);
        continue;
      }
      const remaining = g.hooks.filter((h) => !isOurs(h));
      if (remaining.length === g.hooks.length) kept.push(g);
      else if (remaining.length > 0) kept.push({ ...g, hooks: remaining });
    }
    if (kept.length > 0) out[event] = kept;
  }
  return out;
}

export function mergeOurHooks(hooks: HooksSection, hookScript: string, nodePath = process.execPath): HooksSection {
  const out = stripOurHooks(hooks);
  for (const p of HOOK_PLAN) {
    const hook: CommandHook = { type: "command", command: hookCommand(hookScript, p.sub, nodePath), timeout: p.timeout };
    if (p.async) hook.async = true;
    const group: MatcherGroup = p.matcher ? { matcher: p.matcher, hooks: [hook] } : { hooks: [hook] };
    out[p.event] = [...(out[p.event] ?? []), group];
  }
  return out;
}

function timestamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function backupSettings(target: ConfigTarget, backupDir: string): string | null {
  if (!fs.existsSync(target.settingsFile)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  const name = `${path.basename(target.dir).replace(/^\./, "") || "claude"}-settings-${timestamp()}.json`;
  let dest = path.join(backupDir, name);
  for (let i = 1; fs.existsSync(dest); i++) dest = path.join(backupDir, name.replace(/\.json$/, `-${i}.json`));
  fs.copyFileSync(target.settingsFile, dest);
  return dest;
}

/** Write settings atomically, re-validate, and roll back to the backup if anything goes wrong. */
function writeValidated(file: string, data: Record<string, unknown>, backup: string | null) {
  const tmp = `${file}.cch-${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
    JSON.parse(fs.readFileSync(tmp, "utf8"));
    fs.renameSync(tmp, file);
    const check = readSettings(file);
    if (JSON.stringify(check) !== JSON.stringify(data)) throw new Error("written settings do not match");
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    if (backup) fs.copyFileSync(backup, file);
    throw new Error(`failed to update ${file} (${(err as Error).message}); original restored`);
  }
}

export interface ApplyResult {
  target: ConfigTarget;
  backup: string | null;
  changed: boolean;
}

export function installHooks(target: ConfigTarget, hookScript: string, backupDir: string, dryRun = false): ApplyResult {
  const settings = readSettings(target.settingsFile);
  const before = JSON.stringify(settings.hooks ?? {});
  const hooks = mergeOurHooks((settings.hooks ?? {}) as HooksSection, hookScript);
  const changed = JSON.stringify(hooks) !== before;
  if (dryRun || !changed) return { target, backup: null, changed };
  const backup = backupSettings(target, backupDir);
  writeValidated(target.settingsFile, { ...settings, hooks }, backup);
  return { target, backup, changed };
}

export function uninstallHooks(target: ConfigTarget, backupDir: string, dryRun = false): ApplyResult {
  if (!fs.existsSync(target.settingsFile)) return { target, backup: null, changed: false };
  const settings = readSettings(target.settingsFile);
  const current = (settings.hooks ?? {}) as HooksSection;
  const hooks = stripOurHooks(current);
  const changed = JSON.stringify(hooks) !== JSON.stringify(current);
  if (dryRun || !changed) return { target, backup: null, changed };
  const backup = backupSettings(target, backupDir);
  const next = { ...settings };
  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;
  writeValidated(target.settingsFile, next, backup);
  return { target, backup, changed };
}
