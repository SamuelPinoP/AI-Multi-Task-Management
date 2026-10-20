import { expect, test } from "@playwright/test";
import { uniqueName } from "./helpers";

// A time zone whose date differs from UTC right now: Kiritimati (UTC+14) is
// already on the next day from 10:00 UTC, Pago Pago (UTC-11) is still on the
// previous day until 11:00 UTC. CI runs the server in UTC.
const timezoneId = new Date().getUTCHours() >= 10 ? "Pacific/Kiritimati" : "Pacific/Pago_Pago";
test.use({ timezoneId });

test(`"Due Today" follows the browser's time zone (${timezoneId})`, async ({ page }) => {
  const title = uniqueName("Due in my time zone");

  await page.goto("/login");
  await page.getByRole("button", { name: /continue as guest/i }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
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
  const reminders = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Reminders", exact: true }) });
  const dueToday = reminders.locator("article").filter({ has: page.getByRole("heading", { name: "Due Today" }) });
  await expect(dueToday.getByText(title)).toBeVisible();
});
