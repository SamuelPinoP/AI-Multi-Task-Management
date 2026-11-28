import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { nextQuotaReset, timeUntil } from "../../src/lib/ai/allowance";
import { AI_NOTICE_VERSION } from "../../src/lib/ai/notice";
import { continueAsGuest, queryDatabase, signUpAndLogIn, uniqueName } from "./helpers";

// The Estimate button (#540), on computers and phones: a task without an estimate has one beside
// "Add a section", for people who can use the AI. A click asks the server's fake model
// (src/lib/ai/providers/fake.ts: 2 h for the task, 30 min for each subtask) and adds the Estimate
// section, marked as the AI's, to the task and to its subtasks without one, in one request.
// Subtasks follow their parent: a new one under a task with an estimate gets its own once it
// exists, and so do the ones a task already had when it gets its estimate.

const ESTIMATED = "Two coats on the fence.\n\n## Estimate\n\n**1 day** · AI estimate\nTwo coats, with drying time in between.";

async function signedInWithTheNotice(page: Page, label: string) {
  const account = await signUpAndLogIn(page, label);
  expect((await page.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).status()).toBe(200);
  return account;
}

async function createTask(page: Page, data: { title: string; description?: string; parentId?: string }) {
  const response = await page.request.post("/api/tasks", { data });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function descriptionOf(id: string) {
  const { rows } = await queryDatabase<{ description: string | null }>(`SELECT description FROM "Task" WHERE id = $1`, [id]);
  return rows[0]?.description ?? null;
}

/** The person's runs in the AI's usage log, oldest first. */
async function runsOf(email: string) {
  const { rows } = await queryDatabase<{ modelRequests: number; toolCalls: string[]; outcome: string }>(
    `SELECT r."modelRequests", r."toolCalls", r.outcome FROM "AgentRun" r JOIN "User" u ON u.id = r."userId" WHERE u.email = $1 ORDER BY r."createdAt"`,
    [email],
  );
  return rows;
}

/** axe's WCAG A and AA violations in the page's main column, once animations end, as accessibility.spec.ts measures them. */
async function axeViolations(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).include("#main-content").analyze();
  return results.violations.map((violation) => `${violation.id}: ${violation.help} -> ${violation.nodes[0]?.target.join(" ")}`);
}

/** The Estimate button. The Estimate section's own title is a button by the same name, which folds the section. */
const estimateButton = (page: Page) =>
  page.getByRole("button", { name: /^(Estimate|Estimating…)( · .*)?$/ }).and(page.locator(":not([aria-expanded])"));
const estimateSection = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "Estimate", exact: true }) });

