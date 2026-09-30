import { exec, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { configPath, loadConfig, readConfigFile, setConfigValue, type HubConfig } from "./config.js";
import { accessTokenFile, ensureAccessToken, isLoopbackHost, loginUrls } from "./auth.js";
import { authHeaders, baseUrl, health, logFile, readPid, runForeground, startDaemon, stopDaemon } from "./cli/daemon.js";
import {
  describeTarget,
  detectConfigDirs,
  installHooks,
  uninstallHooks,
  type ConfigTarget,
} from "./cli/hooks-config.js";
import { VERSION } from "./version.js";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repo/package root: works from src/ (tsx) and dist/ (bundle), both two levels under apps/server. */
const root = path.resolve(here, "../../..");
const cliScript = process.env.CREWDESK_CLI_SCRIPT ?? path.join(root, "bin", "crewdesk.mjs");
const hookScript = process.env.CREWDESK_HOOK_SCRIPT ?? path.join(root, "bin", "crewdesk-hook.mjs");
const webDir = process.env.CREWDESK_WEB_DIR ?? path.join(root, "apps", "web", "dist");

const c = {
  ok: (s: string) => `\x1b[32m✓\x1b[0m ${s}`,
  bad: (s: string) => `\x1b[31m✗\x1b[0m ${s}`,
  warn: (s: string) => `\x1b[33m!\x1b[0m ${s}`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

const HELP = `Crewdesk ${VERSION}

Usage: crewdesk <command> [options]

Commands:
  start [--foreground]   Start the hub (background daemon by default)
      --remote | --local         listen on the network with the access token, or on 127.0.0.1 only (saved)
  stop                   Stop the hub
  restart [--remote|--local]  Restart the hub
  token [--rotate]       Print remote-mode login URLs (--rotate: new token, restarts the hub)
  status                 Show hub status, agents and pending requests
  open                   Open the dashboard in the browser
  logs [-f] [-n N]       Show the hub log
  configure              Install Claude Code hooks (backs up settings first)
      --all | --dir <path> ...   choose config dirs non-interactively
      --dry-run                  show what would change
  doctor                 Diagnose the installation
  uninstall              Remove hooks and optionally the database

Environment: CREWDESK_HOME, CREWDESK_PORT, CREWDESK_HOST, CREWDESK_REMOTE, CREWDESK_DB,
             CREWDESK_HEARTBEAT_TIMEOUT, LOG_LEVEL
`;

function flag(args: string[], name: string) {
  return args.includes(name);
}
function flagValues(args: string[], name: string): string[] {
  const out: string[] = [];
  args.forEach((a, i) => {
    if (a === name && args[i + 1]) out.push(args[i + 1]!);
  });
  return out;
}

async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) return "";
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function confirm(question: string, dflt = true): Promise<boolean> {
  const a = (await ask(`${question} ${dflt ? "[Y/n]" : "[y/N]"} `)).toLowerCase();
  if (!a) return dflt;
  return a.startsWith("y");
}

function openBrowser(url: string) {
  const cmd =
    process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  console.log(`Opening ${url}`);
  // Headless Linux often has no xdg-open (or no display): fall back to printing the URL.
  exec(cmd, (err) => {
    if (err) console.log(`Could not open a browser. Visit ${url}`);
  });
}

async function cmdStart(cfg: HubConfig, args: string[]) {
  if (flag(args, "--foreground")) {
    const daemon = flag(args, "--daemon");
    if (!daemon) console.log(c.bold("Crewdesk"));
    await runForeground({ ...cfg, webDir }, { daemon });
    if (!daemon) {
      printDashboard(cfg);
      console.log("Waiting for Claude Code sessions... (Ctrl+C to stop)");
    }
    return;
  }
  if (cfg.remote) ensureAccessToken(cfg.home);
  const { pid, already } = await startDaemon(cfg, cliScript);
  console.log(c.bold("Crewdesk\n"));
  if (already) console.log(c.ok(`Already running (pid ${pid})`));
  else {
    console.log(c.ok("Server started"));
    console.log(c.ok("Database ready"));
    console.log(c.ok("WebSocket ready"));
  }
  if (!fs.existsSync(path.join(webDir, "index.html"))) console.log(c.warn("Web UI not built — run `pnpm build`"));
  printDashboard(cfg);
  if (!already) console.log("Waiting for Claude Code sessions...");
}

/** Dashboard URL in local mode; the remote-mode warning and login URLs otherwise. */
function printDashboard(cfg: HubConfig) {
  if (!cfg.remote) {
    console.log(`\nDashboard:\n${baseUrl(cfg)}\n`);
    return;
  }
  const token = ensureAccessToken(cfg.home);
  console.log(`\n${c.warn(`Remote mode: listening on ${cfg.host}:${cfg.port}. Anyone with the token can approve commands.`)}`);
  console.log("\nSign in from another machine with:");
  for (const url of loginUrls(cfg.host, cfg.port, token)) console.log(`  ${url}`);
  console.log(c.dim("\nThis is plain HTTP: use it on a trusted network, or put HTTPS, a VPN or an SSH tunnel in front."));
  console.log(c.dim("`crewdesk token` prints these again; `crewdesk token --rotate` signs every browser out.\n"));
}

async function cmdToken(cfg: HubConfig, args: string[]) {
  if (!cfg.remote) {
    console.log("Remote mode is off: the hub only listens on 127.0.0.1 and needs no token.");
    console.log(`Turn it on with \`crewdesk restart --remote\`, or set "remote": true in ${configPath(cfg.home)}.`);
    return;
  }
  if (flag(args, "--rotate")) {
    ensureAccessToken(cfg.home, true);
    console.log(c.ok("New access token created; existing browser sessions are signed out."));
    if (await health(cfg)) {
      await stopDaemon(cfg);
      await startDaemon(cfg, cliScript);
      console.log(c.ok("Hub restarted with the new token"));
    }
  }
  printDashboard(cfg);
}

async function cmdStatus(cfg: HubConfig) {
  const h = await health(cfg);
  if (!h) {
    console.log(c.bad(`Hub is not running on ${baseUrl(cfg)}`));
    process.exitCode = 1;
    return;
  }
  console.log(c.ok(`Hub running (pid ${h.pid}, up ${h.uptime}s, v${h.version}) — ${baseUrl(cfg)}`));
  if (h.remote) console.log(c.warn(`Remote mode on port ${cfg.port}: access token required (\`crewdesk token\` prints the login URLs)`));
  const headers = authHeaders(cfg);
  const getJson = async <T,>(url: string): Promise<T | null> => {
    const r = await fetch(`${baseUrl(cfg)}${url}`, { headers });
    return r.ok ? ((await r.json()) as T) : null;
  };
  const [agents, pending] = await Promise.all([getJson<{ agents: any[] }>("/api/agents"), getJson<{ events: any[] }>("/api/events/pending")]);
  if (!agents || !pending) {
    console.log(c.bad("The hub rejected the request: the access token is missing or was rotated. Run `crewdesk restart`."));
    process.exitCode = 1;
    return;
  }
  const online = agents.agents.filter((a) => a.status !== "OFFLINE");
  console.log(`\n${online.length} active agent(s), ${pending.events.length} need attention\n`);
  for (const a of agents.agents) {
    console.log(`  ${a.status.padEnd(10)} ${a.name.padEnd(28)} ${c.dim(a.cwd ?? "")}${a.pendingCount ? `  (${a.pendingCount} pending)` : ""}`);
  }
}

async function cmdLogs(cfg: HubConfig, args: string[]) {
  const file = logFile(cfg);
  if (!fs.existsSync(file)) {
    console.log(`No log yet at ${file}`);
    return;
  }
  const n = Number(flagValues(args, "-n")[0] ?? 100);
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  process.stdout.write(lines.slice(-n - 1).join("\n"));
  if (!flag(args, "-f")) return;
  let size = fs.statSync(file).size;
  fs.watchFile(file, { interval: 500 }, (cur) => {
    if (cur.size < size) size = 0;
    if (cur.size === size) return;
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(cur.size - size);
    fs.readSync(fd, buf, 0, buf.length, size);
    fs.closeSync(fd);
    size = cur.size;
    process.stdout.write(buf.toString("utf8"));
  });
  await new Promise(() => {});
}

async function chooseTargets(args: string[], purpose: "install" | "remove"): Promise<ConfigTarget[]> {
  const explicit = flagValues(args, "--dir");
  if (explicit.length) return explicit.map((d) => describeTarget(path.resolve(d)));
  const all = detectConfigDirs().map((d) => describeTarget(d));
  const candidates = purpose === "remove" ? all.filter((t) => t.installed) : all;
  if (flag(args, "--all") || flag(args, "--yes") || !process.stdin.isTTY) return candidates;
  if (candidates.length === 0) return [];
  console.log(`Detected Claude Code configuration directories:\n`);
  candidates.forEach((t, i) =>
    console.log(`  [${i + 1}] ${t.label.padEnd(40)} ${t.installed ? c.dim("(hooks installed)") : t.exists ? "" : c.dim("(new)")}`),
  );
  const answer = await ask(`\nWhich should ${purpose === "install" ? "get" : "lose"} the hooks? (e.g. 1,3 — Enter for all, 0 for none) `);
  if (!answer) return candidates;
  if (answer === "0") return [];
  const picked = new Set(answer.split(/[ ,]+/).map((s) => Number(s) - 1));
  return candidates.filter((_, i) => picked.has(i));
}

async function cmdConfigure(cfg: HubConfig, args: string[]) {
  fs.mkdirSync(cfg.home, { recursive: true });
  if (!fs.existsSync(configPath(cfg.home))) {
    const initial = { port: cfg.port, host: cfg.host, heartbeatTimeout: cfg.heartbeatTimeout, notifications: true, sound: true };
    fs.writeFileSync(configPath(cfg.home), JSON.stringify(initial, null, 2) + "\n");
    console.log(c.ok(`Created ${configPath(cfg.home)}`));
  }
  const policy = cfg.policyFile;
  if (!fs.existsSync(policy)) {
    fs.writeFileSync(
      policy,
      `# Permission policies for Crewdesk. First matching rule wins.\n# action: allow | deny | ask. Destructive or chained commands are never auto-allowed.\npermissions: []\n#  - tool: "Bash"\n#    match: "git status"\n#    action: allow\n`,
    );
  }
  if (!fs.existsSync(hookScript)) console.log(c.warn(`Hook script not found at ${hookScript} — run \`pnpm build\``));
  const targets = await chooseTargets(args, "install");
  if (targets.length === 0) {
    console.log("No configuration directories selected.");
    return;
  }
  const dry = flag(args, "--dry-run");
  const backups = path.join(cfg.home, "backups");
  for (const t of targets) {
    try {
      const r = installHooks(t, hookScript, backups, dry);
      const note = !r.changed ? "already up to date" : dry ? "would install hooks" : "hooks installed";
      console.log(c.ok(`${t.label}: ${note}${r.backup ? c.dim(` (backup ${path.basename(r.backup)})`) : ""}`));
    } catch (err) {
      console.log(c.bad(`${t.label}: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  }
  if (!dry) console.log(`\nRestart running Claude Code sessions (or run /hooks) to pick up the new hooks.`);
}

async function cmdUninstall(cfg: HubConfig, args: string[]) {
  const targets = await chooseTargets(args, "remove");
  const backups = path.join(cfg.home, "backups");
  for (const t of targets) {
    try {
      const r = uninstallHooks(t, backups, flag(args, "--dry-run"));
      console.log(c.ok(`${t.label}: ${r.changed ? "hooks removed" : "no hooks found"}`));
    } catch (err) {
      console.log(c.bad(`${t.label}: ${(err as Error).message}`));
    }
  }
  if (readPid(cfg)) {
    await stopDaemon(cfg);
    console.log(c.ok("Hub stopped"));
  }
  const deleteDb = flag(args, "--delete-data") || (!flag(args, "--keep-data") && (await confirm("Delete the database and event history?", false)));
  if (deleteDb) {
    for (const f of [cfg.database, `${cfg.database}-wal`, `${cfg.database}-shm`]) fs.rmSync(f, { force: true });
    console.log(c.ok("Database deleted"));
  } else console.log(c.ok(`Database kept at ${cfg.database}`));
  console.log(`\nTo remove the application: npm rm -g crewdesk (or pnpm unlink --global).`);
}

async function cmdDoctor(cfg: HubConfig) {
  console.log(c.bold("Crewdesk Doctor\n"));
  let problems = 0;
  const check = (ok: boolean, label: string, hint?: string) => {
    console.log(ok ? c.ok(label) : c.bad(`${label}${hint ? c.dim(` — ${hint}`) : ""}`));
    if (!ok) problems++;
  };
  const [major, minor] = process.versions.node.split(".").map(Number) as [number, number];
  check(major > 22 || (major === 22 && minor >= 13), `Node.js ${process.versions.node}`, "Node >= 22.13 required (node:sqlite)");
  let sqliteOk = false;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    new DatabaseSync(":memory:").close();
    sqliteOk = true;
  } catch {
    /* no sqlite */
  }
  check(sqliteOk, "SQLite");
  let dbOk = false;
  try {
    fs.mkdirSync(path.dirname(cfg.database), { recursive: true });
    fs.accessSync(path.dirname(cfg.database), fs.constants.W_OK);
    dbOk = true;
  } catch {
    /* not writable */
  }
  check(dbOk, `Database ${cfg.database}`, "directory not writable");
  const h = await health(cfg);
  check(Boolean(h), `Server ${baseUrl(cfg)}`, "not running — `crewdesk start`");
  if (h) check(h.database === "ok", `Port ${cfg.port} (hub pid ${h.pid})`);
  else {
    const net = await import("node:net");
    const free = await new Promise<boolean>((resolve) => {
      const s = net.createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true)));
      s.listen(cfg.port, cfg.host);
    });
    check(free, `Port ${cfg.port}`, "in use by another program");
  }
  let claudeVersion = "";
  try {
    claudeVersion = execSync("claude --version", { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    /* not found */
  }
  check(Boolean(claudeVersion), `Claude Code detected${claudeVersion ? ` (${claudeVersion})` : ""}`, "`claude` not on PATH");
  const targets = detectConfigDirs().map((d) => describeTarget(d));
  const installed = targets.filter((t) => t.installed);
  check(installed.length > 0, `Hook configuration (${installed.map((t) => t.label).join(", ") || "none"})`, "run `crewdesk configure`");
  for (const t of targets.filter((t) => !t.installed)) console.log(c.dim(`    not installed in ${t.label}`));
  check(fs.existsSync(hookScript) && fs.existsSync(path.join(root, "packages", "hook", "dist", "hook.js")), "Hook executable", "run `pnpm build`");
  check(fs.existsSync(path.join(webDir, "index.html")), "Web UI build", "run `pnpm build`");
  if (cfg.remote) {
    check(fs.existsSync(accessTokenFile(cfg.home)), `Remote mode on ${cfg.host}:${cfg.port} (token auth)`, "no access token yet: `crewdesk start` creates it");
  }
  console.log(problems ? `\n${problems} problem(s) found.` : "\nEverything looks good.");
  if (problems) process.exitCode = 1;
}

async function firstRun(cfg: HubConfig) {
  console.log(c.bold("Welcome to Crewdesk\n"));
  console.log("This will:\n");
  console.log("  ✓ Create a local database");
  console.log("  ✓ Configure Claude Code hooks");
  console.log("  ✓ Start the local server");
  console.log("  ✓ Open the dashboard\n");
  if (!(await confirm("Continue?"))) return;
  await cmdConfigure(cfg, []);
  await cmdStart(cfg, []);
  openBrowser(baseUrl(cfg));
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...args] = argv;
  // --remote / --local are saved to config.json, so status, token, restart and the hooks all agree
  // with the running hub.
  if ((cmd === "start" || cmd === "restart") && (args.includes("--remote") || args.includes("--local"))) {
    const remote = args.includes("--remote");
    // --local also drops a saved network host; otherwise that host would keep remote mode on.
    const savedHost = readConfigFile().host;
    if (!remote && savedHost && !isLoopbackHost(savedHost)) setConfigValue("host", "127.0.0.1");
    setConfigValue("remote", remote);
    // A running hub keeps its current mode until it restarts.
    const running = cmd === "start" ? await health(loadConfig()) : null;
    if (running && running.remote !== remote) {
      console.log(c.warn(`Saved "remote": ${remote}. Run \`crewdesk restart\` to apply it to the running hub.`));
    }
  }
  const cfg = loadConfig();
  switch (cmd) {
    case "start":
      return cmdStart(cfg, args);
    case "stop":
      console.log((await stopDaemon(cfg)) ? c.ok("Hub stopped") : "Hub is not running.");
      return;
    case "restart":
      await stopDaemon(cfg);
      return cmdStart(cfg, args);
    case "status":
      return cmdStatus(cfg);
    case "open":
      if (!(await health(cfg))) await cmdStart(cfg, []);
      // In remote mode the local browser needs the token too, so open the login URL.
      openBrowser(cfg.remote ? `${baseUrl(cfg)}/?token=${encodeURIComponent(ensureAccessToken(cfg.home))}` : baseUrl(cfg));
      return;
    case "token":
      return cmdToken(cfg, args);
    case "logs":
      return cmdLogs(cfg, args);
    case "configure":
      return cmdConfigure(cfg, args);
    case "doctor":
      return cmdDoctor(cfg);
    case "uninstall":
      return cmdUninstall(cfg, args);
    case "--version":
    case "-v":
      console.log(VERSION);
      return;
    case undefined:
      if (!fs.existsSync(configPath(cfg.home)) && process.stdin.isTTY) return firstRun(cfg);
      console.log(HELP);
      return;
    default:
      console.log(HELP);
      if (cmd !== "help" && cmd !== "--help" && cmd !== "-h") process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly || process.env.CREWDESK_RUN_CLI === "1") {
  main().catch((err) => {
    console.error(c.bad((err as Error).message));
    process.exit(1);
  });
}
