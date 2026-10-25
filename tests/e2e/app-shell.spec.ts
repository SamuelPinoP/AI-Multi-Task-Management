import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest, openSection, uniqueName } from "./helpers";

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("New task adds a task, updates the sidebar and is found by search", async ({ page, isMobile }) => {
  const title = uniqueName("Shell task");
  await continueAsGuest(page);

  // The sidebar button on wide screens, the center tab on a phone.
  await page.getByRole("button", { name: "New task" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Priority").selectOption("HIGH");
  await dialog.getByRole("button", { name: "Add task" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Task added")).toBeVisible();
  if (!isMobile) {
    await expect(page.getByRole("link", { name: "Tasks, 1 open" })).toBeVisible();
    await page.keyboard.press("Control+K");
  } else {
    await page.getByRole("button", { name: "Search" }).click();
  }

  await page.getByPlaceholder("Search or run a command...").fill(title);
  await page.getByRole("option", { name: new RegExp(title) }).click();
  await expect(page).toHaveURL(/\/tasks\?task=/);
  // The Tasks page opens a linked task in its edit sheet.
  const sheet = page.getByRole("dialog", { name: "Edit task" });
  await expect(sheet.getByLabel("Title")).toHaveValue(title);
  await expect(sheet.getByLabel("Priority")).toHaveValue("HIGH");
});

test("Account menu switches the theme and logs out", async ({ page }) => {
  await continueAsGuest(page);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitemradio", { name: /Dark/ }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("Sidebar collapses and stays collapsed after a reload", async ({ page, isMobile }) => {
  test.skip(isMobile, "The sidebar is a menu sheet on phones.");
  await continueAsGuest(page);

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Notes" })).toBeVisible();

  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
});

test("A sidebar project opens to its pages and stays open after a reload", async ({ page, isMobile }) => {
  test.skip(isMobile, "The sidebar is a menu sheet on phones.");
  const name = uniqueName("Sidebar project");
  await continueAsGuest(page);
  await openSection(page, "Projects");
  await page.getByLabel("Add a project").fill(name);
  await page.getByLabel("Add a project").press("Enter");

  const sidebar = page.getByRole("navigation", { name: "Workspace" });
  const toggle = sidebar.getByRole("button", { name: `${name} pages` });
  const pages = sidebar.getByRole("group", { name: `${name} pages` });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await pages.getByRole("link", { name: "Chat" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/chat$/);
  await expect(pages.getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");

  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // A closed project stands in for the page you're on.
  await expect(sidebar.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
});

test("The sidebar + creates a project and opens it", async ({ page, isMobile }) => {
  test.skip(isMobile, "The sidebar is a menu sheet on phones.");
  const name = uniqueName("Sidebar new project");
  await continueAsGuest(page);

  const sidebar = page.getByRole("navigation", { name: "Workspace" });
  await sidebar.getByRole("button", { name: "Create a project" }).click();
  const sheet = page.getByRole("dialog", { name: "New project" });
  await sheet.getByLabel("Name").fill(name);
  await sheet.getByRole("button", { name: "Create project" }).click();
  await expect(sheet).toBeHidden();

  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const pages = sidebar.getByRole("group", { name: `${name} pages` });
  await expect(pages.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
});

/** How far the window itself scrolls; the shell scrolls inside main, so it should be 0. */
function windowOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
}

test("Long pages scroll inside the main area, never the whole window", async ({ page, isMobile }) => {
  test.skip(isMobile, "The sidebar is a menu sheet on phones.");
  test.setTimeout(120_000);
  await continueAsGuest(page);

  // A daily event fills the Events agenda with 60 days of rows, each with a hidden
  // "repeats" label; a new project's page has the GitHub panel's hidden label far down.
  // Hidden (sr-only) text is absolutely positioned, so it once escaped the scrolling
  // main area and made the window scroll too: a second scrollbar.
  const post = async (url: string, data: Record<string, unknown>) => (await page.request.post(url, { data })).json();
  const project = (await post("/api/projects", { name: uniqueName("Scroll project"), color: "#0f9488" })) as { id: string };
  await post("/api/events", { title: "Daily stand-up", startDate: dateInputValue(-1), startTime: "09:00", endDate: "", endTime: "", recurrence: "DAILY", projectId: project.id });
  await post("/api/tasks", { title: "Scroll task", dueDate: dateInputValue(0), projectId: project.id });
  await post("/api/notes", { title: "Scroll note", content: "Some text", projectId: project.id });

  const main = page.locator("#main-content");
  const overflowing: string[] = [];
  for (const path of ["/", "/today", "/chats", "/tasks", "/projects", `/projects/${project.id}`, `/projects/${project.id}/board`, `/projects/${project.id}/chat`, "/notes", "/events", "/events/calendar", "/board", "/tree", "/planner", "/goals", "/roadmap", "/trash"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const extra = await windowOverflow(page);
    if (extra !== 0) overflowing.push(`${path}: ${extra}px`);
  }
  expect(overflowing).toEqual([]);

  // The two pages from the report really are long, so main is what scrolls.
  for (const path of ["/events", `/projects/${project.id}`]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await main.evaluate((element) => element.scrollHeight > element.clientHeight * 2), path).toBe(true);
  }

  // The collapsed sidebar's labels are hidden text too, below the fold on a short window.
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Workspace" });
  expect(await nav.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  expect(await windowOverflow(page)).toBe(0);
});

test("Phone tabs and the menu reach every section", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Bottom tabs only show on phones.");
  await continueAsGuest(page);

  const tabs = page.getByRole("navigation", { name: "Primary" });
  await tabs.getByRole("link", { name: "Calendar" }).click();
  await expect(page).toHaveURL(/\/events\/calendar$/);
  await expect(tabs.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");

  await openSection(page, "Boards");
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await openSection(page, "Trash");
  await expect(page).toHaveURL(/\/trash$/);
});
