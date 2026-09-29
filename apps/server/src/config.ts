import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { DEFAULT_HOST, DEFAULT_PORT } from "@cch/shared";

export const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const ConfigFileSchema = z
  .object({
    port: z.number().int().min(1).max(65535),
    host: z.string().min(1),
    database: z.string().min(1),
    heartbeatTimeout: z.number().int().min(1000),
    notifications: z.boolean(),
    sound: z.boolean(),
    logLevel: z.enum(LOG_LEVELS),
    /** How long (ms) a hook may be disconnected before its pending request is considered handled elsewhere. */
    waiterGraceMs: z.number().int().min(100),
    /** Whether the Stop hook should wait for a follow-up prompt from the dashboard. */
    idlePrompts: z.boolean(),
    /** Optional auto-expiry for pending permission requests (ms). 0 disables. */
    permissionExpiryMs: z.number().int().min(0),
  })
  .partial();

export interface HubConfig {
  home: string;
  port: number;
  host: string;
  database: string;
  heartbeatTimeout: number;
  notifications: boolean;
  sound: boolean;
  logLevel: LogLevel;
  waiterGraceMs: number;
  idlePrompts: boolean;
  permissionExpiryMs: number;
  policyFile: string;
  webDir: string | null;
  /** Secret required by the shutdown endpoint (written to hub.token by the daemon). */
  adminToken: string | null;
}

export function hubHome(): string {
  return process.env.CLAUDE_HUB_HOME ?? path.join(os.homedir(), ".claude-control-center");
}

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function configPath(home = hubHome()): string {
  return path.join(home, "config.json");
}

export function readConfigFile(home = hubHome()): z.infer<typeof ConfigFileSchema> {
  const file = configPath(home);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = ConfigFileSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (parsed.success) return parsed.data;
    process.stderr.write(`claude-hub: ignoring invalid config ${file}: ${parsed.error.message}\n`);
  } catch (err) {
    process.stderr.write(`claude-hub: cannot read config ${file}: ${(err as Error).message}\n`);
  }
  return {};
}

function envInt(name: string): number | undefined {
  const v = process.env[name];
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function envBool(name: string): boolean | undefined {
  const v = process.env[name];
  if (v === undefined || v === "") return undefined;
  return /^(1|true|yes|on)$/i.test(v);
}

/** Resolve configuration: defaults < config.json < environment < explicit overrides. */
export function loadConfig(overrides: Partial<HubConfig> = {}): HubConfig {
  const home = overrides.home ?? hubHome();
  const file = readConfigFile(home);
  const level = (process.env.LOG_LEVEL ?? process.env.CLAUDE_HUB_LOG_LEVEL)?.toLowerCase();
  const cfg: HubConfig = {
    home,
    port: envInt("CLAUDE_HUB_PORT") ?? file.port ?? DEFAULT_PORT,
    host: process.env.CLAUDE_HUB_HOST ?? file.host ?? DEFAULT_HOST,
    database: expandHome(process.env.CLAUDE_HUB_DB ?? file.database ?? path.join(home, "data.db")),
    heartbeatTimeout: envInt("CLAUDE_HUB_HEARTBEAT_TIMEOUT") ?? file.heartbeatTimeout ?? 30000,
    notifications: envBool("CLAUDE_HUB_NOTIFICATIONS") ?? file.notifications ?? true,
    sound: envBool("CLAUDE_HUB_SOUND") ?? file.sound ?? true,
    logLevel: (LOG_LEVELS as readonly string[]).includes(level ?? "")
      ? (level as LogLevel)
      : (file.logLevel ?? "info"),
    waiterGraceMs: envInt("CLAUDE_HUB_WAITER_GRACE") ?? file.waiterGraceMs ?? 5000,
    idlePrompts: envBool("CLAUDE_HUB_IDLE_PROMPTS") ?? file.idlePrompts ?? true,
    permissionExpiryMs: envInt("CLAUDE_HUB_PERMISSION_EXPIRY") ?? file.permissionExpiryMs ?? 0,
    policyFile: path.join(home, "policies.yaml"),
    webDir: null,
    adminToken: null,
    ...overrides,
  };
  return cfg;
}
