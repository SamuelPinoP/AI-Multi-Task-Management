import { expect, test } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("tasks: create in the sheet, edit, complete, filter and delete", async ({ page }) => {
  const title = uniqueName("Sheet task");
  await continueAsGuest(page);
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "No tasks yet." })).toBeVisible();

  // Create with full details in the pop-up (#362); a past date goes through the date field.
  await page.getByRole("main").getByRole("button", { name: "New task", exact: true }).click();
  const create = page.getByRole("dialog", { name: "New task" });
  await create.getByLabel("Title").fill(title);
  await create.getByLabel("Description").fill("Made by Playwright.");
  await create.getByRole("button", { name: "Priority: No priority" }).click();
  await page.getByRole("option", { name: "High" }).click();
  await create.getByRole("button", { name: "Due date: none" }).click();
  await page.getByLabel("Pick a date").fill(dateInputValue(-1));
  await page.getByRole("button", { name: "Set" }).click();
  await create.getByRole("button", { name: "Create task" }).click();
  await expect(create).toBeHidden();
  const overdue = page.getByRole("region", { name: /^Overdue/ });
  await expect(overdue.getByRole("button", { name: title, exact: true })).toBeVisible();

  // Open it as a page (#352) and move it to today; changes save at once.
  await overdue.getByRole("button", { name: title, exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/[^/?]+$/);
  await expect(page.getByLabel("Description")).toHaveValue("Made by Playwright.");
  await page.getByRole("button", { name: /^Due date:/ }).click();
  await page.getByRole("button", { name: /^Today/ }).click();
  const todayName = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + 0);
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  });
  await expect(page.getByRole("button", { name: `Due date: ${todayName}` })).toBeVisible();
  await page.getByRole("link", { name: "Back to Tasks" }).click();
  const today = page.getByRole("region", { name: /^Today/ });
  await expect(today.getByRole("button", { name: title, exact: true })).toBeVisible();

  // Complete in place, then filter.
  await page.getByRole("button", { name: `Mark done: ${title}` }).click();
  await expect(page.getByRole("region", { name: /^Done/ }).getByRole("button", { name: title, exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Active" }).click();
  await expect(page.getByRole("heading", { name: "No tasks match these filters." })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();

  // Delete from the row menu.
  await page.getByRole("button", { name: `More actions for ${title}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete this task?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: title, exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No tasks yet." })).toBeVisible();
});

test("tasks: five priorities, No priority by default, and a filter for each (#361)", async ({ page }) => {
  const urgent = uniqueName("Urgent task");
  const plain = uniqueName("Plain task");
  await continueAsGuest(page);
  expect((await page.request.post("/api/tasks", { data: { title: urgent, priority: "URGENT" } })).ok()).toBe(true);
  const created = (await (await page.request.post("/api/tasks", { data: { title: plain } })).json()) as { priority: string };
  expect(created.priority).toBe("NONE");

  await page.goto("/tasks");
  const urgentRow = page.getByRole("listitem").filter({ hasText: urgent });
  await expect(urgentRow.getByText("Urgent priority")).toBeVisible();
  // No priority shows no badge at all.
  await expect(page.getByRole("listitem").filter({ hasText: plain }).getByText(/priority$/)).toHaveCount(0);

  // The pop-up starts at No priority and offers all five, No priority first.
  await page.getByRole("main").getByRole("button", { name: "New task", exact: true }).click();
  const create = page.getByRole("dialog", { name: "New task" });
  await create.getByRole("button", { name: "Priority: No priority" }).click();
  await expect(page.getByRole("option")).toHaveText(["No priority, current", "Urgent", "High", "Medium", "Low"]);
  await page.keyboard.press("Escape");
  await create.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("combobox", { name: "Priority" }).selectOption("URGENT");
  await expect(page.getByRole("button", { name: urgent, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: plain, exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Priority" }).selectOption("NONE");
  await expect(page.getByRole("button", { name: plain, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: urgent, exact: true })).toHaveCount(0);
});
