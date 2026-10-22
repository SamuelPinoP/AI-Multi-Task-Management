import AxeBuilder from "@axe-core/playwright";
import { expect, request as playwrightRequest, test } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

// SMART-09: a private link calendar apps subscribe to, showing events and due tasks.

/** `YYYY-MM-DD`, `days` from today in the browser's (and the server's, in CI: UTC) time zone. */
function dateInputValue(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("the calendar link serves events and due tasks until it's replaced or turned off", async ({ page, baseURL }) => {
  await continueAsGuest(page);
  const meeting = uniqueName("Weekly sync");
  const holiday = uniqueName("Team day off");
  const dueTask = uniqueName("Send the report");
  const doneTask = uniqueName("Already done");
  const post = async (url: string, data: Record<string, unknown>) => expect((await page.request.post(url, { data })).ok()).toBe(true);
  await post("/api/events", {
    title: meeting,
    startDate: dateInputValue(1),
    startTime: "09:00",
    endDate: "",
    endTime: "09:30",
    recurrence: "WEEKLY",
    repeatUntil: dateInputValue(29),
    location: "Room 4, 2nd floor",
  });
  await post("/api/events", { title: holiday, startDate: dateInputValue(3), startTime: "", endDate: "", endTime: "" });
  await post("/api/tasks", { title: dueTask, dueDate: dateInputValue(2) });
  await post("/api/tasks", { title: doneTask, dueDate: dateInputValue(2), status: "DONE" });

  await page.goto("/events/calendar");
  await page.getByRole("button", { name: "Subscribe" }).click();
  const dialog = page.getByRole("dialog", { name: "Add to your calendar" });
  await dialog.getByRole("button", { name: "Create my calendar link" }).click();
  const linkInput = dialog.getByLabel("Calendar link");
  await expect(linkInput).toHaveValue(/\/api\/calendar\/[A-Za-z0-9_-]{32}\.ics$/);
  const firstLink = await linkInput.inputValue();
  await expect(dialog.getByRole("link", { name: "Open in Apple Calendar or Outlook" })).toHaveAttribute("href", firstLink.replace(/^http:/, "webcal:"));
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);

  // Calendar apps fetch it with no session: the link is the key.
  const calendarApp = await playwrightRequest.newContext({ baseURL });
  const feed = await calendarApp.get(firstLink);
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toContain("text/calendar");
  const body = (await feed.text()).replace(/\r\n /g, "");
  expect(body).toMatch(/^BEGIN:VCALENDAR\r\n/);
  expect(body).toContain(`SUMMARY:${meeting}`);
  expect(body).toContain(`DTSTART:${dateInputValue(1).replace(/-/g, "")}T090000`);
  expect(body).toContain(`RRULE:FREQ=WEEKLY;UNTIL=${dateInputValue(29).replace(/-/g, "")}T235959`);
  expect(body).toContain("LOCATION:Room 4\\, 2nd floor");
  expect(body).toContain(`SUMMARY:${holiday}`);
  expect(body).toContain(`DTSTART;VALUE=DATE:${dateInputValue(3).replace(/-/g, "")}`);
  expect(body).toContain(`SUMMARY:Due: ${dueTask}`);
  expect(body).not.toContain(doneTask);

  // A new link replaces the old one.
  await dialog.getByRole("button", { name: "New link" }).click();
  await dialog.getByRole("button", { name: "Make a new link" }).click();
  await expect(linkInput).not.toHaveValue(firstLink);
  const secondLink = await linkInput.inputValue();
  expect((await calendarApp.get(firstLink)).status()).toBe(404);
  expect((await calendarApp.get(secondLink)).status()).toBe(200);

  // Turning it off stops the feed; the link is remembered when the dialog opens again.
  await dialog.getByRole("button", { name: "Turn off" }).click();
  await dialog.getByRole("button", { name: "Turn off" }).click();
  await expect(dialog.getByRole("button", { name: "Create my calendar link" })).toBeVisible();
  expect((await calendarApp.get(secondLink)).status()).toBe(404);

  // Malformed links and signed-out link management get nothing.
  expect((await calendarApp.get("/api/calendar/not-a-token.ics")).status()).toBe(404);
  expect((await calendarApp.get("/api/calendar-feed")).status()).toBe(401);
  expect((await calendarApp.post("/api/calendar-feed")).status()).toBe(401);
  await calendarApp.dispose();
});
