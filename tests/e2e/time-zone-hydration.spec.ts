import { expect, test, type Locator, type Page } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

// Production and CI servers run in UTC (TZ=UTC here). Times the server renders must read the same in
// the browser, or React throws the server's HTML away (error #418) and renders the page again (#381).
// So this browser uses a German-language profile in a zone whose calendar day differs from UTC's
// right now: Kiritimati (UTC+14) from 10:00 UTC, Pago Pago (UTC-11) before 11:00 UTC.
const timeZone = new Date().getUTCHours() >= 10 ? "Pacific/Kiritimati" : "Pacific/Pago_Pago";
test.use({ timezoneId: timeZone, locale: "de-DE" });

const inZone = (options: Intl.DateTimeFormatOptions, instant: string | Date = new Date()) =>
  new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(new Date(instant));

/** Today in the browser's zone, as "2026-11-08". */
function todayKey() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function post<T>(page: Page, url: string, data: Record<string, unknown>) {
  const response = await page.request.post(url, { data });
  expect(response.status(), url).toBe(201);
  return (await response.json()) as T;
}

/**
 * What the reader sees. Pages stream in (the root `loading.tsx`), and the server's HTML can sit in a
 * hidden copy beside the shown page for a moment, still with the server's times.
 */
const shown = (locator: Locator) => locator.filter({ visible: true });

/** Records React's hydration errors: after a mismatch, React rebuilds the page in the browser. */
function watchHydration(page: Page) {
  const errors: string[] = [];
  const record = (text: string) => {
    if (/hydrat|React error #4(1[89]|2[0-5])\b/i.test(text)) errors.push(text.split("\n")[0]);
  };
  page.on("pageerror", (error) => record(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") record(message.text());
  });
  return errors;
}

/**
 * Opens `url` and waits until React has hydrated `ready`, so a mismatch would have been reported.
 * Without the `tz` cookie it's a first visit: the server can't know the reader's zone yet.
 */
async function open(page: Page, url: string, ready: Locator, { firstVisit }: { firstVisit: boolean }) {
  if (firstVisit) await page.context().clearCookies({ name: "tz" });
  await page.goto(url);
  await expect.poll(() => shown(ready).evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactFiber")))).toBe(true);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

// The project page used to show member notes and pending invitations with their times too; the Team
// section no longer lists either (#384), so the chat's times are the ones left to check.
test("message times read the same from the server and the browser, in the reader's zone", async ({ page }) => {
  await continueAsGuest(page);
  const project = await post<{ id: string }>(page, "/api/projects", { name: uniqueName("E2E zones") });
  const comment = await post<{ id: string; createdAt: string }>(page, `/api/projects/${project.id}/comments`, { message: "Zone check" });
  const errors = watchHydration(page);
  const messageTime = inZone({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, comment.createdAt);
  const time = shown(page.locator(`#comment-${comment.id} time`));

  for (const firstVisit of [true, false]) {
    const visit = firstVisit ? "first visit" : "with the tz cookie";

    // The chat: each message's time, and the full date and time on hover.
    errors.length = 0;
    await open(page, `/projects/${project.id}/chat`, page.getByPlaceholder(/share an update/i), { firstVisit });
    expect(errors, `chat, ${visit}`).toEqual([]);
    await expect(time).toHaveText(messageTime);
    await expect(time).toHaveAttribute("title", inZone({ dateStyle: "medium", timeStyle: "short" }, comment.createdAt));

    // The same chat opened beside the list on the Chats page.
    errors.length = 0;
    await open(page, `/chats?project=${project.id}`, page.getByPlaceholder(/share an update/i), { firstVisit });
    expect(errors, `Chats page, ${visit}`).toEqual([]);
    await expect(time).toHaveText(messageTime);

    // The project page: the chat preview.
    errors.length = 0;
    await open(page, `/projects/${project.id}`, page.getByRole("heading", { level: 1 }), { firstVisit });
    expect(errors, `project page, ${visit}`).toEqual([]);
    await expect(shown(page.getByText(`Guest Workspace • ${inZone({ dateStyle: "medium", timeStyle: "short" }, comment.createdAt)}`))).toBeVisible();
  }
});

test("calendars, boards and due dates show the reader's day in English, the same from the server and the browser", async ({ page }) => {
  await continueAsGuest(page);
  const today = todayKey();
  const project = await post<{ id: string }>(page, "/api/projects", { name: uniqueName("E2E zone days") });
  const task = await post<{ id: string }>(page, "/api/tasks", { title: uniqueName("E2E zone task"), dueDate: today, projectId: project.id });
  // With an event, the project page shows its calendar instead of an empty note.
  await post(page, "/api/events", { title: "Zone event", startDate: today, startTime: "10:00", endDate: "", endTime: "", recurrence: "NONE", projectId: project.id });
  const errors = watchHydration(page);
  const [year, month, day] = today.split("-").map(Number);
  const dayLabel = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
  const fullDay = dayLabel({ dateStyle: "full" });
  const due = `Due: ${dayLabel({})}`;

  for (const firstVisit of [true, false]) {
    const visit = firstVisit ? "first visit" : "with the tz cookie";

    // The Calendar's month view marks the reader's today.
    errors.length = 0;
    await open(page, "/events/calendar", page.getByRole("heading", { level: 1, name: "Calendar" }), { firstVisit });
    expect(errors, `Calendar, ${visit}`).toEqual([]);
    await expect(shown(page.getByRole("button", { name: new RegExp(`^${fullDay}, today, `) }))).toBeVisible();

    // The task's own page: the due date button.
    errors.length = 0;
    const dueButton = page.getByRole("button", { name: `Due date: ${dayLabel({ weekday: "short", month: "short", day: "numeric" })}` });
    await open(page, `/tasks/${task.id}`, dueButton, { firstVisit });
    expect(errors, `task page, ${visit}`).toEqual([]);

    // The project page: the task's due date, and the project calendar on today.
    errors.length = 0;
    await open(page, `/projects/${project.id}`, page.getByRole("heading", { level: 1 }), { firstVisit });
    expect(errors, `project page, ${visit}`).toEqual([]);
    await expect(shown(page.getByText(due, { exact: true }))).toBeVisible();
    await expect(shown(page.getByRole("heading", { level: 4, name: fullDay }))).toBeVisible();

    // The project's board.
    errors.length = 0;
    await open(page, `/projects/${project.id}/board`, page.getByText(due, { exact: true }), { firstVisit });
    expect(errors, `board, ${visit}`).toEqual([]);
  }
});

test("My day files a task by the reader's day, the same on the server and in the browser", async ({ page }) => {
  await continueAsGuest(page);
  const title = uniqueName("E2E due today");
  await post(page, "/api/tasks", { title, dueDate: todayKey() });
  const errors = watchHydration(page);
  const dueToday = page.locator("section").filter({ has: page.getByRole("heading", { name: "Due Today" }) });

  for (const firstVisit of [true, false]) {
    errors.length = 0;
    await open(page, "/today", page.getByRole("heading", { name: "Today", exact: true }), { firstVisit });
    expect(errors, firstVisit ? "first visit" : "with the tz cookie").toEqual([]);
    await expect(shown(page.getByText(inZone({ dateStyle: "full" }), { exact: true }))).toBeVisible();
    await expect(shown(dueToday.getByText(title))).toBeVisible();
  }
});
