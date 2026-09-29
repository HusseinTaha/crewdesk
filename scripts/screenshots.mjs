#!/usr/bin/env node
// Regenerates the README screenshots in docs/images/ from a throwaway hub seeded with made-up sessions.
// Usage: pnpm build && node scripts/screenshots.mjs
// Nothing here touches your real ~/.crewdesk or Claude config: HOME, port and project paths are all fake.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "docs", "images");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "crewdesk-shots-"));
const PORT = 7797;
const HUB = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, CREWDESK_HOME: home, CREWDESK_PORT: String(PORT), CREWDESK_URL: HUB, LOG_LEVEL: "warn" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });

// ---------- hub + fake sessions ----------

const hub = spawn(process.execPath, [path.join(root, "bin/crewdesk.mjs"), "start", "--foreground"], { env, stdio: "ignore" });
const children = [hub];
const cleanup = () => {
  for (const c of children) c.kill();
  try {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* the hub may still hold the database open on Windows; it is only a temp dir */
  }
};
process.on("uncaughtException", (err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
for (let i = 0; i < 100; i++) {
  if (await fetch(`${HUB}/health`).then((r) => r.ok, () => false)) break;
  await sleep(100);
}

/** Run the real hook bridge as a fake Claude Code session. Waiting hooks (permission/question/stop) stay open. */
function hook(sub, s, input = {}) {
  const child = spawn(process.execPath, [path.join(root, "bin/crewdesk-hook.mjs"), sub], {
    env: {
      ...env,
      CLAUDE_PID: String(process.pid),
      CLAUDE_PROJECT_DIR: `/home/dev/projects/${s.project}`,
      CLAUDE_CONFIG_DIR: s.account ? `/home/dev/.claude-accounts/${s.account}` : "",
    },
    stdio: ["pipe", "ignore", "ignore"],
  });
  children.push(child);
  child.stdin.end(JSON.stringify({ session_id: s.id, cwd: `/home/dev/projects/${s.project}`, ...input }));
  return new Promise((resolve) => {
    child.on("exit", resolve);
    if (["permission", "question", "stop"].includes(sub)) setTimeout(resolve, 700);
  });
}

const S = {
  api: { id: "demo-payments-1", project: "payments-api", account: "work" },
  web1: { id: "demo-storefront-1", project: "storefront-web", account: "work" },
  web2: { id: "demo-storefront-2", project: "storefront-web", account: "work" },
  mobile: { id: "demo-mobile-1", project: "mobile-app", account: "personal" },
  infra: { id: "demo-infra-1", project: "infra", account: "work" },
  docs: { id: "demo-docs-1", project: "docs-site", account: "personal" },
};
for (const s of Object.values(S)) {
  await hook("register", s, { hook_event_name: "SessionStart", source: "startup" });
  await sleep(150);
}

await hook("prompt", S.docs, { prompt: "Fix the broken links in the getting-started guide" });
await hook("stop", S.docs, { hook_event_name: "Stop", last_assistant_message: "Fixed 4 broken links in getting-started.md." });
await hook("session-end", S.docs, { hook_event_name: "SessionEnd", reason: "exit" });

await hook("prompt", S.infra, { prompt: "Bump the Terraform AWS provider to v6 and run a plan" });
await hook("prompt", S.web2, { prompt: "Add a dark mode toggle to the settings page" });
await hook("prompt", S.mobile, { prompt: "Run the test suite and fix any failures" });
await hook("prompt", S.web1, { prompt: "Move the cart to a global store so the header badge updates live" });
await hook("prompt", S.api, { prompt: "Add idempotency keys to the refunds endpoint" });
await sleep(1200);

await hook("stop", S.mobile, {
  hook_event_name: "Stop",
  last_assistant_message:
    "All 212 tests pass now. Two failures in auth.test.ts came from an expired fixture token; I regenerated it and made the fixture build its expiry from the current date so it can't go stale again.",
});
await sleep(600);
await hook("question", S.web1, {
  hook_event_name: "PreToolUse",
  tool_name: "AskUserQuestion",
  tool_input: {
    questions: [
      {
        question: "Which state library should the cart use?",
        header: "State",
        multiSelect: false,
        options: [
          { label: "Zustand", description: "Tiny, hook-based, no provider needed" },
          { label: "Redux Toolkit", description: "Matches the admin app, more boilerplate" },
          { label: "React Context", description: "No new dependency, re-renders more" },
        ],
      },
    ],
  },
});
await sleep(600);
await hook("notification", S.infra, { hook_event_name: "Notification", notification_type: "info", message: "terraform plan finished: 3 to add, 1 to change, 0 to destroy" });
await sleep(600);
await hook("permission", S.api, {
  hook_event_name: "PermissionRequest",
  tool_name: "Bash",
  tool_input: { command: "rm -rf dist && pnpm build && pnpm test --filter refunds", description: "Clean build and run refund tests" },
});
await sleep(1500);

// ---------- screenshots ----------

const browser = await chromium.launch();
const shots = [];

async function open(viewport, { theme = "dark", scale = 2, hash = "" } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: theme });
  await ctx.addInitScript((t) => {
    localStorage.setItem("crewdesk.prefs", JSON.stringify({ theme: t, sound: false, desktop: true, groupByProject: false }));
  }, theme);
  const page = await ctx.newPage();
  await page.goto(`${HUB}/${hash}`);
  await page.waitForSelector(hash ? "table tbody tr" : '[data-testid="agent-card"]');
  await page.waitForTimeout(800);
  return page;
}
async function shot(page, name, target) {
  const file = path.join(out, `${name}.png`);
  await (target ?? page).screenshot({ path: file, animations: "disabled" });
  shots.push(path.relative(root, file));
}
const card = (page, type) => page.locator(`[data-testid="request-card"][data-type="${type}"]`).first();