test("the Estimate button estimates the task and its subtasks without one in a single request", async ({ page }) => {
  const { email } = await signedInWithTheNotice(page, "E2E estimates");
  const title = uniqueName("E2E Paint the back fence");
  const id = await createTask(page, { title, description: "Two coats, and the gate." });
  const buy = await createTask(page, { title: "Buy paint", parentId: id });
  const sand = await createTask(page, { title: "Sand the boards", parentId: id, description: "## Estimate\n\n**2 h**" });

  await page.goto(`/tasks/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title);
  const button = estimateButton(page);
  await expect(button).toHaveText("Estimate");
  expect(await axeViolations(page)).toEqual([]);

  // Held until the busy state is checked: the description can't change while the AI answers.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/api/tasks/${id}/estimate`, async (route) => {
    await held;
    await route.continue();
  });
  const answered = page.waitForResponse((response) => response.url().endsWith(`/api/tasks/${id}/estimate`));
  await button.click();
  await expect(button).toHaveText("Estimating…");
  await expect(button).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add a section" })).toBeDisabled();
  release();
  expect((await answered).status()).toBe(200);

  await expect(page.getByText("Estimated: 2 h")).toBeVisible();
  await expect(page.getByText("Its subtask got an estimate too.")).toBeVisible();
  await expect(estimateSection(page)).toContainText("2 h · AI estimate");
  await expect(estimateSection(page)).toContainText("Most of it is the work itself, with a check at the end.");
  // The button is gone, and the section edits like any section.
  await expect(estimateButton(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Estimate" })).toBeEnabled();

  expect(await descriptionOf(id)).toBe(
    "Two coats, and the gate.\n\n## Estimate\n\n**2 h** · AI estimate\nMost of it is the work itself, with a check at the end.",
  );
  expect(await descriptionOf(buy)).toBe("## Estimate\n\n**30 min** · AI estimate\nOne part of the task, done in one sitting.");
  expect(await descriptionOf(sand), "a subtask's own estimate stays").toBe("## Estimate\n\n**2 h**");
  expect(await runsOf(email)).toEqual([{ modelRequests: 1, toolCalls: ["estimate_tasks"], outcome: "ANSWERED" }]);

  // After a reload too, the task has its estimate and no button.
  await page.reload();
  await expect(estimateSection(page)).toContainText("2 h · AI estimate");
  await expect(estimateButton(page)).toHaveCount(0);
});

test("a new subtask under a task with an estimate gets its own once it exists, added on the page or through the API", async ({ page }) => {
  const { email } = await signedInWithTheNotice(page, "E2E subtask estimates");
  const plain = await createTask(page, { title: uniqueName("E2E Plain parent") });
  const unestimated = await createTask(page, { title: "Under a task without an estimate", parentId: plain });
  const title = uniqueName("E2E Paint the fence");
  const parent = await createTask(page, { title, description: ESTIMATED });

  // Added on the task's page: the subtask appears at once, and its estimate after it.
  await page.goto(`/tasks/${parent}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title);
  await expect(estimateButton(page)).toHaveCount(0);
  const created = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/tasks"));
  await page.getByLabel("Add a sub-task").fill("Wash the boards");
  await page.getByLabel("Add a sub-task").press("Enter");
  const answer = await created;
  expect(answer.status()).toBe(201);
  const washed = ((await answer.json()) as { id: string }).id;
  const link = page.getByRole("link", { name: "Wash the boards" });
  await expect(link).toBeVisible();
  await expect.poll(() => descriptionOf(washed), { timeout: 15_000 }).toBe("## Estimate\n\n**30 min** · AI estimate\nOne part of the task, done in one sitting.");

  await link.click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Wash the boards");
  await expect(estimateSection(page)).toContainText("30 min · AI estimate");
  await expect(estimateButton(page)).toHaveCount(0);

  // Added through the API, with a description of its own: the estimate goes after it.
  const viaApi = await createTask(page, { title: "Buy rollers", parentId: parent, description: "Two of them." });
  await expect
    .poll(() => descriptionOf(viaApi), { timeout: 15_000 })
    .toBe("Two of them.\n\n## Estimate\n\n**30 min** · AI estimate\nOne part of the task, done in one sitting.");

  // One request for each, and none for the subtask under a task without an estimate.
  expect(await descriptionOf(unestimated)).toBeNull();
  expect(await runsOf(email)).toEqual([
    { modelRequests: 1, toolCalls: ["estimate_tasks"], outcome: "ANSWERED" },
    { modelRequests: 1, toolCalls: ["estimate_tasks"], outcome: "ANSWERED" },
  ]);
});

test("a task that gets its estimate after its subtasks exist passes it on to those without one", async ({ page }) => {
  const { email } = await signedInWithTheNotice(page, "E2E parent estimate");
  const title = uniqueName("E2E Move the shed");
  const parent = await createTask(page, { title, description: "Before the rain." });
  const empty = await createTask(page, { title: "Empty the shed", parentId: parent });
  const mine = await createTask(page, { title: "Book the van", parentId: parent, description: "## Estimate\n\n15 min, one call." });

  await page.goto(`/tasks/${parent}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title);
  await expect(estimateButton(page)).toHaveText("Estimate");

  // A person writes the Estimate section themselves.
  await page.getByRole("button", { name: "Add a section" }).click();
  await page.getByLabel("Section title").fill("Estimate");
  await page.getByLabel("Section text").fill("**1 day**, with the van.");
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith(`/api/tasks/${parent}`));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(estimateSection(page)).toContainText("1 day, with the van.");
  // It has an estimate now: the button goes.
  await expect(estimateButton(page)).toHaveCount(0);

  await expect.poll(() => descriptionOf(empty), { timeout: 15_000 }).toBe("## Estimate\n\n**30 min** · AI estimate\nOne part of the task, done in one sitting.");
  expect(await descriptionOf(mine), "a subtask's own estimate stays").toBe("## Estimate\n\n15 min, one call.");
  expect(await descriptionOf(parent), "the person's estimate stays theirs").toBe("Before the rain.\n\n## Estimate\n\n**1 day**, with the van.");
  expect(await runsOf(email)).toEqual([{ modelRequests: 1, toolCalls: ["estimate_tasks"], outcome: "ANSWERED" }]);
});

test("once today's allowance is used up, the button says when it's back, and new subtasks wait", async ({ page }) => {
  const { email } = await signedInWithTheNotice(page, "E2E estimates used up");
  const title = uniqueName("E2E Clean the gutters");
  const task = await createTask(page, { title });
  const parent = await createTask(page, { title: uniqueName("E2E Estimated parent"), description: ESTIMATED });

  const status = (await (await page.request.get("/api/agent/status")).json()) as { allowance: { user: { remaining: number } } };
  const filler = `e2e-estimates-${randomUUID()}`;
  await queryDatabase(
    `INSERT INTO "AgentRun" (id, "userId", outcome, "modelRequests", "latencyMs", "createdAt")
     SELECT $1, id, 'ANSWERED', $2, 0, now() AT TIME ZONE 'utc' FROM "User" WHERE email = $3`,
    [filler, status.allowance.user.remaining, email],
  );
  try {
    const from = new Date();
    await page.goto(`/tasks/${task}`);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title);
    const button = estimateButton(page);
    await expect(button).toBeDisabled();
    // In the words the app uses at this moment: "about an hour" in the last hour before the reset (#538).
    const words = (now: Date) => timeUntil(nextQuotaReset(now).toISOString(), now);
    await expect(button).toHaveText(new RegExp(`^Estimate · Used up, resets in (?:${[...new Set([words(from), words(new Date())])].join("|")})$`));
    expect(await axeViolations(page)).toEqual([]);
    expect((await page.request.post(`/api/tasks/${task}/estimate`)).status()).toBe(429);

    const waiting = await createTask(page, { title: "Clear the downpipe", parentId: parent });
    // The estimate would come after the response: give it the time it takes when it does.
    await page.waitForTimeout(2_000);
    expect(await descriptionOf(waiting)).toBeNull();
    expect((await runsOf(email)).length, "no request beyond the filler").toBe(1);
  } finally {
    await queryDatabase(`DELETE FROM "AgentRun" WHERE id = $1`, [filler]);
  }
});

