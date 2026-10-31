import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest, expectHome, openSection, uniqueName } from "./helpers";

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

test("The browser tab and the sidebar show the AI Multi mark", async ({ page, isMobile }) => {
  await continueAsGuest(page);

  // Every page links the Spark icon.svg and the favicon.ico fallback (#292).
  const icons = await page.locator('link[rel="icon"]').evaluateAll((links) =>
    [...new Set(links.map((link) => `${link.getAttribute("href")} ${link.getAttribute("type") ?? ""}`))],
  );
  const svg = icons.find((icon) => icon.includes("image/svg+xml"))?.split(" ")[0];
  const ico = icons.find((icon) => icon.startsWith("/favicon.ico"))?.split(" ")[0];
  expect(svg, icons.join(", ")).toBeTruthy();
  expect(ico, icons.join(", ")).toBeTruthy();
  const svgResponse = await page.request.get(svg!);
  expect(svgResponse.ok()).toBe(true);
  expect(await svgResponse.text()).toContain("#0a6f68");
  expect((await page.request.get(ico!)).ok()).toBe(true);

  test.skip(isMobile, "The sidebar is a menu sheet on phones.");
  // The mark is decorative; screen readers hear the name once, even with the sidebar collapsed.
  const sidebar = page.getByRole("navigation", { name: "Workspace" });
  await expect(sidebar.getByText("AI Multi", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Guest workspace", { exact: true })).toBeVisible();
  await expect(sidebar.locator('svg[aria-hidden="true"]').first()).toBeVisible();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar.getByText("AI Multi", { exact: true })).toHaveClass(/sr-only/);
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

/** Where the Calendar's Agenda and Month tabs start; both views share the header, so it never moves. */
async function calendarTabsPosition(page: Page) {
  const box = (await page.getByRole("navigation", { name: "Calendar views" }).boundingBox())!;
  return { x: Math.round(box.x), y: Math.round(box.y) };
}

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

test("Long titles never make a page wider than a phone screen", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The pages only get too narrow on phones.");
  test.setTimeout(120_000);
  await continueAsGuest(page);

  // The page wrappers are grids: an `auto` column can't shrink below its widest
  // row's one-line width, so a long title used to widen the whole page (#288).
  const long = "Renew passport photos and book the visa appointment before the trip";
  const post = async (url: string, data: Record<string, unknown>) => (await page.request.post(url, { data })).json();
  const project = (await post("/api/projects", { name: uniqueName("A project with a rather long name for a phone"), color: "#0f9488" })) as { id: string };
  await post("/api/tasks", { title: long, dueDate: dateInputValue(1), priority: "HIGH", projectId: project.id });
  await post("/api/tasks", { title: `${long} (personal)`, dueDate: dateInputValue(0) });
  await post("/api/notes", { title: long, content: "Some text", projectId: project.id });
  await post("/api/events", { title: long, startDate: dateInputValue(0), startTime: "16:00", endDate: "", endTime: "", recurrence: "NONE", projectId: project.id });
  const deleted = (await post("/api/tasks", { title: `${long} (deleted)`, dueDate: dateInputValue(2) })) as { id: string };
  await page.request.delete(`/api/tasks/${deleted.id}`);

  const main = page.locator("#main-content");
  const tooWide: string[] = [];
  for (const path of ["/", "/today", "/chats", "/tasks", "/tasks/board", "/projects", `/projects/${project.id}`, `/projects/${project.id}/board`, `/projects/${project.id}/chat`, "/notes", "/events", "/events/calendar", "/board", "/tree", "/planner", "/goals", "/roadmap", "/trash"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const extra = await main.evaluate((element) => element.scrollWidth - element.clientWidth);
    if (extra > 0) tooWide.push(`${path}: ${extra}px`);
  }
  expect(tooWide).toEqual([]);
});

test("Phone tabs and the menu reach every section", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Bottom tabs only show on phones.");
  await continueAsGuest(page);

  // The Calendar tab opens the same page as the sidebar's Calendar item (DES-13):
  // the Agenda at first, then whichever view was used last, and it's current on both.
  const tabs = page.getByRole("navigation", { name: "Primary" });
  const calendar = tabs.getByRole("link", { name: "Calendar" });
  const views = page.getByRole("navigation", { name: "Calendar views" });
  await calendar.click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(calendar).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("0 in the next 7 days")).toBeVisible();
  const agendaTabs = await calendarTabsPosition(page);
  await views.getByRole("link", { name: "Month" }).click();
  await expect(page).toHaveURL(/\/events\/calendar$/);
  await expect(views.getByRole("link", { name: "Month" })).toHaveAttribute("aria-current", "page");
  await expect(calendar).toHaveAttribute("aria-current", "page");
  // On a phone too, the header keeps to one line on both views, so the tabs stay under the finger.
  expect(await calendarTabsPosition(page)).toEqual(agendaTabs);
  await tabs.getByRole("link", { name: "Home" }).click();
  await expectHome(page);
  await calendar.click();
  await expect(page).toHaveURL(/\/events\/calendar$/);

  await openSection(page, "Boards");
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Trash waits at the bottom of the menu.
  await openSection(page, "Trash");
  await expect(page).toHaveURL(/\/trash$/);
});

test("One Calendar item opens the Agenda and Month tabs and remembers the last one", async ({ page, isMobile }) => {
  test.skip(isMobile, "The sidebar is a menu sheet on phones.");
  await continueAsGuest(page);
  const created = await page.request.post("/api/events", {
    data: { title: uniqueName("Tab event"), startDate: dateInputValue(1), startTime: "10:00", endDate: "", endTime: "", recurrence: "NONE" },
  });
  const event = (await created.json()) as { id: string };

  const sidebar = page.getByRole("navigation", { name: "Workspace" });
  const calendar = sidebar.getByRole("link", { name: "Calendar", exact: true });
  const views = page.getByRole("navigation", { name: "Calendar views" });
  await expect(sidebar.getByRole("link", { name: "Events" })).toHaveCount(0);

  // A new account starts on the Agenda.
  await calendar.click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await expect(views.getByRole("link", { name: "Agenda" })).toHaveAttribute("aria-current", "page");
  await expect(calendar).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("1 in the next 7 days")).toBeVisible();
  const agendaTabs = await calendarTabsPosition(page);

  await views.getByRole("link", { name: "Month" }).click();
  await expect(page).toHaveURL(/\/events\/calendar$/);
  await expect(views.getByRole("link", { name: "Month" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await expect(calendar).toHaveAttribute("aria-current", "page");
  expect(await calendarTabsPosition(page)).toEqual(agendaTabs);

  // From another page, and after a reload, Calendar opens the Month it was left on.
  await sidebar.getByRole("link", { name: "Home", exact: true }).click();
  await expectHome(page);
  await page.reload();
  await expect(calendar).toHaveAttribute("href", "/events/calendar");
  await calendar.click();
  await expect(page).toHaveURL(/\/events\/calendar$/);

  // Opening one event (what the month, search and Home link to) shows it on the Agenda,
  // but it isn't picking a view: closing it and coming back still opens the Month.
  await page.goto(`/events?event=${event.id}`);
  await expect(page.getByRole("dialog", { name: "Edit event" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/events$/);
  await sidebar.getByRole("link", { name: "Home", exact: true }).click();
  await expectHome(page);
  await calendar.click();
  await expect(page).toHaveURL(/\/events\/calendar$/);

  // The old addresses still work, each on its own tab; opening one makes it the view Calendar opens.
  await page.goto("/events");
  await expect(views.getByRole("link", { name: "Agenda" })).toHaveAttribute("aria-current", "page");
  await expect(calendar).toHaveAttribute("href", "/events");
  await page.goto("/events/calendar");
  await expect(views.getByRole("link", { name: "Month" })).toHaveAttribute("aria-current", "page");
  await expect(calendar).toHaveAttribute("href", "/events/calendar");
});

test("Trash sits in the sidebar footer next to Collapse, an icon with its name when collapsed", async ({ page, isMobile }) => {
  test.skip(isMobile, "The sidebar is a menu sheet on phones.");
  await continueAsGuest(page);

  const sidebar = page.getByRole("navigation", { name: "Workspace" });
  const trash = sidebar.getByRole("link", { name: "Trash" });
  const collapse = sidebar.getByRole("button", { name: "Collapse sidebar" });

  // Below the Tools group, on one line with Collapse.
  const roadmapBox = (await sidebar.getByRole("link", { name: "Roadmap" }).boundingBox())!;
  const trashBox = (await trash.boundingBox())!;
  const collapseBox = (await collapse.boundingBox())!;
  expect(trashBox.y).toBeGreaterThan(roadmapBox.y + roadmapBox.height);
  expect(Math.abs(trashBox.y + trashBox.height / 2 - (collapseBox.y + collapseBox.height / 2))).toBeLessThan(2);
  expect(trashBox.x + trashBox.width).toBeLessThanOrEqual(collapseBox.x);

  // It stays in the command palette.
  await page.keyboard.press("Control+K");
  await page.getByPlaceholder("Search or run a command...").fill("trash");
  await page.getByRole("option", { name: "Trash", exact: true }).click();
  await expect(page).toHaveURL(/\/trash$/);
  await expect(trash).toHaveAttribute("aria-current", "page");

  // Collapsed, only its icon shows; its name is the tooltip and the link's name.
  await collapse.click();
  const expand = sidebar.getByRole("button", { name: "Expand sidebar" });
  await expect(expand).toBeVisible();
  await expect(trash).toHaveAttribute("title", "Trash");
  await expect(trash.getByText("Trash", { exact: true })).toHaveClass(/sr-only/);
  const collapsedTrash = (await trash.boundingBox())!;
  const expandBox = (await expand.boundingBox())!;
  expect(collapsedTrash.y + collapsedTrash.height).toBeLessThanOrEqual(expandBox.y);
  await sidebar.getByRole("link", { name: "Home", exact: true }).click();
  await expectHome(page);
  await trash.click();
  await expect(page).toHaveURL(/\/trash$/);
});
