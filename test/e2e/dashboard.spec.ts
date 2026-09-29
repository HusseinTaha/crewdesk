import { expect, test } from "@playwright/test";
import { HUB, hook, permission, question, register, resetHub } from "./fixtures";

test.beforeEach(async () => {
  await resetHub();
});

const card = (page: import("@playwright/test").Page, type: string) => page.locator(`[data-testid="request-card"][data-type="${type}"]`);

test("shows four agents and updates in real time without refresh", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("connection")).toHaveText("Connected");
  for (const [i, p] of ["api", "frontend", "backend", "mobile"].entries()) await register(`e2e-${i}`, p);
  await expect(page.getByTestId("agent-card")).toHaveCount(4);
  await expect(page.getByTestId("agent-count")).toHaveText("4 Agents");
  await expect(page.getByTestId("agent-name")).toContainText(["api #1", "frontend #1", "backend #1", "mobile #1"]);
});

test("acceptance: question answered and permission allowed reach the right sessions", async ({ page }) => {
  await page.goto("/");
  for (const [i, p] of ["api", "frontend", "backend", "mobile"].entries()) await register(`acc-${i + 1}`, p);

  const q = question("acc-2", "frontend", "Which database should I use?", ["PostgreSQL", "MySQL", "SQLite"]);
  const perm = permission("acc-3", "backend", "npm install zod");
  const other = question("acc-1", "api", "Unrelated question?", ["Yes", "No"]);

  await expect(page.getByTestId("attention-count")).toHaveText("3 Need Attention");
  // Permissions sort first.
  await expect(page.getByTestId("request-card").first()).toHaveAttribute("data-type", "permission.created");

  const qCard = page.getByTestId("request-card").filter({ hasText: "Which database should I use?" });
  await qCard.getByRole("button", { name: "PostgreSQL" }).click();
  const qOut = JSON.parse((await q.done).stdout);
  expect(qOut.hookSpecificOutput.updatedInput.answers).toEqual({ "Which database should I use?": "PostgreSQL" });

  const pCard = card(page, "permission.created");
  await expect(pCard).toContainText("npm install zod");
  await expect(pCard).toContainText("backend #1");
  await pCard.getByRole("button", { name: /Allow/ }).click();
  expect(JSON.parse((await perm.done).stdout).hookSpecificOutput.decision.behavior).toBe("allow");

  // The unrelated question for Claude #1 is untouched.
  await expect(page.getByTestId("attention-count")).toHaveText("1 Need Attention");
  await expect(page.getByTestId("request-card")).toContainText("Unrelated question?");
  await expect(page.getByTestId("activity-feed")).toContainText("Permission approved");
  other.kill();
});

test("destructive permission needs a second confirmation; deny via keyboard", async ({ page }) => {
  await page.goto("/");
  await register("d-1", "frontend");
  const run = permission("d-1", "frontend", "rm -rf ./build");
  const c = card(page, "permission.created");
  await expect(c).toContainText("rm -rf ./build");
  await expect(c).toContainText("CRITICAL");
  await c.getByRole("button", { name: /Allow/ }).click();
  await expect(c.getByRole("button", { name: "Confirm Allow" })).toBeVisible();
  await c.getByRole("button", { name: "Back" }).click();
  await page.locator("body").click({ position: { x: 5, y: 200 } });
  await page.keyboard.press("d");
  const out = JSON.parse((await run.done).stdout);
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
});

