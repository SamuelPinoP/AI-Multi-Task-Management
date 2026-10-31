import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest, signUpAndLogIn, uniqueName } from "./helpers";

test("a new workspace shows one next step in every empty card", async ({ page, isMobile }) => {
  await continueAsGuest(page);

  await expect(page.getByText("Nothing is due today.")).toBeVisible();
  for (const name of ["Due today: 0", "Overdue: 0", "Done this week: 0"]) {
    await expect(page.getByRole("group", { name })).toBeVisible();
  }
  await expect(page.getByText("Add your first task")).toBeVisible();
  await expect(page.getByRole("link", { name: "Plan an event" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create your first project" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Invite a teammate" })).toBeVisible();

  // With no events and no tasks, Now and next is one line (DES-10).
  const band = page.getByRole("region", { name: "Now and next" });
  await expect(band).toHaveText(/^No events today and no open tasks\.\s*Add a task$/);
  await band.getByRole("button", { name: "Add a task" }).click();
  await expect(page.getByLabel("Add a task", { exact: true })).toBeFocused();
  // Wider screens show the quick add's shortcuts; phones keep the placeholder only.
  const hints = page.locator("#quick-add-hints");
  await expect(hints).toContainText("#project");
  if (isMobile) await expect(hints).toBeHidden();
  else await expect(hints).toBeVisible();
});

