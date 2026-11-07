import { expect, test } from "@playwright/test";
import { continueAsGuest, openSection, uniqueName } from "./helpers";

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// DES-18 (#333): Quick Actions opens the app's New task, note and event sheets with this project chosen.
test("project quick actions: the three buttons create a task, a note and an event in the project", async ({ page }) => {
  await continueAsGuest(page);
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("Quick actions project") } })).json()) as { id: string };
  await page.goto(`/projects/${project.id}`);
  const main = page.locator("#main-content");

  const taskTitle = uniqueName("Quick task");
  await main.getByRole("button", { name: "New task", exact: true }).click();
  const taskSheet = page.getByRole("dialog", { name: "New task" });
  await expect(taskSheet.getByLabel("Project")).toHaveValue(project.id);
  await taskSheet.getByLabel("Title").fill(taskTitle);
  await taskSheet.getByLabel("Priority").selectOption("HIGH");
  await taskSheet.getByLabel("Status").selectOption("IN_PROGRESS");
  await taskSheet.getByLabel("Due date").fill(dateInputValue(3));
  await taskSheet.getByRole("button", { name: "Create task" }).click();
  await expect(taskSheet).toBeHidden();
  await expect(main.getByText(taskTitle).first()).toBeVisible();
  const tasks = (await (await page.request.get("/api/tasks")).json()) as { title: string; priority: string; status: string; dueDate: string | null; projectId: string | null }[];
  const task = tasks.find((item) => item.title === taskTitle);
  expect(task).toMatchObject({ priority: "HIGH", status: "IN_PROGRESS", projectId: project.id });
  expect(task?.dueDate?.slice(0, 10)).toBe(dateInputValue(3));

  // A note needs a title or some text.
  const noteTitle = uniqueName("Quick note");
  await main.getByRole("button", { name: "New note", exact: true }).click();
  const noteSheet = page.getByRole("dialog", { name: "New note" });
  await noteSheet.getByRole("button", { name: "Create note" }).click();
  await expect(noteSheet.getByRole("alert")).toHaveText("Give the note a title or some text.");
  await noteSheet.getByLabel("Title").fill(noteTitle);
  await noteSheet.getByLabel("Note").fill("Written from Quick Actions.");
  await noteSheet.getByRole("button", { name: "Create note" }).click();
  await expect(noteSheet).toBeHidden();
  await expect(main.getByRole("heading", { name: noteTitle })).toBeVisible();

  // The event starts today unless another day is picked.
  const eventTitle = uniqueName("Quick event");
  await main.getByRole("button", { name: "New event", exact: true }).click();
  const eventSheet = page.getByRole("dialog", { name: "New event" });
  await expect(eventSheet.getByLabel("Starts")).toHaveValue(dateInputValue(0));
  await expect(eventSheet.getByLabel("Project")).toHaveValue(project.id);
  await eventSheet.getByLabel("Title").fill(eventTitle);
  await eventSheet.getByLabel("Starts").fill(dateInputValue(2));
  await eventSheet.getByLabel("Start time").fill("09:30");
  await eventSheet.getByRole("button", { name: "Create event" }).click();
  await expect(eventSheet).toBeHidden();
  await expect(main.getByText(eventTitle).first()).toBeVisible();
  // Event times are wall-clock values stored as UTC (src/lib/event-time.ts).
  const events = (await (await page.request.get("/api/events")).json()) as { title: string; startTime: string; hasStartTime: boolean; projectId: string | null }[];
  const event = events.find((item) => item.title === eventTitle);
  expect(event).toMatchObject({ hasStartTime: true, projectId: project.id });
  expect(event?.startTime.slice(0, 16)).toBe(`${dateInputValue(2)}T09:30`);
});

// On a phone the sheets slide up from the bottom (DES-18); wider, they open from the right as elsewhere.
test("project quick actions: the sheet sits at the bottom of a phone screen", async ({ page, isMobile }) => {
  await continueAsGuest(page);
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("Sheet side project") } })).json()) as { id: string };
  await page.goto(`/projects/${project.id}`);
  await page.locator("#main-content").getByRole("button", { name: "New task", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "New task" });
  await expect(sheet).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
  const box = await sheet.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport).toBeTruthy();
  if (isMobile) {
    // Full width, ending at the bottom edge, and shorter than the screen.
    expect(Math.round(box!.width)).toBe(viewport!.width);
    expect(Math.round(box!.y + box!.height)).toBe(viewport!.height);
    expect(box!.y).toBeGreaterThan(0);
  } else {
    expect(Math.round(box!.x + box!.width)).toBe(viewport!.width);
    expect(box!.y).toBe(0);
  }
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
  // A new project has no priority; the sheet offers all five (#361).
  await expect(sheet.getByLabel("Priority")).toHaveValue("NONE");
  await sheet.getByLabel("Priority").selectOption("HIGH");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(sheet).toBeHidden();
  await expect(card).toContainText("Shown on the card.");
  await expect(card).toContainText("High priority");

  // The project page changes it at once, and it sticks.
  await card.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await page.getByRole("combobox", { name: "Priority:" }).selectOption("URGENT");
  await expect(page.getByText("Priority set to Urgent")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Priority:" })).toHaveValue("URGENT");
  await openSection(page, "Projects");
  await expect(card).toContainText("Urgent priority");

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
