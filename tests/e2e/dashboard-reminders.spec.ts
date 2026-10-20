import { expect, test } from "@playwright/test";
import { uniqueName } from "./helpers";

/** A `YYYY-MM-DD` date input value, counted from today in this process's time zone. */
function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

test("reminders include today's occurrence of a weekly event that started weeks ago", async ({ page }) => {
  const weekly = uniqueName("Weekly stand-up");
  const oneOff = uniqueName("Old one-off event");

  await page.goto("/login");
  await page.getByRole("button", { name: /continue as guest/i }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // Both start three weeks ago; only the weekly one happens again today.
  for (const [title, recurrence] of [[weekly, "WEEKLY"], [oneOff, "NONE"]]) {
    const response = await page.request.post("/api/events", {
      data: { title, startDate: dateInputValue(-21), startTime: "12:00", endDate: "", endTime: "", recurrence },
    });
    expect(response.ok()).toBe(true);
  }

  await page.reload();
  const reminders = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Reminders", exact: true }) });
  const todaysEvents = reminders
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Today's Events" }) });
  await expect(todaysEvents.getByText(weekly)).toBeVisible();
  await expect(reminders.getByText(oneOff)).toHaveCount(0);
});
