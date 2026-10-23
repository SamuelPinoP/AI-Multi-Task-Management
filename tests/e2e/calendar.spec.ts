import { expect, test } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The Full Calendar's day panel, named after its date ("Thursday, October 22, 2026"). */
function dayPanel(page: import("@playwright/test").Page, daysFromToday = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return page.getByRole("complementary", { name: new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(date) });
}

test("calendar: Show tasks hides due tasks and is remembered; New event opens on the selected day", async ({ page }) => {
  const task = uniqueName("Calendar task");
  const event = uniqueName("Calendar event");
  const created = uniqueName("Made on the calendar");
  await continueAsGuest(page);
  expect((await page.request.post("/api/tasks", { data: { title: task, dueDate: dateInputValue(0) } })).ok()).toBe(true);
  expect(
    (
      await page.request.post("/api/events", {
        data: { title: event, startDate: dateInputValue(0), startTime: "10:00", endDate: "", endTime: "", recurrence: "NONE" },
      })
    ).ok(),
  ).toBe(true);

  await page.goto("/events/calendar");
  const today = dayPanel(page);
  await expect(today.getByRole("link", { name: task })).toBeVisible();
  await expect(today.getByRole("button", { name: event, exact: true })).toBeVisible();

  // Off: the task leaves the grid and the day panel; events stay.
  const showTasks = page.getByRole("switch", { name: "Show tasks" });
  await expect(showTasks).toHaveAttribute("aria-checked", "true");
  await showTasks.click();
  await expect(showTasks).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText(task)).toHaveCount(0);
  await expect(today.getByRole("button", { name: event, exact: true })).toBeVisible();

  // The browser remembers it.
  await page.reload();
  await expect(today.getByRole("button", { name: event, exact: true })).toBeVisible();
  await expect(showTasks).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText(task)).toHaveCount(0);
  await showTasks.click();
  await expect(today.getByRole("link", { name: task })).toBeVisible();

  // New event starts on the selected day (today) and appears there once created.
  await page.getByRole("button", { name: "New event" }).click();
  const sheet = page.getByRole("dialog", { name: "New event" });
  await expect(sheet.getByLabel("Starts")).toHaveValue(dateInputValue(0));
  await sheet.getByLabel("Title").fill(created);
  await sheet.getByLabel("Start time").fill("16:30");
  await sheet.getByRole("button", { name: "Create event" }).click();
  await expect(sheet).toBeHidden();
  await expect(today.getByRole("button", { name: created, exact: true })).toBeVisible();
  await expect(today.getByRole("article").filter({ hasText: created })).toContainText("4:30 PM");

  // The card's delete button names its event; the dialog moves it to Trash.
  await today.getByRole("button", { name: `Delete ${created}` }).click();
  const confirm = page.getByRole("dialog", { name: "Delete event?" });
  await confirm.getByRole("button", { name: "Move to Trash" }).click();
  await expect(confirm).toBeHidden();
  await expect(today.getByRole("button", { name: created, exact: true })).toHaveCount(0);
  await expect(today.getByRole("button", { name: event, exact: true })).toBeVisible();
});
