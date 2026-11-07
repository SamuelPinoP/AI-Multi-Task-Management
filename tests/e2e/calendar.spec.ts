import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** How the Month tab names a day: "Thursday, October 22, 2026". */
function fullDate(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(date);
}

/** On a phone, the selected day's list under the grid, named after its date. */
function dayPanel(page: Page, daysFromToday = 0) {
  return page.getByRole("complementary", { name: fullDate(daysFromToday) });
}

/**
 * A day's details: on a phone the list under the grid; on wider screens the
 * day's pop-over (design 4B, #363), opened from its number when it's closed.
 */
async function openDay(page: Page, isMobile: boolean, daysFromToday = 0) {
  if (isMobile) return dayPanel(page, daysFromToday);
  const popover = page.getByRole("dialog", { name: fullDate(daysFromToday) });
  if (!(await popover.isVisible())) await page.getByRole("button", { name: new RegExp(`^${fullDate(daysFromToday)}(, today)?, `) }).click();
  await expect(popover).toBeVisible();
  return popover;
}

test("calendar: Show tasks hides due tasks and is remembered; New event opens on the selected day", async ({ page, isMobile }) => {
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
  let today = await openDay(page, isMobile);
  await expect(today.getByRole("link", { name: task })).toBeVisible();
  await expect(today.getByRole("button", { name: event, exact: true })).toBeVisible();

  // Off: the task leaves the grid and the day's details; events stay.
  const showTasks = page.getByRole("switch", { name: "Show tasks" });
  await expect(showTasks).toHaveAttribute("aria-checked", "true");
  await showTasks.click();
  await expect(showTasks).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText(task)).toHaveCount(0);
  today = await openDay(page, isMobile);
  await expect(today.getByRole("button", { name: event, exact: true })).toBeVisible();

  // The browser remembers it.
  await page.reload();
  today = await openDay(page, isMobile);
  await expect(today.getByRole("button", { name: event, exact: true })).toBeVisible();
  await expect(showTasks).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText(task)).toHaveCount(0);
  await showTasks.click();
  today = await openDay(page, isMobile);
  await expect(today.getByRole("link", { name: task })).toBeVisible();

  // New event starts on the selected day (today) and appears there once created.
  await page.getByRole("button", { name: "New event" }).click();
  const sheet = page.getByRole("dialog", { name: "New event" });
  await expect(sheet.getByLabel("Starts")).toHaveValue(dateInputValue(0));
  await sheet.getByLabel("Title").fill(created);
  await sheet.getByLabel("Start time").fill("16:30");
  await sheet.getByRole("button", { name: "Create event" }).click();
  await expect(sheet).toBeHidden();
  today = await openDay(page, isMobile);
  await expect(today.getByRole("button", { name: created, exact: true })).toBeVisible();
  await expect(today.getByRole("article").filter({ hasText: created })).toContainText("4:30 PM");

  // The card's delete button names its event; the dialog moves it to Trash.
  await today.getByRole("button", { name: `Delete ${created}` }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this event?" });
  await confirm.getByRole("button", { name: "Move to Trash" }).click();
  await expect(confirm).toBeHidden();
  today = await openDay(page, isMobile);
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

test("calendar: delete one day of a repeating event, undo it, then that day and later, then the series", async ({ page, isMobile }) => {
  const standup = uniqueName("Daily stand-up");
  await continueAsGuest(page);
  const created = await page.request.post("/api/events", {
    data: { title: standup, startDate: dateInputValue(-3), startTime: "09:00", endDate: "", endTime: "09:15", recurrence: "DAILY" },
  });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };

  // Only today: the dialog offers the three choices, with "Only <today>" picked.
  await page.goto("/events/calendar");
  let today = await openDay(page, isMobile);
  await today.getByRole("button", { name: `Delete ${standup}` }).click();
  const dialog = page.getByRole("dialog", { name: "Delete a repeating event" });
  await expect(dialog.getByRole("radio", { name: new RegExp(`^Only ${longDay(0)}`) })).toBeChecked();
  await expect(dialog.getByRole("radio")).toHaveCount(3);
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toBeHidden();
  today = await openDay(page, isMobile);
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
  today = await openDay(page, isMobile);
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

// DES-16 (#331): on a phone the Month tab is a month grid with a dot per item; the selected
// day's events and tasks are listed under it, and the grid can shrink to one week.
test("calendar on a phone: pick a day in the month grid, then move a week at a time", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The grid with dots replaces the month's previews below 640 px.");
  const event = uniqueName("Phone event");
  const task = uniqueName("Phone task");
  // A day in this month besides today, so it's in the grid whatever the date.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const offset = tomorrow.getMonth() === new Date().getMonth() ? 1 : -1;
  await continueAsGuest(page);
  expect((await page.request.post("/api/tasks", { data: { title: task, dueDate: dateInputValue(offset) } })).ok()).toBe(true);
  expect(
    (
      await page.request.post("/api/events", {
        data: { title: event, startDate: dateInputValue(offset), startTime: "10:00", endDate: "", endTime: "", recurrence: "NONE" },
      })
    ).ok(),
  ).toBe(true);

  await page.goto("/events/calendar");
  const grid = page.locator("#calendar-phone-grid");
  await expect(grid.getByRole("button", { pressed: true })).toHaveAccessibleName(`${fullDate(0)}, today, nothing planned`);

  // The day's button counts its items; picking it lists them under the grid, the event's time first.
  const day = grid.getByRole("button", { name: `${fullDate(offset)}, 2 items` });
  await day.click();
  await expect(day).toHaveAttribute("aria-pressed", "true");
  const panel = dayPanel(page, offset);
  await expect(panel.getByRole("link", { name: task })).toBeVisible();
  const eventCard = panel.getByRole("article").filter({ has: page.getByRole("button", { name: event, exact: true }) });
  await expect(eventCard.getByText("10:00 AM", { exact: true }).filter({ visible: true })).toHaveCount(1);

  // One week: seven days, and Next week moves the selection seven days on.
  await page.getByRole("button", { name: "Show one week" }).click();
  await expect(grid.getByRole("button")).toHaveCount(7);
  await expect(day).toBeVisible();
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(dayPanel(page, offset + 7)).toBeVisible();
  await expect(grid.getByRole("button", { pressed: true })).toHaveAccessibleName(new RegExp(`^${fullDate(offset + 7)}`));

  // Back to the month, then to today.
  await page.getByRole("button", { name: "Show the month" }).click();
  expect(await grid.getByRole("button").count()).toBeGreaterThanOrEqual(28);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(dayPanel(page, 0)).toBeVisible();
  await expect(grid.getByRole("button", { pressed: true })).toHaveAccessibleName(`${fullDate(0)}, today, nothing planned`);
});

/** How the highlight banner names a due day: "Thursday, Nov 12". */
function bannerDay(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(date);
}

test("calendar: Show in calendar highlights the task and says why, until it's cleared (#363)", async ({ page, isMobile }) => {
  const title = uniqueName("Calendar highlight");
  await continueAsGuest(page);
  const task = (await (await page.request.post("/api/tasks", { data: { title, dueDate: dateInputValue(2), priority: "MEDIUM" } })).json()) as { id: string };

  // The task's page links here.
  await page.goto(`/tasks/${task.id}`);
  await page.getByRole("link", { name: "Show in calendar" }).click();
  await page.waitForURL((url) => url.pathname === "/events/calendar" && url.searchParams.get("task") === task.id);

  // A banner gives the reason, and the day's details say "Highlighted" in words as well as color.
  const banner = page.getByRole("status").filter({ hasText: "Highlighted because you opened it from Tasks." });
  await expect(banner).toContainText(`“${title}” is due ${bannerDay(2)}.`);
  const day = isMobile ? dayPanel(page, 2) : page.getByRole("dialog", { name: fullDate(2) });
  await expect(day.getByRole("article").filter({ hasText: title })).toContainText("Highlighted from Tasks");
  if (!isMobile) await expect(page.getByText(`Highlighted: ${title}`)).toBeVisible();
  await expect(banner.getByRole("link", { name: "Open task" })).toHaveAttribute("href", `/tasks/${task.id}`);

  // The highlight passes axe in this theme.
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  const axe = await new AxeBuilder({ page }).include("#main-content").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.nodes[0]?.target.join(" ")}`)).toEqual([]);

  // Clear: the link loses the task, and the task stays on its day as a plain item.
  await banner.getByRole("button", { name: "Clear highlight" }).click();
  await expect(page).toHaveURL(/\/events\/calendar$/);
  await expect(page.getByRole("status").filter({ hasText: "Highlighted because" })).toHaveCount(0);
  const after = await openDay(page, isMobile, 2);
  await expect(after.getByRole("link", { name: title })).toBeVisible();
  await expect(after.getByRole("article").filter({ hasText: title })).not.toContainText("Highlighted");
});

test("calendar: a highlighted task without a due date gets one by picking a day, with Undo (#363)", async ({ page }) => {
  const title = uniqueName("No date yet");
  await continueAsGuest(page);
  const task = (await (await page.request.post("/api/tasks", { data: { title } })).json()) as { id: string };
  const dueDate = async () => ((await (await page.request.get(`/api/tasks/${task.id}`)).json()) as { dueDate: string | null }).dueDate;
  // A day of this month other than today, so it's in the grid whatever the date.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const offset = tomorrow.getMonth() === new Date().getMonth() ? 1 : -1;

  await page.goto(`/events/calendar?task=${task.id}`);
  // The app shell has a status region of its own, so the banner is found by the task's title.
  const banner = page.getByRole("status").filter({ hasText: title });
  await expect(banner).toContainText(`“${title}” has no due date yet. Pick a day below to set one.`);

  // Picking a day sets it, and the banner switches to the highlight.
  await page.getByRole("button", { name: new RegExp(`^${fullDate(offset)}, `) }).click();
  await expect(page.getByText("Due date set")).toBeVisible();
  await expect(banner).toContainText(`“${title}” ${offset > 0 ? "is due" : "was due"} ${bannerDay(offset)}`);
  expect((await dueDate())?.slice(0, 10)).toBe(dateInputValue(offset));

  // Undo takes it away again.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(banner).toContainText("has no due date yet");
  await expect.poll(dueDate).toBeNull();
});
