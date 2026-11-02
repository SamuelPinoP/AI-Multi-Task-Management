import { expect, test, type Locator } from "@playwright/test";
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
  await page.getByRole("dialog", { name: "Delete this event?" }).getByRole("button", { name: "Move to Trash" }).click();
  await expect(page.getByRole("button", { name: meeting, exact: true })).toHaveCount(0);
  await page.goto("/trash");
  await expect(page.getByText(meeting)).toBeVisible();
});

/** The agenda's heading for a day, e.g. "Tue, Oct 27". */
function agendaLabel(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

test("events: a weekly 9:00-9:15 event repeats every week until its repeat-until date", async ({ page }) => {
  const weekly = uniqueName("Weekly check-in");
  await continueAsGuest(page);
  await page.goto("/events");

  await page.getByRole("button", { name: "New event" }).click();
  const sheet = page.getByRole("dialog", { name: "New event" });
  await sheet.getByLabel("Title").fill(weekly);
  await sheet.getByLabel("Starts").fill(dateInputValue(0));
  await sheet.getByLabel("Start time").fill("09:00");
  // No end date: the end time is on the start date.
  await sheet.getByLabel("End time").fill("09:15");
  await expect(sheet.getByLabel("Repeat until")).toHaveCount(0);
  await sheet.getByLabel("Repeats").selectOption("WEEKLY");
  await sheet.getByLabel("Repeat until").fill(dateInputValue(-1));
  await sheet.getByRole("button", { name: "Create event" }).click();
  // The date field's minimum is the start date, so the browser keeps the sheet open.
  await expect(sheet.locator("#event-repeat-until:invalid")).toHaveCount(1);
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Repeat until").fill(dateInputValue(8));
  await sheet.getByRole("button", { name: "Create event" }).click();
  await expect(sheet).toBeHidden();

  // Today, in a week, and not in two weeks (after the repeat-until date).
  const row = (region: Locator) => region.getByRole("listitem").filter({ hasText: weekly });
  await expect(row(page.getByRole("region", { name: /^Today/ }))).toContainText("9:00 AM – 9:15 AM");
  await expect(row(page.getByRole("region", { name: new RegExp(`^${agendaLabel(7)}\\b`) }))).toContainText("9:00 AM – 9:15 AM");
  await expect(page.getByRole("button", { name: weekly, exact: true })).toHaveCount(2);

  // The sheet shows the first occurrence and the repeat-until date.
  await page.getByRole("region", { name: /^Today/ }).getByRole("button", { name: weekly, exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit event" });
  await expect(edit.getByLabel("Ends")).toHaveValue(dateInputValue(0));
  await expect(edit.getByLabel("End time")).toHaveValue("09:15");
  await expect(edit.getByLabel("Repeat until")).toHaveValue(dateInputValue(8));

  // Clearing it keeps the event repeating: two weeks out, it shows too.
  await edit.getByLabel("Repeat until").fill("");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  await expect(row(page.getByRole("region", { name: new RegExp(`^${agendaLabel(14)}\\b`) }))).toContainText("9:00 AM – 9:15 AM");
});

test("events API: repeat-until is checked, and an edit without it keeps it", async ({ page }) => {
  await continueAsGuest(page);
  const base = { title: uniqueName("API weekly"), startDate: dateInputValue(0), startTime: "09:00", endDate: "", endTime: "09:15", recurrence: "WEEKLY" };

  const tooEarly = await page.request.post("/api/events", { data: { ...base, repeatUntil: dateInputValue(-1) } });
  expect(tooEarly.status()).toBe(400);
  expect((await tooEarly.json()).error).toBe("Repeat until cannot be before the start date");

  const created = await page.request.post("/api/events", { data: { ...base, repeatUntil: dateInputValue(21) } });
  expect(created.ok()).toBe(true);
  const { id, repeatUntil } = (await created.json()) as { id: string; repeatUntil: string };
  expect(repeatUntil.slice(0, 10)).toBe(dateInputValue(21));

  const renamed = await page.request.patch(`/api/events/${id}`, { data: { ...base, title: `${base.title} (renamed)` } });
  expect(((await renamed.json()) as { repeatUntil: string }).repeatUntil.slice(0, 10)).toBe(dateInputValue(21));

  const oneOff = await page.request.patch(`/api/events/${id}`, { data: { ...base, recurrence: "NONE" } });
  expect(((await oneOff.json()) as { repeatUntil: string | null }).repeatUntil).toBeNull();
});