test("quick add puts a task in Focus; completing it can be undone", async ({ page }) => {
  const title = uniqueName("Quick task");
  await continueAsGuest(page);
  const focus = page.locator("section").filter({ has: page.getByRole("heading", { name: "Focus", exact: true }) });

  await page.getByLabel("Add a task").fill(title);
  await page.getByLabel("Add a task").press("Enter");
  await expect(page.getByText("Task added")).toBeVisible();
  await expect(focus.getByRole("link", { name: title })).toBeVisible();
  await expect(page.getByLabel("Add a task")).toHaveValue("");
  // Activity says who did it (DES-11).
  const activity = page.locator("section").filter({ has: page.getByRole("heading", { name: "Activity" }) });
  await expect(activity).toContainText(`You created the task “${title}”`);

  await focus.getByRole("button", { name: `Complete ${title}` }).click();
  await expect(focus.getByRole("link", { name: title })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Done this week: 1" })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(focus.getByRole("link", { name: title })).toBeVisible();
  await expect(page.getByRole("group", { name: "Done this week: 0" })).toBeVisible();
});

test("Focus orders overdue work first and project health flags it", async ({ page }) => {
  await continueAsGuest(page);
  const late = uniqueName("Late task");
  const later = uniqueName("Later task");
  const project = (await (
    await page.request.post("/api/projects", { data: { name: uniqueName("Health project") } })
  ).json()) as { id: string; name: string };
  const idle = (await (
    await page.request.post("/api/projects", { data: { name: uniqueName("Idle project") } })
  ).json()) as { id: string; name: string };

  const day = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  for (const data of [
    { title: later, dueDate: day(3), priority: "HIGH" },
    { title: late, dueDate: day(-2), priority: "LOW", projectId: project.id },
    { title: uniqueName("Waiting task"), projectId: idle.id },
  ]) {
    expect((await page.request.post("/api/tasks", { data })).ok()).toBe(true);
  }

  await page.reload();
  const focus = page.locator("section").filter({ has: page.getByRole("heading", { name: "Focus", exact: true }) });
  await expect(focus.getByRole("listitem").first()).toContainText(late);
  await expect(focus.getByRole("listitem").first()).toContainText("2 days late");
  await expect(page.getByRole("group", { name: "Overdue: 1" })).toBeVisible();

  await expect(focus.getByRole("link", { name: "View all tasks" })).toHaveAttribute("href", "/tasks");

  const projects = page.locator("section").filter({ has: page.getByRole("heading", { name: "Projects", exact: true }) });
  await expect(projects.getByRole("link", { name: "View all projects" })).toHaveAttribute("href", "/projects");
  const row = projects.getByRole("listitem").filter({ hasText: project.name });
  await expect(row).toContainText("At risk");
  await expect(row).toContainText("1 overdue");
  await expect(row.getByRole("list", { name: `${project.name} members` }).getByTitle("You")).toBeVisible();
  // Nothing done or in progress reads "Not started", not "On track" (DES-11).
  const idleRow = projects.getByRole("listitem").filter({ hasText: idle.name });
  await expect(idleRow).toContainText("Not started");
  await expect(idleRow).toContainText("1 task, none started");

  // A chat nobody else can read stays off Home: Team chat is for shared projects.
  expect((await page.request.post(`/api/projects/${project.id}/comments`, { data: { message: "Note to self" } })).status()).toBe(201);
  await page.reload();
  await expect(focus).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team chat" })).toHaveCount(0);
});

test("a teammate's message shows in Team chat with an unread mark, and Activity names them", async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  const owner = await signUpAndLogIn(page, "E2E home owner");
  const projectName = uniqueName("Team home");
  const project = (await (await page.request.post("/api/projects", { data: { name: projectName } })).json()) as { id: string };
  const taskTitle = uniqueName("Shared task");
  expect((await page.request.post("/api/tasks", { data: { title: taskTitle, projectId: project.id } })).ok()).toBe(true);

  const memberContext = await browser.newContext({ baseURL });
  const member = await memberContext.newPage();
  try {
    const { email } = await signUpAndLogIn(member, "E2E home member");
    expect((await page.request.post(`/api/projects/${project.id}/invitations`, { data: { email, role: "EDITOR" } })).status()).toBe(201);
    const invitations = (await (await member.request.get("/api/project-invitations")).json()) as { id: string; project: { id: string } }[];
    const invitation = invitations.find((item) => item.project.id === project.id)!;
    expect((await member.request.patch(`/api/project-invitations/${invitation.id}`, { data: { action: "ACCEPT" } })).ok()).toBe(true);
    const message = uniqueName("Ready for review");
    expect((await page.request.post(`/api/projects/${project.id}/comments`, { data: { message } })).status()).toBe(201);

    await member.goto("/");
    const chat = member.locator("section").filter({ has: member.getByRole("heading", { name: "Team chat" }) });
    const row = chat.getByRole("link", { name: new RegExp(projectName) });
    await expect(row).toContainText(message);
    await expect(row).toContainText("1 unread message");
    await expect(chat.getByRole("link", { name: "View all chats" })).toHaveAttribute("href", "/chats");

    // The project's avatars name both people, and Activity says who did what.
    const projects = member.locator("section").filter({ has: member.getByRole("heading", { name: "Projects", exact: true }) });
    const people = projects.getByRole("list", { name: `${projectName} members` });
    await expect(people.getByRole("listitem")).toHaveCount(2);
    await expect(people.getByTitle(owner.name)).toBeVisible();
    await expect(people.getByTitle("You")).toBeVisible();
    const activity = member.locator("section").filter({ has: member.getByRole("heading", { name: "Activity" }) });
    await expect(activity).toContainText(`${owner.name} created the task “${taskTitle}”`);

    for (const theme of ["light", "dark"]) {
      await member.evaluate((value) => localStorage.setItem("ai-multi-theme", value), theme);
      await member.reload();
      await expect(row).toBeVisible();
      const results = await new AxeBuilder({ page: member }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`), `Home with Team chat (${theme})`).toEqual([]);
    }

    // The row opens that chat, which marks it read.
    await row.click();
    await expect(member).toHaveURL(new RegExp(`/chats\\?project=${project.id}$`));
    await member.goto("/");
    await expect(row).toContainText(message);
    await expect(row).not.toContainText("unread");
  } finally {
    await memberContext.close();
  }
});

// DES-10: the band compares event times with the user's wall clock. The browser
// runs in a zone where it is midday right now, so the events below stay on one
// day whatever the time in UTC. CI runs the server in UTC; Etc/GMT-N is UTC+N.
test.describe("Now and next", () => {
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

  test("shows the event under way, the next event, and a task to start", async ({ page }) => {
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
});