test("keyboard: J/K move selection, A allows the selected request", async ({ page }) => {
  await page.goto("/");
  await register("k-1", "one");
  await register("k-2", "two");
  const p1 = permission("k-1", "one", "npm test");
  await expect(card(page, "permission.created")).toHaveCount(1);
  const p2 = permission("k-2", "two", "npm run build");
  await expect(card(page, "permission.created")).toHaveCount(2);
  await page.keyboard.press("j");
  await page.keyboard.press("a");
  expect(JSON.parse((await p2.done).stdout).hookSpecificOutput.decision.behavior).toBe("allow");
  await expect(card(page, "permission.created")).toHaveCount(1);
  await page.keyboard.press("k");
  await page.keyboard.press("a");
  expect(JSON.parse((await p1.done).stdout).hookSpecificOutput.decision.behavior).toBe("allow");
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("idle follow-up: send the next instruction to a finished session", async ({ page }) => {
  await page.goto("/");
  await register("i-1", "mobile");
  const stop = hook("stop", "i-1", "mobile", { hook_event_name: "Stop", last_assistant_message: "I finished the login screen." });
  const c = card(page, "prompt.created");
  await expect(c).toContainText("I finished the login screen.");
  await c.getByTestId("response-input").fill("Now add unit tests");
  await c.getByRole("button", { name: "Send", exact: true }).click();
  expect(JSON.parse((await stop.done).stdout)).toEqual({ decision: "block", reason: "Now add unit tests" });
});

test("custom free-text answer and 'answer in terminal'", async ({ page }) => {
  await page.goto("/");
  await register("f-1", "api");
  const q1 = question("f-1", "api", "Which cache?", ["Redis", "In-memory"]);
  const c = card(page, "question.created");
  await c.getByTestId("response-input").fill("Use Redis with a 5 minute TTL");
  await c.getByRole("button", { name: "Send Answer" }).click();
  expect(JSON.parse((await q1.done).stdout).hookSpecificOutput.updatedInput.answers).toEqual({ "Which cache?": "Use Redis with a 5 minute TTL" });

  const q2 = question("f-1", "api", "Second?", ["x", "y"]);
  await card(page, "question.created").getByRole("button", { name: "Answer in terminal" }).click();
  expect((await q2.done).stdout).toBe("");
});

test("answered in the terminal first: card disappears", async ({ page }) => {
  await page.goto("/");
  await register("t-1", "api");
  const run = permission("t-1", "api", "git push");
  await expect(card(page, "permission.created")).toHaveCount(1);
  run.kill(); // Claude Code kills the hook when the user answers its own dialog
  await expect(card(page, "permission.created")).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByTestId("activity-feed")).toBeVisible();
});

test("pending requests survive a browser refresh", async ({ page }) => {
  await register("r-1", "backend");
  const run = question("r-1", "backend", "Still here after refresh?", ["Yes", "No"]);
  await page.goto("/");
  await expect(card(page, "question.created")).toContainText("Still here after refresh?");
  await page.reload();
  await expect(card(page, "question.created")).toContainText("Still here after refresh?");
  await card(page, "question.created").getByRole("button", { name: "Yes" }).click();
  await run.done;
});

test("filters, search, agent detail and history", async ({ page }) => {
  await page.goto("/");
  await register("s-1", "shop");
  await register("s-2", "infra");
  const p = permission("s-2", "infra", "terraform plan");
  const q = question("s-1", "shop", "Pick a payment provider?", ["Stripe", "Adyen"]);
  await expect(page.getByTestId("request-card")).toHaveCount(2);

  await page.getByRole("tab", { name: "Permissions" }).click();
  await expect(page.getByTestId("request-card")).toHaveCount(1);
  await expect(page.getByTestId("agent-card")).toHaveCount(1);
  await page.getByRole("tab", { name: "All" }).click();

  await page.getByLabel("Search events").fill("stripe");
  await expect(page.getByTestId("request-card")).toHaveCount(1);
  await expect(page.getByTestId("request-card")).toContainText("payment provider");
  await page.getByLabel("Search events").fill("");

  await page.getByLabel("Project").selectOption("infra");
  await expect(page.getByTestId("request-card")).toContainText("terraform plan");
  await page.getByLabel("Project").selectOption("");

  await page.getByTestId("agent-card").filter({ hasText: "shop #1" }).click();
  await expect(page.getByTestId("agent-detail")).toContainText("/projects/shop");
  await expect(page.getByTestId("agent-detail").getByTestId("request-card")).toContainText("payment provider");
  await page.getByTestId("agent-detail").getByRole("button", { name: "Stripe" }).click();
  await q.done;

  await page.getByRole("link", { name: "History" }).click();
  await expect(page.getByTestId("history")).toContainText("Question answered");
  await page.getByLabel("Type").selectOption("permission");
  await expect(page.getByTestId("history").locator("tbody tr")).toHaveCount(1);

  await page.getByRole("link", { name: "Policies" }).click();
  await expect(page.getByTestId("policies")).toContainText("Permission policies");
  p.kill();
});

test("rename an agent from the detail page", async ({ page }) => {
  await register("n-1", "api");
  await page.goto("/");
  await page.getByTestId("agent-card").click();
  await page.getByRole("button", { name: "Rename" }).click();
  const input = page.getByTestId("agent-detail").locator("input");
  await input.fill("Payments bot");
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: "Payments bot" })).toBeVisible();
  const agents = (await (await fetch(`${HUB}/api/agents`)).json()).agents;
  expect(agents[0].name).toBe("Payments bot");
});