// Full dashboard, dark and light.
let page = await open({ width: 1440, height: 900 });
await shot(page, "dashboard-dark");
// Individual cards.
await shot(page, "permission", card(page, "permission.created"));
await shot(page, "question", card(page, "question.created"));
const idle = card(page, "prompt.created");
await idle.locator('[data-testid="response-input"]').fill("Great. Now add a regression test for the expired-token case.");
await shot(page, "waiting", idle);
await page.keyboard.press("Escape");
await page.locator("body").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("?");
await page.waitForTimeout(300);
await shot(page, "shortcuts");
await page.context().close();

page = await open({ width: 1440, height: 900 }, { theme: "light" });
await shot(page, "dashboard-light");
await page.context().close();

// History and agent detail.
page = await open({ width: 1440, height: 900 }, { hash: "#/history" });
await page.waitForTimeout(500);
await shot(page, "history");
await page.goto(`${HUB}/`);
await page.waitForSelector('[data-testid="agent-card"]');
await page.locator('[data-testid="agent-card"]', { hasText: "payments-api" }).first().click();
await page.waitForTimeout(800);
await shot(page, "agent-detail");
await page.context().close();

// Phone.
page = await open({ width: 390, height: 844 }, { scale: 3 });
await shot(page, "mobile");
await page.context().close();

// Desktop notification: intercept the real Notification call and draw its exact title/body on the page
// (headless Chrome has no OS notification centre to capture).
page = await (async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
  await ctx.addInitScript(() => {
    localStorage.setItem("crewdesk.prefs", JSON.stringify({ theme: "dark", sound: false, desktop: true, groupByProject: false }));
    let visibility = "visible";
    Object.defineProperty(document, "visibilityState", { get: () => visibility });
    window.__hide = () => (visibility = "hidden");
    window.__show = () => (visibility = "visible");
    class FakeNotification {
      static permission = "granted";
      static requestPermission = async () => "granted";
      constructor(title, opts = {}) {
        window.__show();
        const el = document.createElement("div");
        el.setAttribute("data-testid", "toast");
        el.style.cssText =
          "position:fixed;right:24px;bottom:24px;z-index:9999;width:380px;display:flex;gap:12px;padding:14px 16px;border-radius:12px;" +
          "background:#1f2430;color:#f4f7fa;box-shadow:0 12px 40px rgba(0,0,0,.55);border:1px solid #333b4a;font:13px/1.45 Inter,system-ui,sans-serif";
        el.innerHTML =
          `<img src="/favicon.svg" style="width:36px;height:36px;flex:none;border-radius:8px">` +
          `<div style="min-width:0"><div style="font-size:11px;color:#8b95a5;margin-bottom:2px">Crewdesk · 127.0.0.1</div>` +
          `<div data-t style="font-weight:600;margin-bottom:2px"></div><div data-b style="color:#c8cfda;white-space:pre-line"></div></div>`;
        el.querySelector("[data-t]").textContent = title;
        el.querySelector("[data-b]").textContent = opts.body ?? "";
        document.body.appendChild(el);
      }
      close() {}
    }
    window.Notification = FakeNotification;
  });
  const p = await ctx.newPage();
  await p.goto(`${HUB}/`);
  await p.waitForSelector('[data-testid="agent-card"]');
  await p.waitForTimeout(800);
  return p;
})();
await page.evaluate(() => window.__hide());
await hook("permission", S.web2, {
  hook_event_name: "PermissionRequest",
  tool_name: "Bash",
  tool_input: { command: "git push origin feature/dark-mode" },
});
await page.waitForSelector('[data-testid="toast"]', { timeout: 10000 });
await page.waitForTimeout(400);
await shot(page, "notification");
await page.context().close();

await browser.close();
cleanup();
console.log(shots.map((s) => `  ${s}`).join("\n"));
process.exit(0);
