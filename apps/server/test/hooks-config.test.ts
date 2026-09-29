import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeTarget, detectConfigDirs, HOOK_PLAN, installHooks, uninstallHooks } from "../src/cli/hooks-config.js";
import { tempHome } from "./helpers.js";

const foreign = {
  PostToolUse: [{ matcher: "Write|Edit", hooks: [{ type: "command", command: "node graft-hooks.cjs post-edit", timeout: 10 }] }],
  Stop: [{ hooks: [{ type: "command", command: "node graft-hooks.cjs stop" }] }],
};

function setup(settings: Record<string, unknown> | null) {
  const home = tempHome();
  const dir = path.join(home, ".claude");
  fs.mkdirSync(dir, { recursive: true });
  if (settings) fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings, null, 2));
  return { home, dir, backups: path.join(home, "backups") };
}

const read = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));

describe("hook installation", () => {
  it("adds every hook, keeps unrelated hooks and settings, and backs up first", () => {
    const { dir, backups } = setup({ model: "opus", hooks: foreign });
    const r = installHooks(describeTarget(dir), "/opt/crewdesk/bin/crewdesk-hook.mjs", backups);
    expect(r.changed).toBe(true);
    expect(fs.readdirSync(backups)).toHaveLength(1);
    const s = read(dir);
    expect(s.model).toBe("opus");
    expect(s.hooks.PostToolUse).toEqual(foreign.PostToolUse);
    expect(s.hooks.Stop[0]).toEqual(foreign.Stop[0]);
    expect(s.hooks.Stop).toHaveLength(2);
    for (const p of HOOK_PLAN) {
      const ours = s.hooks[p.event].at(-1);
      expect(ours.hooks[0].command).toContain(`crewdesk-hook.mjs" ${p.sub}`);
      if (p.matcher) expect(ours.matcher).toBe(p.matcher);
    }
    expect(s.hooks.PreToolUse.at(-1).matcher).toBe("AskUserQuestion");
    expect(describeTarget(dir).installed).toBe(true);
  });

  it("is idempotent", () => {
    const { dir, backups } = setup({ hooks: foreign });
    installHooks(describeTarget(dir), "/x/crewdesk-hook.mjs", backups);
    const first = read(dir);
    const r = installHooks(describeTarget(dir), "/x/crewdesk-hook.mjs", backups);
    expect(r.changed).toBe(false);
    expect(read(dir)).toEqual(first);
  });

  it("creates settings.json when missing", () => {
    const { dir, backups } = setup(null);
    installHooks(describeTarget(dir), "/x/crewdesk-hook.mjs", backups);
    expect(Object.keys(read(dir).hooks)).toHaveLength(HOOK_PLAN.length);
  });

  it("uninstall removes only our hooks", () => {
    const { dir, backups } = setup({ hooks: foreign, theme: "dark" });
    installHooks(describeTarget(dir), "/x/crewdesk-hook.mjs", backups);
    uninstallHooks(describeTarget(dir), backups);
    expect(read(dir)).toEqual({ hooks: foreign, theme: "dark" });
  });

  it("refuses to touch invalid JSON", () => {
    const { dir, backups } = setup(null);
    fs.writeFileSync(path.join(dir, "settings.json"), "{ broken");
    expect(() => installHooks(describeTarget(dir), "/x/crewdesk-hook.mjs", backups)).toThrow();
    expect(fs.readFileSync(path.join(dir, "settings.json"), "utf8")).toBe("{ broken");
  });

  it("detects ~/.claude and account dirs", () => {
    const home = tempHome();
    for (const a of ["work", "personal"]) {
      fs.mkdirSync(path.join(home, ".claude-accounts", a), { recursive: true });
      fs.writeFileSync(path.join(home, ".claude-accounts", a, "settings.json"), "{}");
    }
    fs.mkdirSync(path.join(home, ".claude-accounts", "not-an-account"), { recursive: true });
    const dirs = detectConfigDirs(home, {});
    expect(dirs.map((d) => path.relative(home, d).replace(/\\/g, "/")).sort()).toEqual([
      ".claude",
      ".claude-accounts/personal",
      ".claude-accounts/work",
    ]);
  });
});
