import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest } from "../e2e/helpers";

/*
 * Screenshots of the main pages, compared with reference images (TEST-05, #269).
 *
 * Each test signs in as a new guest and adds the same data. Due dates are
 * yesterday, today and tomorrow, which the pages show as words, so the images
 * don't change from day to day. The month calendar runs on a fixed clock
 * instead. What still changes between runs is masked: the greeting, times, and
 * avatar colors (they come from random user ids).
 */

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function post(page: Page, url: string, data: Record<string, unknown>) {
  const response = await page.request.post(url, { data });
  expect(response.ok(), `${url} answered ${response.status()}`).toBe(true);
  return (await response.json()) as { id: string };
}

/** Two projects and five tasks: overdue, due today, due tomorrow, and done. */
async function addTasks(page: Page) {
  const website = await post(page, "/api/projects", { name: "Launch website", color: "#0f9488" });
  const app = await post(page, "/api/projects", { name: "Mobile app", color: "#d97706" });
  await post(page, "/api/tasks", { title: "Fix the signup form", dueDate: dateInputValue(-1), priority: "HIGH", projectId: website.id });
  await post(page, "/api/tasks", { title: "Write the launch post", dueDate: dateInputValue(0), priority: "HIGH", projectId: website.id });
  await post(page, "/api/tasks", { title: "Review open pull requests", dueDate: dateInputValue(0), priority: "MEDIUM", status: "IN_PROGRESS", projectId: app.id });
  await post(page, "/api/tasks", { title: "Plan the next sprint", dueDate: dateInputValue(1), priority: "LOW" });
  await post(page, "/api/tasks", { title: "Set up the domain", priority: "MEDIUM", status: "DONE", projectId: website.id });
}

/** Parts of every page that differ between runs. */
function changing(page: Page) {
  return [
    page.locator("time"),
    page.getByRole("button", { name: "Account menu" }),
    page.locator("#main-content .rounded-full[style*='background-color']"),
  ];
}

test("Home", async ({ page }) => {
  await continueAsGuest(page);
  await addTasks(page);

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Write the launch post" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  // The header says good morning, afternoon or evening, and today's date.
  await expect(page).toHaveScreenshot("home.png", { mask: [...changing(page), page.locator("#main-content header").first()] });
});

test("Tasks", async ({ page }) => {
  await continueAsGuest(page);
  await addTasks(page);

  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: "Plan the next sprint", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("tasks.png", { mask: changing(page) });
});

test("Boards", async ({ page }) => {
  await continueAsGuest(page);
  // The board shows due dates as calendar dates, so these tasks have none.
  const project = await post(page, "/api/projects", { name: "Launch website", color: "#0f9488" });
  await post(page, "/api/tasks", { title: "Write the launch post", priority: "HIGH", projectId: project.id });
  await post(page, "/api/tasks", { title: "Pick a hosting plan", priority: "LOW", projectId: project.id });
  await post(page, "/api/tasks", { title: "Fix the signup form", priority: "HIGH", status: "IN_PROGRESS", projectId: project.id });
  await post(page, "/api/tasks", { title: "Set up the domain", priority: "MEDIUM", status: "DONE", projectId: project.id });

  await page.goto("/board");
  await expect(page.getByRole("heading", { name: "Fix the signup form" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("boards.png", { mask: changing(page) });
});

test("Calendar", async ({ page }) => {
  await continueAsGuest(page);
  // The month grid is drawn in the browser, so a fixed clock fixes the month.
  await page.clock.setFixedTime(new Date("2026-03-11T12:00:00Z"));
  await post(page, "/api/events", { title: "Team standup", startDate: "2026-03-02", startTime: "09:00", endDate: "2026-03-02", endTime: "09:30", recurrence: "WEEKLY" });
  await post(page, "/api/events", { title: "Design review", startDate: "2026-03-11", startTime: "14:00", endDate: "2026-03-11", endTime: "15:00", recurrence: "NONE" });
  await post(page, "/api/events", { title: "Release day", startDate: "2026-03-18", startTime: "", endDate: "", endTime: "", recurrence: "NONE" });
  await post(page, "/api/events", { title: "Retrospective", startDate: "2026-03-27", startTime: "16:00", endDate: "2026-03-27", endTime: "17:00", recurrence: "NONE" });

  await page.goto("/events/calendar");
  await expect(page.getByRole("heading", { name: "March 2026" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("calendar.png", { mask: changing(page) });
});
