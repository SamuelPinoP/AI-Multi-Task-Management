import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

test("subtasks, dependencies, the board and the planner (SMART-02)", async ({ page }) => {
  await continueAsGuest(page);
  const launch = uniqueName("Launch site");
  const deploy = uniqueName("Deploy");
  // Deploy is due today, so the planner lists it even while it's blocked.
  const today = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  expect((await page.request.post("/api/tasks", { data: { title: launch } })).ok()).toBe(true);
  expect((await page.request.post("/api/tasks", { data: { title: deploy, dueDate: today } })).ok()).toBe(true);

  // Subtasks: add two on the parent's page (#352) and tick one off.
  await page.goto("/tasks");
  await page.getByRole("button", { name: launch, exact: true }).click();
  await expect(page.getByLabel("Title")).toHaveValue(launch);
  const subtasks = page.getByRole("region", { name: /^Sub-tasks/ });
  for (const title of ["Write copy", "Fix links"]) {
    await subtasks.getByLabel("Add a sub-task").fill(title);
    await subtasks.getByLabel("Add a sub-task").press("Enter");
    await expect(subtasks.getByRole("link", { name: title, exact: true })).toBeVisible();
  }
  await expect(subtasks).toContainText("0 of 2 subtasks done");
  await subtasks.getByRole("button", { name: "Mark done: Write copy" }).click();
  await expect(subtasks).toContainText("1 of 2 subtasks done");

  // A subtask has its own page, which links back to its parent and keeps the parent's project.
  await subtasks.getByRole("link", { name: "Fix links", exact: true }).click();
  await expect(page.getByLabel("Title")).toHaveValue("Fix links");
  await expect(page.getByRole("button", { name: /^Project:/ })).toBeDisabled();
  await page.getByRole("link", { name: `Sub-task of ${launch}` }).click();
  await expect(page.getByLabel("Title")).toHaveValue(launch);
  await page.goto("/tasks");

  // The list shows the parent with its ring; subtasks appear only when searching.
  const launchRow = page.locator("li", { has: page.getByRole("button", { name: launch, exact: true }) });
  await expect(launchRow).toContainText("1 of 2 subtasks done");
  await expect(page.getByRole("button", { name: "Fix links", exact: true })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("Fix links");
  await expect(page.getByRole("button", { name: "Fix links", exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("");

  // Dependencies: Deploy waits on Launch site.
  await page.getByRole("button", { name: deploy, exact: true }).click();
  await expect(page.getByLabel("Title")).toHaveValue(deploy);
  const properties = page.getByRole("complementary", { name: "Properties" });
  await properties.getByRole("button", { name: "Add a task" }).click();
  await page.getByRole("option", { name: launch }).click();
  await expect(properties.getByRole("link", { name: launch, exact: true })).toBeVisible();
  // The page passes axe's WCAG A/AA rules.
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  const axe = await new AxeBuilder({ page }).include("#main-content").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.nodes[0]?.target.join(" ")}`)).toEqual([]);
  await page.goto("/tasks");
  const deployRow = page.locator("li", { has: page.getByRole("button", { name: deploy, exact: true }) });
  await expect(deployRow).toContainText("Blocked");

  // A loop is refused.
  await page.getByRole("button", { name: launch, exact: true }).click();
  await expect(page.getByLabel("Title")).toHaveValue(launch);
  await properties.getByRole("button", { name: "Add a task" }).click();
  await page.getByRole("option", { name: deploy }).click();
  await expect(page.getByText("These tasks would end up waiting on each other.")).toBeVisible();

  // The planner puts the task that unblocks work first.
  await page.goto("/planner");
  await expect(page.getByText(/^Unblocks 1 task\./).first()).toBeVisible();
  await expect(page.getByText(new RegExp(`^Waiting on “${launch}”`)).first()).toBeVisible();

  // The board shows top-level cards with the ring and the badge.
  await page.goto("/board");
  await expect(page.getByRole("heading", { name: "Fix links" })).toHaveCount(0);
  const launchCard = page.locator("article", { has: page.getByRole("heading", { name: launch }) });
  await expect(launchCard).toContainText("1 of 2 subtasks done");
  const deployCard = page.locator("article", { has: page.getByRole("heading", { name: deploy }) });
  await expect(deployCard).toContainText("Blocked");

  // Removing the dependency clears the badge.
  await page.goto("/tasks");
  await page.getByRole("button", { name: deploy, exact: true }).click();
  await expect(page.getByLabel("Title")).toHaveValue(deploy);
  await properties.getByRole("button", { name: `Stop waiting on ${launch}` }).click();
  await expect(properties.getByRole("link", { name: launch, exact: true })).toHaveCount(0);
  await page.goto("/tasks");
  await expect(deployRow).not.toContainText("Blocked");
});
