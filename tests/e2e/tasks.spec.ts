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

  // Create with full details.
  await page.getByRole("main").getByRole("button", { name: "New task" }).click();
  const create = page.getByRole("dialog", { name: "New task" });
  await create.getByLabel("Title").fill(title);
  await create.getByLabel("Description").fill("Made by Playwright.");
  await create.getByLabel("Priority").selectOption("HIGH");
  await create.getByLabel("Due date").fill(dateInputValue(-1));
  await create.getByRole("button", { name: "Create task" }).click();
  await expect(create).toBeHidden();
  const overdue = page.getByRole("region", { name: /^Overdue/ });
  await expect(overdue.getByRole("button", { name: title, exact: true })).toBeVisible();

  // Edit: move it to today.
  await overdue.getByRole("button", { name: title, exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit task" });
  await expect(edit.getByLabel("Description")).toHaveValue("Made by Playwright.");
  await edit.getByLabel("Due date").fill(dateInputValue(0));
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  const today = page.getByRole("region", { name: /^Today/ });
  await expect(today.getByRole("button", { name: title, exact: true })).toBeVisible();

  // Complete in place, then filter.
  await page.getByRole("checkbox", { name: `Complete ${title}` }).click();
  await expect(page.getByRole("region", { name: /^Done/ }).getByRole("button", { name: title, exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Open" }).click();
  await expect(page.getByRole("heading", { name: "No tasks match these filters." })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();

  // Delete from the row menu.
  await page.getByRole("button", { name: `More actions for ${title}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete this task?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: title, exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No tasks yet." })).toBeVisible();
});
