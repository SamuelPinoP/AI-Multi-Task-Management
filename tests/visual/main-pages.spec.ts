import { expect, test, type Browser, type Page } from "@playwright/test";
import { AI_NOTICE_VERSION } from "../../src/lib/ai/notice";
import { continueAsGuest, openAccountMenu, plusTab, signUpAndLogIn } from "../e2e/helpers";

/*
 * Screenshots of the main pages, compared with reference images (TEST-05, #269).
 * Home is also taken in dark mode (DES-10), with a teammate who has left an
 * unread message in Team chat (DES-11), and Tasks with the Blue accent and the
 * account menu open (DES-15). On phones, Tasks also has its Filter and sort sheet
 * and its add box taken (#521). The AI page is taken with a ticket's card and its
 * draft, a task's page with its description in sections (#433), and Integrations
 * with one app's steps open (#480).
 *
 * Each test signs up a new account, always named "E2E visual", and adds the same data (guest
 * workspaces hold too little for it since #458; the last test shows the guest profile). Due dates are
 * yesterday, today and tomorrow, which the pages show as words, so the images
 * don't change from day to day. The month calendar runs on a fixed clock
 * instead. What still changes between runs is masked: the greeting, times,
 * avatar colors (they come from random user ids), and the account's email.
 */

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * A new account for the test. Its name is the same in every run: a phone's top bar sizes the profile
 * button to the name (#461), and a mask as wide as a random name changed size from run to run.
 */
function signUp(page: Page) {
  return signUpAndLogIn(page, "E2E visual", { name: "E2E visual" });
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
    // The profile button's avatar color differs per account (#404). includeHidden: an open menu
    // hides the rest of the page, the button included, from role queries.
    page.getByRole("button", { name: /Settings and theme$/, includeHidden: true }),
    page.locator("#main-content .rounded-full[style*='background-color']"),
    // An open profile menu starts with the account's name and email, which is random in every run
    // (#458). The mask covers the label holding both (the email's parent), whose size doesn't change.
    page.getByRole("menu").getByText(/@example\.test$/).locator(".."),
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
  await signUp(page);
  await addTeammate(page, browser, baseURL, await addTasks(page));
  await screenshotHome(page, "home.png");
});

test("Home in dark mode", async ({ page, browser, baseURL }) => {
  await signUp(page);
  await addTeammate(page, browser, baseURL, await addTasks(page));
  await page.evaluate(() => localStorage.setItem("ai-multi-theme", "dark"));
  await screenshotHome(page, "home-dark.png");
});

test("Tasks", async ({ page }) => {
  await signUp(page);
  await addTasks(page);

  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: "Plan the next sprint", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("tasks.png", { mask: changing(page) });
});

