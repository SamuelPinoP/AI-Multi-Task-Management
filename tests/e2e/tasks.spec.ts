import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The New task pop-up: the Tasks page has no button of its own since #520, so the sidebar's, or the + tab on a phone. */
async function openNewTask(page: Page, isMobile: boolean) {
  const nav = page.getByRole("navigation", { name: isMobile ? "Primary" : "Workspace" });
  await nav.getByRole("button", { name: "New task", exact: true }).click();
}

test("tasks: create in the pop-up, edit, complete into Done, filter and delete", async ({ page, isMobile }) => {
  const title = uniqueName("Sheet task");
  await continueAsGuest(page);
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "No tasks yet." })).toBeVisible();

  // Create with full details in the pop-up (#362); a past date goes through the date field.
  await openNewTask(page, isMobile);
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

  // Complete in place: the task moves into Done, which starts folded (#520).
  await page.getByRole("button", { name: `Mark done: ${title}` }).click();
  const done = page.getByRole("region", { name: /^Done/ });
  const fold = done.getByRole("button", { name: /^Done \d+$/ });
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(done.getByRole("button", { name: title, exact: true })).toHaveCount(0);
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(done.getByRole("button", { name: title, exact: true })).toBeVisible();
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

test("tasks: the Done tab shows finished tasks unfolded (#520)", async ({ page }) => {
  const title = uniqueName("Finished task");
  await continueAsGuest(page);
  expect((await page.request.post("/api/tasks", { data: { title, status: "DONE" } })).ok()).toBe(true);
  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: /^Done \d+$/ })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: title, exact: true })).toHaveCount(0);

  await page.getByRole("radio", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: /^Done/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Done \d+$/ })).toHaveCount(0);
});

test("tasks: five priorities, No priority by default, and a filter for each (#361)", async ({ page, isMobile }) => {
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
  await openNewTask(page, isMobile);
  const create = page.getByRole("dialog", { name: "New task" });
  await create.getByRole("button", { name: "Priority: No priority" }).click();
  await expect(page.getByRole("option")).toHaveText(["No priority, current", "Urgent", "High", "Medium", "Low"]);
  await page.keyboard.press("Escape");
  await create.getByRole("button", { name: "Cancel" }).click();

  // Filter (#520): tick a priority; the menu stays open for the next one.
  const filters = page.getByRole("search", { name: "Filter tasks" });
  await filters.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Urgent" }).click();
  await expect(page.getByRole("button", { name: urgent, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: plain, exact: true })).toHaveCount(0);
  await page.getByRole("menuitemcheckbox", { name: "Urgent" }).click();
  await page.getByRole("menuitemcheckbox", { name: "No priority" }).click();
  await expect(page.getByRole("button", { name: plain, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: urgent, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(filters.getByRole("button", { name: "Filter, 1 on" })).toBeVisible();
});

test("tasks: Filter picks projects and No project, and Display sorts and hides descriptions (#520)", async ({ page }) => {
  await continueAsGuest(page);
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("Filter project") } })).json()) as {
    id: string;
    name: string;
  };
  const [early, late, loose] = [uniqueName("Due first"), uniqueName("Due later"), uniqueName("Loose task")];
  for (const data of [
    { title: early, dueDate: dateInputValue(1), projectId: project.id, description: "Seen beside the title" },
    { title: late, dueDate: dateInputValue(3), projectId: project.id },
    { title: loose },
  ]) {
    expect((await page.request.post("/api/tasks", { data })).ok()).toBe(true);
  }
  await page.goto("/tasks");
  const filters = page.getByRole("search", { name: "Filter tasks" });

  // The project alone, then No project as well: a task shows when it matches any ticked project.
  await filters.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: project.name }).click();
  await expect(page.getByRole("button", { name: loose, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: early, exact: true })).toBeVisible();
  await page.getByRole("menuitemcheckbox", { name: "No project" }).click();
  await expect(page.getByRole("button", { name: loose, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(filters.getByRole("button", { name: "Filter, 2 on" })).toBeVisible();

  // Display: Due latest puts the later task first, and Descriptions off hides the grey text.
  const band = page.getByRole("region", { name: project.name });
  const titles = band.getByRole("button", { name: new RegExp(`^(${early}|${late})$`) });
  await expect(titles).toHaveText([early, late]);
  await expect(band.getByText("Seen beside the title")).toHaveCount(1);
  await filters.getByRole("button", { name: "Display" }).click();
  await page.getByRole("menuitemradio", { name: "Due latest" }).click();
  await expect(titles).toHaveText([late, early]);
  await page.getByRole("menuitemcheckbox", { name: "Descriptions" }).click();
  await expect(band.getByText("Seen beside the title")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Clear filters, from the Filter menu.
  await filters.getByRole("button", { name: "Filter, 2 on" }).click();
  await page.getByRole("menuitem", { name: "Clear filters" }).click();
  await expect(filters.getByRole("button", { name: "Filter", exact: true })).toBeVisible();
});