test("people who can't use the AI see no Estimate button, and their subtasks get no estimate", async ({ page }) => {
  // An account that hasn't agreed to the AI's data notice: nothing of theirs goes to a model.
  const { email } = await signUpAndLogIn(page, "E2E no notice");
  const title = uniqueName("E2E Fix the gate");
  const task = await createTask(page, { title });
  const parent = await createTask(page, { title: uniqueName("E2E Estimated by hand"), description: "## Estimate\n\n**4 h**" });
  await page.goto(`/tasks/${task}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title);
  await expect(page.getByRole("button", { name: "Add a section" })).toBeVisible();
  await expect(estimateButton(page)).toHaveCount(0);
  const refused = await page.request.post(`/api/tasks/${task}/estimate`);
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toMatchObject({ code: "notice_required" });
  const subtask = await createTask(page, { title: "Oil the hinges", parentId: parent });
  await page.waitForTimeout(2_000);
  expect(await descriptionOf(subtask)).toBeNull();
  expect(await runsOf(email)).toEqual([]);

  // A guest (#458).
  await page.context().clearCookies();
  await continueAsGuest(page);
  const guestTitle = uniqueName("E2E Guest task");
  const guestTask = await createTask(page, { title: guestTitle });
  await page.goto(`/tasks/${guestTask}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(guestTitle);
  await expect(page.getByRole("button", { name: "Add a section" })).toBeVisible();
  await expect(estimateButton(page)).toHaveCount(0);
  expect((await page.request.post(`/api/tasks/${guestTask}/estimate`)).status()).toBe(403);
});
