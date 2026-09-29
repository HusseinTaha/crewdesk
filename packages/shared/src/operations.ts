/** Helpers for describing tool operations and classifying risk. Shared by server, hook and UI. */

export function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  switch (toolName) {
    case "Bash":
    case "PowerShell":
      return str("command") ?? "";
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "Read":
    case "NotebookEdit":
      return str("file_path") ?? str("notebook_path") ?? "";
    case "WebFetch":
      return str("url") ?? "";
    case "WebSearch":
      return str("query") ?? "";
    case "Glob":
    case "Grep":
      return str("pattern") ?? "";
    default: {
      const json = JSON.stringify(input);
      return json.length > 500 ? json.slice(0, 497) + "..." : json;
    }
  }
}

const DESTRUCTIVE_PATTERNS: Array<[RegExp, string]> = [
  [/\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i, "Recursive or forced file deletion"],
  [/\brm\s+/i, "Deletes files"],
  [/\bRemove-Item\b/i, "Deletes files"],
  [/\b(del|erase|rmdir|rd)\s+/i, "Deletes files"],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+(.*\s)?(-f|--force)|branch\s+-D|checkout\s+--\s)/i, "Discards git history or changes"],
  [/\b(drop|truncate)\s+(table|database|schema)\b/i, "Drops database objects"],
  [/\bdelete\s+from\b/i, "Deletes database rows"],
  [/\bmkfs\b|\bformat\s+[a-z]:/i, "Formats a filesystem"],
  [/\bdd\s+if=/i, "Raw disk write"],
  [/\bchmod\s+-R\b|\bchown\s+-R\b/i, "Recursive permission change"],
  [/>\s*\/dev\/sd[a-z]/i, "Writes to a block device"],
  [/\b(shutdown|reboot|Stop-Computer|Restart-Computer)\b/i, "Shuts down or restarts the machine"],
  [/\bkill(all)?\s+-9\b|\bStop-Process\b|\btaskkill\b/i, "Kills processes"],
  [/\bnpm\s+publish\b|\bpnpm\s+publish\b/i, "Publishes a package"],
];

export interface RiskAssessment {
  destructive: boolean;
  reason?: string;
}

export function assessRisk(toolName: string, input: Record<string, unknown>): RiskAssessment {
  if (toolName === "Bash" || toolName === "PowerShell") {
    const cmd = typeof input.command === "string" ? input.command : "";
    for (const [re, reason] of DESTRUCTIVE_PATTERNS) {
      if (re.test(cmd)) return { destructive: true, reason };
    }
  }
  return { destructive: false };
}

/** Minimal glob: `*` matches any run of characters, `?` a single character. Case-sensitive. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (const ch of glob) {
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "s");
}

export function globMatch(glob: string, value: string): boolean {
  return globToRegExp(glob).test(value);
}
