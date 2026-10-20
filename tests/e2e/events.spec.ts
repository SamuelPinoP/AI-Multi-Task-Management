import { expect, test } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("events: quick entry opens the sheet; repeats and multi-day events show on every day", async ({ page }) => {
  const meeting = uniqueName("Planning meeting");
  const standup = uniqueName("Daily stand-up");
  const trip = uniqueName("Field trip");
  await continueAsGuest(page);

  for (const data of [
    { title: standup, startDate: dateInputValue(-7), startTime: "09:00", recurrence: "DAILY" },
    { title: trip, startDate: dateInputValue(-1), endDate: dateInputValue(1) },
  ]) {
    expect((await page.request.post("/api/events", { data: { endDate: "", endTime: "", startTime: "", recurrence: "NONE", ...data } })).ok()).toBe(true);
  }

  await page.goto("/events");
  const today = page.getByRole("region", { name: /^Today/ });
  const tomorrow = page.getByRole("region", { name: /^Tomorrow/ });
  await expect(today.getByRole("button", { name: standup, exact: true })).toBeVisible();
  await expect(tomorrow.getByRole("button", { name: standup, exact: true })).toBeVisible();
  await expect(today.getByRole("button", { name: trip, exact: true })).toBeVisible();
  await expect(tomorrow.getByRole("button", { name: trip, exact: true })).toBeVisible();

  // Quick entry: the title carries into the sheet, which checks the times.
  await page.getByLabel("New event title").fill(meeting);
  await page.getByLabel("New event title").press("Enter");
  const sheet = page.getByRole("dialog", { name: "New event" });
  await expect(sheet.getByLabel("Title")).toHaveValue(meeting);
  await sheet.getByLabel("Starts").fill(dateInputValue(1));
  await sheet.getByLabel("Start time").fill("15:00");
  await sheet.getByLabel("Ends").fill(dateInputValue(1));
  await sheet.getByLabel("End time").fill("14:00");
  await sheet.getByRole("button", { name: "Create event" }).click();
  await expect(sheet.getByRole("alert")).toContainText("end time must be after");
  await sheet.getByLabel("End time").fill("16:00");
  await sheet.getByRole("button", { name: "Create event" }).click();
  await expect(sheet).toBeHidden();
  await expect(tomorrow.getByRole("listitem").filter({ hasText: meeting })).toContainText("3:00 PM");

  // Delete from the row menu; it goes to Trash.
  await tomorrow.getByRole("button", { name: `More actions for ${meeting}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete this event?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: meeting, exact: true })).toHaveCount(0);
  await page.goto("/trash");
  await expect(page.getByText(meeting)).toBeVisible();
});
