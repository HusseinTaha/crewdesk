import fs from "node:fs";
import YAML from "yaml";
import { globMatch, PolicyFileSchema, type PolicyRule } from "@crewdesk/shared";
import type { Logger } from "../logger.js";

export interface PolicyDecision {
  action: "allow" | "deny" | "ask";
  rule: PolicyRule;
}

/**
 * Permission policies from `policies.yaml` (or JSON with the same shape). Rules are evaluated in order,
 * first match wins. Nothing is auto-decided unless the user wrote a rule for it.
 */
export class PolicyService {
  private rules: PolicyRule[] = [];
  private mtimeMs = -1;
  private error: string | null = null;

  constructor(
    private file: string,
    private log: Logger,
  ) {}

  private reloadIfChanged() {
    let mtime = -2;
    try {
      mtime = fs.statSync(this.file).mtimeMs;
    } catch {
      /* missing file => no rules */
    }
    if (mtime === this.mtimeMs) return;
    this.mtimeMs = mtime;
    this.rules = [];
    this.error = null;
    if (mtime < 0) return;
    try {
      const raw = YAML.parse(fs.readFileSync(this.file, "utf8")) ?? {};
      const parsed = PolicyFileSchema.safeParse(raw);
      if (!parsed.success) {
        this.error = parsed.error.message;
        this.log.warn("Ignoring invalid policy file", { file: this.file, error: this.error });
        return;
      }
      this.rules = parsed.data.permissions;
      this.log.info("Loaded permission policies", { count: this.rules.length });
    } catch (err) {
      this.error = (err as Error).message;
      this.log.warn("Cannot read policy file", { file: this.file, error: this.error });
    }
  }

  list(): { file: string; rules: PolicyRule[]; error: string | null } {
    this.reloadIfChanged();
    return { file: this.file, rules: this.rules, error: this.error };
  }

  /**
   * @param destructive when true an `allow` rule is downgraded to `ask`: destructive operations always
   *   reach a human.
   */
  evaluate(toolName: string, summary: string, destructive = false): PolicyDecision | null {
    this.reloadIfChanged();
    for (const rule of this.rules) {
      if (rule.tool && !globMatch(rule.tool, toolName)) continue;
      if (!globMatch(rule.match, summary)) continue;
      if (rule.action === "allow" && (destructive || chainsCommands(toolName, summary))) {
        return { action: "ask", rule };
      }
      return { action: rule.action, rule };
    }
    return null;
  }
}

/** A glob like "npm install *" must not auto-allow "npm install x && rm -rf ~". */
function chainsCommands(toolName: string, summary: string): boolean {
  if (toolName !== "Bash" && toolName !== "PowerShell") return false;
  return /&&|\|\||[;|`\n]|\$\(|>|</.test(summary);
}
