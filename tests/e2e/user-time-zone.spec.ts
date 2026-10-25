import { expect, test } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

// A time zone whose date differs from UTC right now: Kiritimati (UTC+14) is
// already on the next day from 10:00 UTC, Pago Pago (UTC-11) is still on the
// previous day until 11:00 UTC. CI runs the server in UTC.
const timezoneId = new Date().getUTCHours() >= 10 ? "Pacific/Kiritimati" : "Pacific/Pago_Pago";
test.use({ timezoneId });

// The title stays fixed: Playwright lists tests in one process and runs them in
// another, so a title with the zone in it changed when a run crossed 00:00 or
// 10:00 UTC, and the test was "not found in the worker process".
test(`"Due today" follows the browser's time zone`, async ({ page }) => {
  test.info().annotations.push({ type: "time zone", description: timezoneId });
  const title = uniqueName("Due in my time zone");

  await continueAsGuest(page);
  await expect
    .poll(async () => (await page.context().cookies()).find((cookie) => cookie.name === "tz")?.value)
    .toBe(encodeURIComponent(timezoneId));

  const browserToday = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const response = await page.request.post("/api/tasks", { data: { title, dueDate: browserToday } });
  expect(response.ok()).toBe(true);

  await page.reload();
  await expect(page.getByRole("group", { name: "Due today: 1" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Overdue: 0" })).toBeVisible();
  const focus = page.locator("section").filter({ has: page.getByRole("heading", { name: "Focus", exact: true }) });
  await expect(focus.getByRole("listitem").filter({ hasText: title })).toContainText("Today");
});
