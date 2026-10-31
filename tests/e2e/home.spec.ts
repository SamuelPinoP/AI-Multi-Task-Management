import { expect, test } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

test("a new workspace shows one next step in every empty card", async ({ page, isMobile }) => {
  await continueAsGuest(page);

  await expect(page.getByText("Nothing is due today.")).toBeVisible();
  for (const name of ["Due today: 0", "Overdue: 0", "Done this week: 0"]) {
    await expect(page.getByRole("group", { name })).toBeVisible();
  }
  await expect(page.getByText("Add your first task")).toBeVisible();
  await expect(page.getByRole("link", { name: "Plan an event" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create your first project" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Invite a teammate" })).toBeVisible();

  // With no events and no tasks, Now and next is one line (DES-10).
  const band = page.getByRole("region", { name: "Now and next" });
  await expect(band).toHaveText(/^No events today and no open tasks\.\s*Add a task$/);
  await band.getByRole("button", { name: "Add a task" }).click();
  await expect(page.getByLabel("Add a task", { exact: true })).toBeFocused();
  // Wider screens show the quick add's shortcuts; phones keep the placeholder only.
  const hints = page.locator("#quick-add-hints");
  await expect(hints).toContainText("#project");
  if (isMobile) await expect(hints).toBeHidden();
  else await expect(hints).toBeVisible();
});

test("quick add puts a task in Focus; completing it can be undone", async ({ page }) => {
  const title = uniqueName("Quick task");
  await continueAsGuest(page);
  const focus = page.locator("section").filter({ has: page.getByRole("heading", { name: "Focus", exact: true }) });

  await page.getByLabel("Add a task").fill(title);
  await page.getByLabel("Add a task").press("Enter");
  await expect(page.getByText("Task added")).toBeVisible();
  await expect(focus.getByRole("link", { name: title })).toBeVisible();
  await expect(page.getByLabel("Add a task")).toHaveValue("");

  await focus.getByRole("button", { name: `Complete ${title}` }).click();
  await expect(focus.getByRole("link", { name: title })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Done this week: 1" })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(focus.getByRole("link", { name: title })).toBeVisible();
  await expect(page.getByRole("group", { name: "Done this week: 0" })).toBeVisible();
});

test("Focus orders overdue work first and project health flags it", async ({ page }) => {
  await continueAsGuest(page);
  const late = uniqueName("Late task");
  const later = uniqueName("Later task");
  const project = (await (
    await page.request.post("/api/projects", { data: { name: uniqueName("Health project") } })
  ).json()) as { id: string; name: string };

  const day = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  for (const data of [
    { title: later, dueDate: day(3), priority: "HIGH" },
    { title: late, dueDate: day(-2), priority: "LOW", projectId: project.id },
  ]) {
    expect((await page.request.post("/api/tasks", { data })).ok()).toBe(true);
  }

  await page.reload();
  const focus = page.locator("section").filter({ has: page.getByRole("heading", { name: "Focus", exact: true }) });
  await expect(focus.getByRole("listitem").first()).toContainText(late);
  await expect(focus.getByRole("listitem").first()).toContainText("2 days late");
  await expect(page.getByRole("group", { name: "Overdue: 1" })).toBeVisible();

  const health = page.locator("section").filter({ has: page.getByRole("heading", { name: "Project health" }) });
  const row = health.getByRole("listitem").filter({ hasText: project.name });
  await expect(row).toContainText("At risk");
  await expect(row).toContainText("1 overdue");
});
