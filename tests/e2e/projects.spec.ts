import { expect, test } from "@playwright/test";
import { continueAsGuest, openSection, uniqueName } from "./helpers";

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// #305: every Quick Actions field has a visible name, so the forms can be filled by label.
test("project quick actions: create a task and an event by their labelled fields", async ({ page }) => {
  await continueAsGuest(page);
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("Quick actions project") } })).json()) as { id: string };
  await page.goto(`/projects/${project.id}`);
  const main = page.locator("#main-content");

  const taskTitle = uniqueName("Quick task");
  await main.getByRole("button", { name: "Add Task", exact: true }).click();
  await main.getByPlaceholder("Task title").fill(taskTitle);
  await main.getByLabel("Priority").selectOption("HIGH");
  await main.getByLabel("Status").selectOption("IN_PROGRESS");
  await main.getByLabel("Due date").fill(dateInputValue(3));
  await main.getByRole("button", { name: "Create task" }).click();
  await expect(main.getByText(taskTitle).first()).toBeVisible();
  const tasks = (await (await page.request.get("/api/tasks")).json()) as { title: string; priority: string; status: string; dueDate: string | null }[];
  const task = tasks.find((item) => item.title === taskTitle);
  expect(task).toMatchObject({ priority: "HIGH", status: "IN_PROGRESS" });
  expect(task?.dueDate?.slice(0, 10)).toBe(dateInputValue(3));

  const eventTitle = uniqueName("Quick event");
  await main.getByRole("button", { name: "Add Event", exact: true }).click();
  await main.getByPlaceholder("Event title").fill(eventTitle);
  await main.getByLabel("Starts").fill(dateInputValue(2));
  await main.getByLabel("Start time").fill("09:30");
  await expect(main.getByLabel("Ends")).toHaveValue("");
  await expect(main.getByLabel("End time")).toHaveValue("");
  await expect(main.getByLabel("Repeats")).toHaveValue("NONE");
  await main.getByRole("button", { name: "Create event" }).click();
  await expect(main.getByText(eventTitle).first()).toBeVisible();
  // Event times are wall-clock values stored as UTC (src/lib/event-time.ts).
  const events = (await (await page.request.get("/api/events")).json()) as { title: string; startTime: string; hasStartTime: boolean }[];
  const event = events.find((item) => item.title === eventTitle);
  expect(event?.hasStartTime).toBe(true);
  expect(event?.startTime.slice(0, 16)).toBe(`${dateInputValue(2)}T09:30`);
});

test("projects: quick add, edit, archive, restore and delete", async ({ page }) => {
  const name = uniqueName("Card project");
  await continueAsGuest(page);
  await openSection(page, "Projects");
  await expect(page.getByRole("heading", { name: "No projects yet." })).toBeVisible();
  // The sidebar lists projects too, so look inside the page content.
  const main = page.locator("#main-content");

  await page.getByLabel("Add a project").fill(name);
  await page.getByLabel("Add a project").press("Enter");
  const card = main.getByRole("listitem").filter({ has: page.getByRole("link", { name }) });
  await expect(card).toContainText("0 open tasks");
  await expect(card).toContainText("Owner");

  // Edit in the sheet.
  await card.getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit project" });
  await sheet.getByLabel("Description").fill("Shown on the card.");
  await sheet.getByRole("radio", { name: "Violet" }).click();
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(sheet).toBeHidden();
  await expect(card).toContainText("Shown on the card.");

  // Archive hides it from Active; Restore brings it back.
  await card.getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(main.getByRole("link", { name })).toHaveCount(0);
  await page.getByRole("radio", { name: /^Archived/ }).click();
  await expect(card).toContainText("Archived");
  await card.getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Restore" }).click();
  await page.getByRole("radio", { name: /^Active/ }).click();
  await expect(main.getByRole("link", { name })).toBeVisible();

  // Delete warns that it can't be undone.
  await card.getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("dialog", { name: `Delete “${name}”?` });
  await expect(confirm).toContainText("can't be undone");
  await confirm.getByRole("button", { name: "Delete project" }).click();
  await expect(main.getByRole("link", { name })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No projects yet." })).toBeVisible();
});
