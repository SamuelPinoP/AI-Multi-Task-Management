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
  const confirm = page.getByRole("dialog", { name: "Delete this event?" });
  await confirm.getByRole("button", { name: "Move to Trash" }).click();
  await expect(confirm).toBeHidden();
  await expect(today.getByRole("button", { name: created, exact: true })).toHaveCount(0);
  await expect(today.getByRole("button", { name: event, exact: true })).toBeVisible();
});

/** How the delete dialog names a day: "Friday, October 23". */
function longDay(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(date);
}

/** The Events agenda's heading for a day after tomorrow, e.g. "Sun, Oct 25". */
function agendaLabel(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

test("calendar: delete one day of a repeating event, undo it, then that day and later, then the series", async ({ page }) => {
  const standup = uniqueName("Daily stand-up");
  await continueAsGuest(page);
  const created = await page.request.post("/api/events", {
    data: { title: standup, startDate: dateInputValue(-3), startTime: "09:00", endDate: "", endTime: "09:15", recurrence: "DAILY" },
  });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };

  // Only today: the dialog offers the three choices, with "Only <today>" picked.
  await page.goto("/events/calendar");
  const today = dayPanel(page);
  await today.getByRole("button", { name: `Delete ${standup}` }).click();
  const dialog = page.getByRole("dialog", { name: "Delete a repeating event" });
  await expect(dialog.getByRole("radio", { name: new RegExp(`^Only ${longDay(0)}`) })).toBeChecked();
  await expect(dialog.getByRole("radio")).toHaveCount(3);
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(today.getByRole("button", { name: standup, exact: true })).toHaveCount(0);

  // The other days keep it.
  await page.goto("/events");
  await expect(page.getByRole("region", { name: /^Today/ }).getByRole("button", { name: standup, exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: /^Tomorrow/ }).getByRole("button", { name: standup, exact: true })).toBeVisible();

  // Bringing the day back (what Undo calls) shows it again.
  await page.goto("/events/calendar");
  const events = async () => (await (await page.request.get("/api/events")).json()) as Array<{ id: string; skippedDates: string[]; repeatUntil: string | null }>;
  expect((await events()).find((event) => event.id === id)?.skippedDates).toEqual([`${dateInputValue(0)}T00:00:00.000Z`]);
  expect((await page.request.patch(`/api/events/${id}/repeats`, { data: { restoreDate: dateInputValue(0) } })).ok()).toBe(true);
  await page.reload();
  await expect(today.getByRole("button", { name: standup, exact: true })).toBeVisible();

  // The same from the Events page, with the toast's Undo: two days ahead and every day after.
  await page.goto("/events");
  const later = page.getByRole("region", { name: new RegExp(`^${agendaLabel(2)}\\b`) });
  await later.getByRole("button", { name: `More actions for ${standup}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await dialog.getByText(/and every day after/).click();
  await expect(dialog.getByRole("radio", { name: /and every day after/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(later.getByRole("button", { name: standup, exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: /^Tomorrow/ }).getByRole("button", { name: standup, exact: true })).toBeVisible();
  expect((await events()).find((event) => event.id === id)?.repeatUntil).toBe(`${dateInputValue(1)}T00:00:00.000Z`);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Brought back")).toBeVisible();
  await expect(later.getByRole("button", { name: standup, exact: true })).toBeVisible();
  expect((await events()).find((event) => event.id === id)?.repeatUntil).toBeNull();

  // Every day: the series moves to Trash.
  await page.getByRole("region", { name: /^Today/ }).getByRole("button", { name: `More actions for ${standup}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await dialog.getByText(/^Every day$/).click();
  await dialog.getByRole("button", { name: "Move to Trash" }).click();
  await expect(page.getByRole("button", { name: standup, exact: true })).toHaveCount(0);
  await page.goto("/trash");
  await expect(page.getByText(standup)).toBeVisible();
});

test("events API: deleting days checks the day, the event and the request", async ({ page, request }) => {
  await continueAsGuest(page);
  const create = async (data: Record<string, string>) => {
    const response = await page.request.post("/api/events", { data: { endDate: "", endTime: "", startTime: "", recurrence: "NONE", ...data } });
    return ((await response.json()) as { id: string }).id;
  };
  const weekly = await create({ title: uniqueName("Weekly"), startDate: dateInputValue(0), recurrence: "WEEKLY" });
  const once = await create({ title: uniqueName("Once"), startDate: dateInputValue(0) });
  const patch = (id: string, data: Record<string, unknown>) => page.request.patch(`/api/events/${id}/repeats`, { data });

  expect((await patch(weekly, { skipDate: dateInputValue(1) })).status()).toBe(400); // not a day it repeats on
  expect((await patch(weekly, { skipDate: "2026-02-30" })).status()).toBe(400);
  expect((await patch(weekly, { skipDate: dateInputValue(7), restoreDate: dateInputValue(7) })).status()).toBe(400);
  expect((await patch(weekly, { repeatUntil: dateInputValue(-1) })).status()).toBe(400); // before the first day
  expect((await patch(once, { skipDate: dateInputValue(0) })).status()).toBe(400);
  expect((await patch("missing-event", { skipDate: dateInputValue(0) })).status()).toBe(404);

  // Deleting a day twice keeps one entry; bringing it back removes it.
  expect((await patch(weekly, { skipDate: dateInputValue(7) })).ok()).toBe(true);
  const twice = (await (await patch(weekly, { skipDate: dateInputValue(7) })).json()) as { skippedDates: string[] };
  expect(twice.skippedDates).toEqual([`${dateInputValue(7)}T00:00:00.000Z`]);
  const restored = (await (await patch(weekly, { restoreDate: dateInputValue(7) })).json()) as { skippedDates: string[] };
  expect(restored.skippedDates).toEqual([]);

  // The request fixture has no session.
  expect((await request.patch(`/api/events/${weekly}/repeats`, { data: { skipDate: dateInputValue(7) } })).status()).toBe(401);
});
