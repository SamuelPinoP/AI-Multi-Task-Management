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

  // Subtasks: add two in the parent's sheet and tick one off.
  await page.goto("/tasks");
  await page.getByRole("button", { name: launch, exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Edit task" });
  const subtasks = sheet.getByRole("region", { name: "Subtasks" });
  for (const title of ["Write copy", "Fix links"]) {
    await subtasks.getByLabel("Add a subtask").fill(title);
    await subtasks.getByLabel("Add a subtask").press("Enter");
    await expect(subtasks.getByRole("button", { name: title, exact: true })).toBeVisible();
  }
  await expect(subtasks).toContainText("0 of 2 subtasks done");
  await subtasks.getByRole("checkbox", { name: "Complete Write copy" }).click();
  await expect(subtasks).toContainText("1 of 2 subtasks done");

  // A subtask opens in the same sheet and links back to its parent.
  await subtasks.getByRole("button", { name: "Fix links", exact: true }).click();
  await expect(sheet.getByLabel("Title")).toHaveValue("Fix links");
  await expect(sheet.getByRole("combobox", { name: /^Project/ })).toBeDisabled();
  await sheet.getByRole("button", { name: launch, exact: true }).click();
  await expect(sheet.getByLabel("Title")).toHaveValue(launch);
  await sheet.getByRole("button", { name: "Cancel" }).click();

  // The list shows the parent with its ring; subtasks appear only when searching.
  const launchRow = page.locator("li", { has: page.getByRole("button", { name: launch, exact: true }) });
  await expect(launchRow).toContainText("1 of 2 subtasks done");
  await expect(page.getByRole("button", { name: "Fix links", exact: true })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("Fix links");
  await expect(page.getByRole("button", { name: "Fix links", exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("");

  // Dependencies: Deploy waits on Launch site.
  await page.getByRole("button", { name: deploy, exact: true }).click();
  const blockers = sheet.getByRole("region", { name: "Blocked by" });
  await blockers.getByLabel("Add a task this one waits on").selectOption({ label: launch });
  await blockers.getByRole("button", { name: "Add" }).click();
  await expect(blockers.getByRole("button", { name: launch, exact: true })).toBeVisible();
  // The sheet's new sections pass axe's WCAG A/AA rules.
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.nodes[0]?.target.join(" ")}`)).toEqual([]);
  await sheet.getByRole("button", { name: "Cancel" }).click();
  const deployRow = page.locator("li", { has: page.getByRole("button", { name: deploy, exact: true }) });
  await expect(deployRow).toContainText("Blocked");

  // A loop is refused.
  await page.getByRole("button", { name: launch, exact: true }).click();
  await blockers.getByLabel("Add a task this one waits on").selectOption({ label: deploy });
  await blockers.getByRole("button", { name: "Add" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("These tasks would end up waiting on each other.");
  await sheet.getByRole("button", { name: "Cancel" }).click();

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
  await blockers.getByRole("button", { name: `Stop waiting on ${launch}` }).click();
  await expect(blockers.getByRole("button", { name: launch, exact: true })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(deployRow).not.toContainText("Blocked");
});
