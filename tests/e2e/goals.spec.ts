import { expect, test } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

test("goals: link tasks, track progress, review the week and carry work forward (SMART-04)", async ({ page }) => {
  await continueAsGuest(page);
  // Dates in the browser's calendar, which the server follows through the tz cookie.
  const [today, inAWeek] = await page.evaluate(() =>
    [0, 7].map((offset) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }),
  );
  const goalTitle = uniqueName("Ship the beta");
  const existing = uniqueName("Fix login bug");
  const report = uniqueName("Weekly report");
  const notes = uniqueName("Write release notes");
  expect((await page.request.post("/api/tasks", { data: { title: existing } })).ok()).toBe(true);
  expect((await page.request.post("/api/tasks", { data: { title: report, dueDate: today } })).ok()).toBe(true);

  await page.goto("/goals");
  await expect(page.getByRole("heading", { name: "Goals for this week" })).toBeVisible();
  await page.getByLabel("Add a goal for this week").fill(goalTitle);
  await page.getByRole("button", { name: "Add goal" }).click();
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: goalTitle }) });
  await expect(card).toContainText("No tasks linked yet");

  // A new task for the goal, and an existing one linked to it.
  await card.getByLabel(`New task for ${goalTitle}`).fill(notes);
  await card.getByLabel(`New task for ${goalTitle}`).press("Enter");
  await expect(card.getByRole("link", { name: notes })).toBeVisible();
  await card.getByLabel(`Link a task to ${goalTitle}`).selectOption({ label: existing });
  await card.getByRole("button", { name: "Link", exact: true }).click();
  await expect(card).toContainText("0 of 2 linked tasks done");

  // Finishing a linked task moves the goal's progress and shows in Done.
  const tasks = (await (await page.request.get("/api/tasks")).json()) as Array<{ id: string; title: string }>;
  const notesTask = tasks.find((task) => task.title === notes)!;
  expect(
    (await page.request.patch(`/api/tasks/${notesTask.id}`, { data: { title: notes, status: "DONE", priority: "MEDIUM", recurrence: "NONE" } })).ok(),
  ).toBe(true);
  await page.reload();
  await expect(card).toContainText("1 of 2 linked tasks done");
  await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  const review = page.getByRole("region", { name: "Weekly review" });
  await expect(review.getByRole("region", { name: /^Done/ })).toContainText(notes);

  // The report (due today) and the open goal slipped; one click moves both to next week.
  const slipped = review.getByRole("region", { name: /^Slipped/ });
  await expect(slipped).toContainText(report);
  await expect(slipped).toContainText(goalTitle);
  await review.getByRole("button", { name: "Carry 2 to next week" }).click();
  await expect(page.getByText("Moved 1 task and 1 goal to next week")).toBeVisible();
  await expect(slipped).toContainText("Nothing slipped");
  const next = review.getByRole("region", { name: /^Next week/ });
  await expect(next).toContainText(report);
  await expect(next).toContainText(goalTitle);
  const moved = (await (await page.request.get("/api/tasks")).json()) as Array<{ title: string; dueDate: string | null }>;
  expect(moved.find((task) => task.title === report)?.dueDate?.slice(0, 10)).toBe(inAWeek);

  // Next week holds the goal; mark it achieved there.
  await page.getByRole("button", { name: "Next week", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Goals for / })).not.toHaveText("Goals for this week");
  await card.getByRole("checkbox", { name: `Mark ${goalTitle} as achieved` }).click();
  await expect(card).toContainText("Achieved");
  await page.getByRole("button", { name: "This week", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Goals for this week" })).toBeVisible();
});
