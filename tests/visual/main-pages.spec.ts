import { expect, test, type Browser, type Page } from "@playwright/test";
import { AI_NOTICE_VERSION } from "../../src/lib/ai/notice";
import { continueAsGuest, openAccountMenu, signUpAndLogIn } from "../e2e/helpers";

/*
 * Screenshots of the main pages, compared with reference images (TEST-05, #269).
 * Home is also taken in dark mode (DES-10), with a teammate who has left an
 * unread message in Team chat (DES-11), and Tasks with the Blue accent and the
 * account menu open (DES-15).
 *
 * Each test signs up a new account and adds the same data (guest workspaces
 * hold too little for it since #458; the last test shows the guest profile). Due dates are
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

/** Two projects and five tasks: overdue, due today, due tomorrow, and done. Returns the first project's id. */
async function addTasks(page: Page) {
  const website = await post(page, "/api/projects", { name: "Launch website", color: "#0f9488" });
  const app = await post(page, "/api/projects", { name: "Mobile app", color: "#d97706" });
  await post(page, "/api/tasks", { title: "Fix the signup form", dueDate: dateInputValue(-1), priority: "HIGH", projectId: website.id });
  await post(page, "/api/tasks", { title: "Write the launch post", dueDate: dateInputValue(0), priority: "HIGH", projectId: website.id });
  await post(page, "/api/tasks", { title: "Review open pull requests", dueDate: dateInputValue(0), priority: "MEDIUM", status: "IN_PROGRESS", projectId: app.id });
  await post(page, "/api/tasks", { title: "Plan the next sprint", dueDate: dateInputValue(1), priority: "LOW" });
  await post(page, "/api/tasks", { title: "Set up the domain", priority: "MEDIUM", status: "DONE", projectId: website.id });
  return website.id;
}

/** A teammate joins the project and leaves a message, so Home shows Team chat. Their name is random, but chat shows only "E2E". */
async function addTeammate(page: Page, browser: Browser, baseURL: string | undefined, projectId: string) {
  const context = await browser.newContext({ baseURL });
  try {
    const teammate = await context.newPage();
    const { email } = await signUpAndLogIn(teammate, "E2E teammate");
    await post(page, `/api/projects/${projectId}/invitations`, { email, role: "EDITOR" });
    const invitations = (await (await teammate.request.get("/api/project-invitations")).json()) as { id: string; project: { id: string } }[];
    const invitation = invitations.find((item) => item.project.id === projectId);
    expect(invitation, "the invitation reached the teammate").toBeTruthy();
    expect((await teammate.request.patch(`/api/project-invitations/${invitation!.id}`, { data: { action: "ACCEPT" } })).ok()).toBe(true);
    await post(teammate, `/api/projects/${projectId}/comments`, { message: "The staging build is ready for review." });
  } finally {
    await context.close();
  }
}

/** Parts of every page that differ between runs. */
function changing(page: Page) {
  return [
    page.locator("time"),
    // The profile button's avatar and name differ per account (#404). includeHidden: an open menu
    // hides the rest of the page, the button included, from role queries.
    page.getByRole("button", { name: /Settings and theme$/, includeHidden: true }),
    page.locator("#main-content .rounded-full[style*='background-color']"),
  ];
}

async function screenshotHome(page: Page, name: string) {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Write the launch post" }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  // The header says good morning, afternoon or evening, and today's date. The
  // activities are created within the same moment, so their order varies.
  const activity = page.locator("section", { has: page.getByRole("heading", { name: "Activity", exact: true }) }).locator("ul");
  await expect(page).toHaveScreenshot(name, { mask: [...changing(page), page.locator("#main-content header").first(), activity] });
}

test("Home", async ({ page, browser, baseURL }) => {
  await signUpAndLogIn(page, "E2E visual");
  await addTeammate(page, browser, baseURL, await addTasks(page));
  await screenshotHome(page, "home.png");
});

test("Home in dark mode", async ({ page, browser, baseURL }) => {
  await signUpAndLogIn(page, "E2E visual");
  await addTeammate(page, browser, baseURL, await addTasks(page));
  await page.evaluate(() => localStorage.setItem("ai-multi-theme", "dark"));
  await screenshotHome(page, "home-dark.png");
});

test("Tasks", async ({ page }) => {
  await signUpAndLogIn(page, "E2E visual");
  await addTasks(page);

  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: "Plan the next sprint", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("tasks.png", { mask: changing(page) });
});

// DES-15: another accent palette, with the account menu open on its swatches.
test("Tasks with the Blue accent", async ({ page }) => {
  await signUpAndLogIn(page, "E2E visual");
  await addTasks(page);
  await page.evaluate(() => localStorage.setItem("ai-multi-accent", "blue"));

  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: "Plan the next sprint", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  // On a phone the profile menu opens from the top bar (#461), beside the menu button.
  await openAccountMenu(page);
  await expect(page.getByRole("menuitemradio", { name: "Blue" })).toHaveAttribute("aria-checked", "true");
  await expect(page).toHaveScreenshot("tasks-blue.png", { mask: changing(page) });
});

test("Boards", async ({ page }) => {
  await signUpAndLogIn(page, "E2E visual");
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

// #308: the AI page with an answer from the e2e server's fake model, which lists the tasks it looked
// up, with links to them, and the sidebar's ✦ selected. Guests can't use the assistant, so it's an account.
test("AI page", async ({ page }) => {
  await signUpAndLogIn(page, "E2E user");
  await addTasks(page);
  expect((await page.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).ok()).toBe(true);

  await page.goto("/ai");
  await page.getByRole("textbox", { name: "Message the AI" }).fill("What's on my plate? list_open_tasks");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("list", { name: "Used to answer" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("ai.png", { mask: changing(page) });
});

test("Calendar", async ({ page }) => {
  await signUpAndLogIn(page, "E2E visual");
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

// The guest profile (#458, design 2C) where an account's row sits: at the bottom of the sidebar, and of the
// menu sheet on a phone. The avatar's color comes from the random id, so it's masked.
test("Guest profile", async ({ page }) => {
  // Reduced motion hides Sign up free's sweep of light, which a picture could catch mid-way.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await continueAsGuest(page);
  await post(page, "/api/tasks", { title: "Plan the next sprint", priority: "LOW" });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const profile = page.getByRole("region", { name: "Guest workspace" });
  if (!(await profile.isVisible())) await page.getByRole("button", { name: /^Open navigation/ }).click();
  await expect(profile.getByText("4 left")).toBeVisible();
  await expect(profile).toHaveScreenshot("guest-profile.png", { mask: [profile.locator("[style*='background-color']")] });
});
