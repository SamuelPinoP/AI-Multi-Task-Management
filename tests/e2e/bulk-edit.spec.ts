import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

// Changing several tasks at once (#281): select with the row checkboxes, then use the bar.

function row(page: Page, title: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("button", { name: title, exact: true }) });
}

test("bulk: select a range, set the priority, undo, then delete and undo", async ({ page }) => {
  const [a, b, c, d] = ["A", "B", "C", "D"].map((letter) => uniqueName(`Bulk ${letter}`));
  await continueAsGuest(page);
  // Created in order, so the list shows them newest first: D, C, B, A.
  for (const title of [a, b, c, d]) expect((await page.request.post("/api/tasks", { data: { title } })).ok()).toBe(true);
  await page.goto("/tasks");
  await expect(row(page, a)).toBeVisible();

  // Click A, then Shift+click C: A, B and C are selected, D isn't.
  await page.getByRole("checkbox", { name: `Select ${a}` }).click();
  await page.getByRole("checkbox", { name: `Select ${c}` }).click({ modifiers: ["Shift"] });
  const bar = page.getByRole("toolbar", { name: "Selected tasks" });
  await expect(bar).toContainText("3 selected");
  await expect(page.getByRole("checkbox", { name: `Select ${b}` })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: `Select ${d}` })).not.toBeChecked();

  // One change for all three, then Undo puts each back.
  await bar.getByRole("button", { name: "Priority" }).click();
  await page.getByRole("menuitem", { name: "High" }).click();
  await expect(page.getByText("3 tasks set to High priority")).toBeVisible();
  for (const title of [a, b, c]) await expect(row(page, title).getByText("High priority")).toBeVisible();
  await expect(row(page, d).getByText("High priority")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Change undone")).toBeVisible();
  for (const title of [a, b, c]) await expect(row(page, title).getByText("High priority")).toHaveCount(0);

  // Delete moves them to the Trash; Undo brings them back.
  await bar.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete 3 tasks?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("3 tasks moved to Trash")).toBeVisible();
  for (const title of [a, b, c]) await expect(row(page, title)).toHaveCount(0);
  await expect(row(page, d)).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Tasks restored")).toBeVisible();
  for (const title of [a, b, c]) await expect(row(page, title)).toBeVisible();
});

test("bulk: Ctrl+A selects every task shown, Escape clears, and Mark done completes them", async ({ page }) => {
  const first = uniqueName("Bulk first");
  const second = uniqueName("Bulk second");
  await continueAsGuest(page);
  for (const title of [first, second]) expect((await page.request.post("/api/tasks", { data: { title } })).ok()).toBe(true);
  await page.goto("/tasks");
  await expect(row(page, first)).toBeVisible();

  await page.locator("body").press("ControlOrMeta+a");
  const bar = page.getByRole("toolbar", { name: "Selected tasks" });
  await expect(bar).toContainText("2 selected");
  await page.locator("body").press("Escape");
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Search tasks" })).toBeVisible();

  await page.getByRole("checkbox", { name: `Select ${first}` }).click();
  await page.getByRole("checkbox", { name: `Select ${second}` }).click();
  await bar.getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByText("2 tasks marked done")).toBeVisible();
  for (const title of [first, second]) {
    await expect(page.getByRole("button", { name: `Done: ${title}` })).toHaveAttribute("aria-pressed", "true");
  }
});

test("the row's Mark done button completes one task and turns green", async ({ page }) => {
  const title = uniqueName("Row done");
  await continueAsGuest(page);
  expect((await page.request.post("/api/tasks", { data: { title } })).ok()).toBe(true);
  await page.goto("/tasks");
  await page.getByRole("button", { name: `Mark done: ${title}` }).click();
  await expect(page.getByRole("button", { name: `Done: ${title}` })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: /^Done/ }).getByRole("button", { name: title, exact: true })).toBeVisible();
});

test("the bulk bar passes axe in both themes and fits a phone screen", async ({ page }) => {
  const titles = [uniqueName("Axe one"), uniqueName("Axe two")];
  await continueAsGuest(page);
  for (const title of titles) expect((await page.request.post("/api/tasks", { data: { title, priority: "HIGH" } })).ok()).toBe(true);
  await page.goto("/tasks");
  for (const title of titles) await page.getByRole("checkbox", { name: `Select ${title}` }).click();
  const bar = page.getByRole("toolbar", { name: "Selected tasks" });
  await expect(bar).toContainText("2 selected");

  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).include("#main-content").analyze();
    expect(results.violations.map((violation) => `${theme}: ${violation.id} ${violation.nodes[0]?.target.join(" ")}`)).toEqual([]);
  }
  // The bar scrolls inside itself; the page never scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