// DES-15: another accent palette, with the account menu open on its swatches.
test("Tasks with the Blue accent", async ({ page }) => {
  await signUp(page);
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

// The phone's Filter and sort sheet, with a chip on, and its add box with text typed (#521).
test("Tasks on a phone: Filter and sort, and the add box", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phones only: computers filter from menus and add from the box on the page.");
  await signUp(page);
  await addTasks(page);

  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: "Plan the next sprint", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Filter and sort", exact: true }).click();
  const filters = page.getByRole("dialog", { name: "Filter and sort" });
  await filters.getByRole("group", { name: "Priority", exact: true }).getByRole("button", { name: "High", exact: true }).click();
  await expect(filters.getByRole("button", { name: "Show 2 tasks" })).toBeVisible();
  await expect(page).toHaveScreenshot("tasks-filter-sheet.png", { mask: changing(page) });
  await filters.getByRole("button", { name: "Clear", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(filters).toBeHidden();

  // No date in the text: a date chip shows the day, which changes from run to run.
  await plusTab(page).click();
  await page.getByRole("dialog", { name: "Add a task" }).getByRole("textbox", { name: "Add a task", exact: true }).fill("Draft the launch email !high");
  await expect(page.getByRole("list", { name: "Details from your text" })).toContainText("High");
  await expect(page).toHaveScreenshot("tasks-add-sheet.png", { mask: changing(page) });
});

test("Boards", async ({ page }) => {
  await signUp(page);
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

// #529: a click on a panel's edge folds it. The sidebar on its icon rail and the AI page's chats on
// theirs, side by side. Computers only: on phones the sidebar is a menu and the chats are full screen.
test("AI page with the sidebar and the chats folded", async ({ page, isMobile }) => {
  test.skip(isMobile, "Phones have no rails.");
  await signUp(page);
  await page.goto("/ai");
  await page.getByRole("separator", { name: "Resize sidebar" }).click();
  await page.getByRole("separator", { name: "Resize your chats" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show your chats" })).toBeVisible();
  // Both rails have finished narrowing (200 ms) before the picture.
  await expect.poll(async () => Math.round((await page.locator("#app-sidebar").boundingBox())!.width)).toBe(56);
  await expect.poll(async () => Math.round((await page.locator("#ai-chats").boundingBox())!.width)).toBe(56);
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("ai-folded.png", { mask: changing(page) });
});

// #310: the changes an answer proposes, each with a checkbox, before the person applies them. The
// e2e server's fake model calls the tools the message names. A fixed clock keeps "Due today" and
// this year's dates as they are. Each new task has the AI's estimate, so it opens as a draft (#434).
test("AI changes to apply", async ({ page }) => {
  await signUp(page);
  await page.clock.setFixedTime(new Date("2026-11-19T17:20:00Z"));
  await post(page, "/api/tasks", { title: "Call the dentist", dueDate: "2026-11-19", priority: "MEDIUM" });
  expect((await page.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).ok()).toBe(true);

  const security = "Check sign-in, sessions, permissions and dependencies against the OWASP Top 10.";
  const calls: Array<[string, Record<string, unknown>]> = [
    ["create_project", { name: "Whitewall", description: "Security work so Multi is safe to launch." }],
    [
      "create_task",
      { title: "Harden sign-in", project: "Whitewall", dueDate: "2026-12-17", priority: "HIGH", description: "Limit sign-in attempts.", estimate: { size: "4 h", reason: "A counter per account, and its tests." } },
    ],
    [
      "create_task",
      {
        title: "Security review before launch",
        project: "Whitewall",
        dueDate: "2026-12-17",
        priority: "HIGH",
        description: security,
        estimate: { size: "2 days", reason: "Each of the ten risks, checked and written up." },
      },
    ],
    ["create_event", { title: "Whitewall deadline", date: "2026-12-17", project: "Whitewall" }],
    ["complete_task", { task: "Call the dentist" }],
  ];
  await page.goto("/ai");
  await page.getByRole("textbox", { name: "Message the AI" }).fill(calls.map(([name, args]) => `${name} ${JSON.stringify(args)}`).join(" "));
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("region", { name: "Changes to apply" })).toContainText("5 of 5 selected");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("ai-changes.png", { mask: changing(page) });
});

// #433: a ticket the AI wrote, as its card sums it up and as its draft opens beside the chat (full
// screen on a phone), where each section folds and edits on its own, ending with the AI's estimate
// (#434).
test("AI ticket and its draft", async ({ page }) => {
  await signUp(page);
  expect((await page.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).ok()).toBe(true);
  const ticket = {
    title: "Export tasks as a CSV file",
    summary: "Let people download their tasks as a CSV file from the Tasks page.",
    acceptanceCriteria: ["The Tasks page has an Export button", "The file has a column for each field", "A test downloads the file"],
    outOfScope: ["Importing tasks from a CSV file"],
    openQuestions: ["Should done tasks be in the file?"],
    estimate: { size: "1 day", reason: "A button, the file's columns and a test." },
  };
  await page.goto("/ai");
  await page.getByRole("textbox", { name: "Message the AI" }).fill(`create_ticket ${JSON.stringify(ticket)}`);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const open = page.getByRole("button", { name: `Open draft of ${ticket.title}` });
  await expect(open).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("ai-ticket.png", { mask: changing(page) });

  await open.click();
  await expect(page.getByRole("dialog", { name: ticket.title })).toBeVisible();
  await expect(page).toHaveScreenshot("ai-ticket-draft.png", { mask: changing(page) });
});

// #434: a plain task the AI created: its details, then the AI's estimate, in the draft beside the
// chat (full screen on a phone).
test("AI task and its draft", async ({ page }) => {
  await signUp(page);
  expect((await page.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).ok()).toBe(true);
  const task = {
    title: "Call the plumber",
    description: "The kitchen sink leaks under the counter.",
    estimate: { size: "15 min", reason: "A short call to describe the problem and book a visit." },
  };
  await page.goto("/ai");
  await page.getByRole("textbox", { name: "Message the AI" }).fill(`create_task ${JSON.stringify(task)}`);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const open = page.getByRole("button", { name: `Open draft of ${task.title}` });
  await expect(open).toBeVisible();
  await page.waitForLoadState("networkidle");
  await open.click();
  await expect(page.getByRole("dialog", { name: task.title })).toBeVisible();
  await expect(page).toHaveScreenshot("ai-task-draft.png", { mask: changing(page) });
});

// #434: a ticket for work over 2 days, with the subtasks that split it offered unticked under it,
// each with its own estimate.
test("AI ticket with the subtasks that split it", async ({ page }) => {
  await signUp(page);
  expect((await page.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).ok()).toBe(true);
  const ticket = {
    title: "Add two-step sign-in",
    summary: "Ask for a code from an authenticator app after the password.",
    acceptanceCriteria: ["A person can turn on two-step sign-in", "Sign-in asks for the code"],
    estimate: { size: "1 week", reason: "An app to set up, a code at sign-in, recovery codes, and tests for each." },
    split: [
      { title: "Set up an authenticator app", size: "2 days", reason: "Pairing an app with the account, and its tests." },
      { title: "Ask for the code at sign-in", size: "1 day", reason: "One more step at sign-in, and its tests." },
      { title: "Recovery codes", size: "1 day", reason: "Codes to keep, and signing in with one." },
    ],
  };
  await page.goto("/ai");
  await page.getByRole("textbox", { name: "Message the AI" }).fill(`create_ticket ${JSON.stringify(ticket)}`);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("region", { name: "Changes to apply" })).toContainText("1 of 4 selected");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("ai-ticket-split.png", { mask: changing(page) });
});

// #433: a task's page with its description in sections: a Cost section the person added, a
// checklist with one box ticked, the AI's estimate (#434), and the request folded at the end.
test("Task page with sections", async ({ page }) => {
  await signUp(page);
  const { id } = await post(page, "/api/tasks", {
    title: "Buy a family car",
    priority: "HIGH",
    dueDate: dateInputValue(1),
    description: [
      "## Summary",
      "",
      "Choose and buy a car for the family.",
      "",
      "## Cost",
      "",
      "- Down payment: $4,000",
      "- Monthly payment: $350",
      "",
      "## Acceptance criteria",
      "",
      "- [x] Test-drive three cars",
      "- [ ] Agree on the price",
      "- [ ] Sign the papers",
      "",
      "## Estimate",
      "",
      "**2 days** · AI estimate",
      "Comparing cars, test drives at two dealers, and the paperwork.",
      "",
      "## Original request",
      "",
      "> Make a ticket for buying a family car, with a Cost section.",
    ].join("\n"),
  });
  // Tall enough for the whole description, which a phone shows under the task's properties.
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 1400 });
  await page.goto(`/tasks/${id}`);
  await expect(page.getByRole("heading", { level: 2, name: "Acceptance criteria 1 of 3" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("task-sections.png", { mask: [...changing(page), page.getByRole("region", { name: "Activity" })] });
});

test("Calendar", async ({ page }) => {
  await signUp(page);
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

// Integrations (#480, designs 1A and 2A) with Claude Code's steps open. The address is the visual
// server's own, the same in every run.
test("Integrations", async ({ page }) => {
  await signUp(page);
  await page.goto("/integrations");
  await page.getByRole("button", { name: "Connect Claude Code", exact: true }).click();
  await expect(page.getByRole("list", { name: "Connect Claude Code" })).toBeVisible();
  // The pointer leaves Close, so the picture shows the button as people see it, not its hover shade.
  await page.getByRole("heading", { level: 1, name: "Integrations" }).hover();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("integrations.png", { mask: changing(page) });
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
