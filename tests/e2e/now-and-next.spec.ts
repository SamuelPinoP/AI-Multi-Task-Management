import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

// DES-10: the band compares event times with the user's wall clock. The browser
// runs in a zone where it is midday right now, so the events below stay on one
// day whatever the time in UTC. CI runs the server in UTC; Etc/GMT-N is UTC+N.
const offset = 12 - new Date().getUTCHours();
const timezoneId = offset === 0 ? "Etc/UTC" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
test.use({ timezoneId });

async function signIn(page: Page) {
  await continueAsGuest(page);
  await expect
    .poll(async () => (await page.context().cookies()).find((cookie) => cookie.name === "tz")?.value)
    .toBe(encodeURIComponent(timezoneId));
}

/** The browser's date `days` from today, and its wall-clock time `minutes` from now, as the forms take them. */
async function wallClock(page: Page, days: number, minutes: number[] = []) {
  return page.evaluate(
    ({ days, minutes }) => {
      const pad = (value: number) => String(value).padStart(2, "0");
      const now = new Date();
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
      return {
        date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        times: minutes.map((offset) => {
          const at = new Date(now.getTime() + offset * 60_000);
          return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
        }),
      };
    },
    { days, minutes },
  );
}

test("Now and next shows the event under way, the next event, and a task to start", async ({ page }) => {
  test.info().annotations.push({ type: "time zone", description: timezoneId });
  const review = uniqueName("Design review");
  const standup = uniqueName("Standup");
  const task = uniqueName("Ship the report");
  await signIn(page);

  const {
    date,
    times: [start, end, nextStart, nextEnd],
  } = await wallClock(page, 0, [-30, 30, 90, 105]);
  for (const data of [
    { title: review, startDate: date, startTime: start, endDate: "", endTime: end, recurrence: "NONE" },
    { title: standup, startDate: date, startTime: nextStart, endDate: "", endTime: nextEnd, recurrence: "NONE" },
  ]) {
    expect((await page.request.post("/api/events", { data })).ok()).toBe(true);
  }
  expect((await page.request.post("/api/tasks", { data: { title: task, dueDate: date, priority: "HIGH" } })).ok()).toBe(true);

  await page.reload();
  const band = page.getByRole("region", { name: "Now and next" });
  await expect(band.getByRole("link", { name: review })).toBeVisible();
  await expect(band.getByRole("progressbar", { name: `${review} progress` })).toBeVisible();
  await expect(band).toContainText(/\d+ min left · until/);
  await expect(band.getByRole("link", { name: standup })).toBeVisible();
  await expect(band).toContainText(/in 1 h \d+ min/);
  await expect(band).toContainText(task);

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => localStorage.setItem("ai-multi-theme", value), theme);
    await page.reload();
    await expect(band.getByRole("button", { name: `Start ${task}` })).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[aria-label="Now and next"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`), `the band (${theme})`).toEqual([]);
  }

  // Start marks the task In progress and opens it.
  await band.getByRole("button", { name: `Start ${task}` }).click();
  await expect(page).toHaveURL(/\/tasks\?task=/);
  await expect(page.getByText("Task started")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Edit task" }).getByLabel("Status")).toHaveValue("IN_PROGRESS");
});

test("with nothing under way, Now shows the top Focus task and Next points to the calendar", async ({ page }) => {
  test.info().annotations.push({ type: "time zone", description: timezoneId });
  const late = uniqueName("Late report");
  const later = uniqueName("Call the venue");
  await signIn(page);

  const { date: yesterday } = await wallClock(page, -1);
  const { date: today } = await wallClock(page, 0);
  for (const data of [
    { title: late, dueDate: yesterday, priority: "LOW" },
    { title: later, dueDate: today },
  ]) {
    expect((await page.request.post("/api/tasks", { data })).ok()).toBe(true);
  }

  await page.reload();
  const band = page.getByRole("region", { name: "Now and next" });
  await expect(band.getByRole("link", { name: late })).toBeVisible();
  await expect(band).toContainText("Top of your list · Yesterday");
  await expect(band).toContainText("No events today");
  await expect(band.getByRole("link", { name: "Open calendar" })).toHaveAttribute("href", "/events/calendar");
  // Suggested next skips the task Now already shows.
  await expect(band.getByRole("button", { name: `Start ${later}` })).toBeVisible();
  await expect(band.getByRole("button", { name: `Start ${late}` })).toHaveCount(0);
});
