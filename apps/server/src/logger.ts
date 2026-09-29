import fs from "node:fs";
import path from "node:path";
import type { LogLevel } from "./config.js";

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface LogFields {
  sessionId?: string;
  eventId?: string;
  [key: string]: unknown;
}

export class Logger {
  private stream: fs.WriteStream | null = null;

  constructor(
    private level: LogLevel,
    logFile: string | null = null,
    private toConsole = true,
  ) {
    if (logFile) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      this.stream = fs.createWriteStream(logFile, { flags: "a" });
    }
  }

  error(msg: string, fields?: LogFields) {
    this.write("error", msg, fields);
  }
  warn(msg: string, fields?: LogFields) {
    this.write("warn", msg, fields);
  }
  info(msg: string, fields?: LogFields) {
    this.write("info", msg, fields);
  }
  debug(msg: string, fields?: LogFields) {
    this.write("debug", msg, fields);
  }

  private write(level: LogLevel, msg: string, fields?: LogFields) {
    if (ORDER[level] > ORDER[this.level]) return;
    const ts = new Date().toISOString();
    const ids = [fields?.sessionId, fields?.eventId].filter(Boolean).join(" ");
    const extra = fields
      ? Object.entries(fields)
          .filter(([k, v]) => k !== "sessionId" && k !== "eventId" && v !== undefined)
          .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
          .join(" ")
      : "";
    const line = `${ts} ${level.toUpperCase().padEnd(5)} ${msg}${ids ? " " + ids : ""}${extra ? " " + extra : ""}`;
    if (this.toConsole) (level === "error" ? process.stderr : process.stdout).write(line + "\n");
    this.stream?.write(line + "\n");
  }

  close() {
    this.stream?.end();
  }
}
