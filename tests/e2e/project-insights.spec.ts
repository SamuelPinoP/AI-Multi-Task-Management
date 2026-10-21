import { expect, test } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

test("project health: status, progress, overdue ratio and the burn-up chart", async ({ page }) => {
  await continueAsGuest(page);
  const yesterday = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("Insights") } })).json()) as { id: string };
  const createTask = async (data: Record<string, unknown>) =>
    (await (await page.request.post("/api/tasks", { data: { projectId: project.id, ...data } })).json()) as { id: string; title: string };
  const late = await createTask({ title: "Late task", dueDate: yesterday });
  await createTask({ title: "Open task" });
  const finished = await createTask({ title: "Finished task" });
  const patch = (task: { id: string; title: string }, status: string, dueDate: string | null = null) =>
    page.request.patch(`/api/tasks/${task.id}`, {
      data: { title: task.title, status, priority: "MEDIUM", recurrence: "NONE", projectId: project.id, dueDate },
    });
  expect((await patch(finished, "DONE")).ok()).toBe(true);

  await page.goto(`/projects/${project.id}`);
  const section = page.getByRole("region", { name: "Health and insights" });
  await expect(section.getByText("At risk", { exact: true })).toBeVisible();
  await expect(section.getByText("1 task past due")).toBeVisible();
  await expect(section.getByRole("group", { name: "Progress" })).toContainText("33%");
  await expect(section.getByRole("group", { name: "Progress" })).toContainText("1 of 3 tasks done");
  await expect(section.getByRole("progressbar", { name: "Tasks done" })).toHaveAttribute("aria-valuenow", "33");
  await expect(section.getByRole("group", { name: "Overdue" })).toContainText("50% of 2 open tasks");
  await expect(section.getByRole("group", { name: "Done this week" })).toContainText("1");

  // The chart reads out a point per arrow key; the table has every point.
  const chart = section.getByRole("group", { name: /Burn-up chart: 1 of 3 tasks done as of today/ });
  await chart.focus();
  await expect(chart.getByRole("status")).toContainText("Today");
  await chart.press("ArrowLeft");
  await expect(chart.getByRole("status")).not.toContainText("Today");
  await section.getByText("Show as a table").click();
  const lastRow = section.getByRole("region", { name: "Burn-up data" }).getByRole("row").last();
  await expect(lastRow).toHaveText(/Today\s*1\s*3/);

  // Finishing the late task puts the project back on track.
  expect((await patch(late, "DONE", yesterday)).ok()).toBe(true);
  await page.reload();
  await expect(section.getByText("On track", { exact: true })).toBeVisible();
  await expect(section.getByText("Nothing is overdue")).toBeVisible();
  await expect(section.getByRole("group", { name: "Progress" })).toContainText("67%");
});
