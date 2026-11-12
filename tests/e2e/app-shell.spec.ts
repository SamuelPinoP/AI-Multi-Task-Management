import { expect, test, type Page } from "@playwright/test";
import { accountMenuButton, continueAsGuest, expectHome, openAccountMenu, openSection, queryDatabase, signUpAndLogIn, uniqueName } from "./helpers";

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
  await dialog.getByRole("button", { name: "Priority: No priority" }).click();
  await page.getByRole("option", { name: "High" }).click();
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Task created")).toBeVisible();
  if (!isMobile) {
    await expect(page.getByRole("link", { name: "Tasks, 1 open" })).toBeVisible();
    await page.keyboard.press("Control+K");
  } else {
    await page.getByRole("button", { name: "Search" }).click();
  }

  await page.getByPlaceholder("Search or run a command...").fill(title);
  await page.getByRole("option", { name: new RegExp(title) }).click();
  // A found task opens as its page (#352).
  await expect(page).toHaveURL(/\/tasks\/[^/?]+$/);
  await expect(page.getByLabel("Title")).toHaveValue(title);
  await expect(page.getByRole("button", { name: "Priority: High" })).toBeVisible();
});

test("Account menu switches the theme and logs out", async ({ page }) => {
  await continueAsGuest(page);

  await openAccountMenu(page);
  await page.getByRole("menuitemradio", { name: /Dark/ }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await openAccountMenu(page);
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

  // Trash waits in the menu's bottom bar once it holds something (#404, design 2C).
  const note = (await (await page.request.post("/api/notes", { data: { title: uniqueName("Phone trash"), content: "" } })).json()) as { id: string };
  expect((await page.request.delete(`/api/notes/${note.id}`)).ok()).toBe(true);
  await page.reload();
  await openSection(page, "Trash, 1 item");
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

test("The sidebar's bottom bar holds the profile, the bell and Trash, which shows only while it has something", async ({ page, isMobile }) => {
  test.skip(isMobile, "The sidebar is a menu sheet on phones.");
  await continueAsGuest(page);

  const sidebar = page.getByRole("navigation", { name: "Workspace" });
  const profile = accountMenuButton(page);
  const bell = page.getByRole("button", { name: "Notifications", exact: true });
  const trash = page.getByRole("link", { name: /^Trash, \d+ items?$/ });
  const collapse = page.getByRole("button", { name: "Collapse sidebar" });

  // The top bar keeps only search; the profile and the bell are in the sidebar (#404).
  const topBar = page.locator("header").filter({ has: page.getByRole("button", { name: /^Search/ }) });
  await expect(topBar.getByRole("button", { name: /Notifications|Settings and theme/ })).toHaveCount(0);
  await expect(profile).toHaveAccessibleName("Guest Settings and theme");
  await expect(bell).toBeVisible();
  // Collapse sits by the logo now, above the links.
  expect((await collapse.boundingBox())!.y).toBeLessThan((await sidebar.getByRole("link", { name: "Home", exact: true }).boundingBox())!.y);

  // An empty Trash has no button (design 2C), but the command palette still opens it.
  await expect(trash).toHaveCount(0);
  await page.keyboard.press("Control+K");
  await page.getByPlaceholder("Search or run a command...").fill("trash");
  await page.getByRole("option", { name: "Trash", exact: true }).click();
  await expect(page).toHaveURL(/\/trash$/);

  // A deleted note puts Trash on the bar: one row under the whole sidebar, profile, bell, then Trash.
  const note = (await (await page.request.post("/api/notes", { data: { title: uniqueName("Trashed note"), content: "" } })).json()) as { id: string };
  expect((await page.request.delete(`/api/notes/${note.id}`)).ok()).toBe(true);
  await sidebar.getByRole("link", { name: "Home", exact: true }).click();
  await expectHome(page);
  await expect(trash).toHaveAccessibleName("Trash, 1 item");
  const roadmapBox = (await sidebar.getByRole("link", { name: "Roadmap" }).boundingBox())!;
  const [profileBox, bellBox, trashBox] = await Promise.all([profile, bell, trash].map(async (item) => (await item.boundingBox())!));
  for (const box of [profileBox, bellBox, trashBox]) expect(box.y).toBeGreaterThan(roadmapBox.y + roadmapBox.height);
  expect(Math.abs(bellBox.y + bellBox.height / 2 - (trashBox.y + trashBox.height / 2))).toBeLessThan(2);
  expect(profileBox.x + profileBox.width).toBeLessThanOrEqual(bellBox.x);
  expect(bellBox.x + bellBox.width).toBeLessThanOrEqual(trashBox.x);

  await trash.click();
  await expect(page).toHaveURL(/\/trash$/);
  await expect(trash).toHaveAttribute("aria-current", "page");

  // Collapsed, the three stack in the same order and keep their names.
  await collapse.click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await expect(profile).toHaveAccessibleName("Guest Settings and theme");
  const stacked = await Promise.all([profile, bell, trash].map(async (item) => (await item.boundingBox())!));
  expect(stacked[0].y + stacked[0].height).toBeLessThanOrEqual(stacked[1].y);
  expect(stacked[1].y + stacked[1].height).toBeLessThanOrEqual(stacked[2].y);
  await page.getByRole("button", { name: "Expand sidebar" }).click();

  // Emptying Trash takes its button away at once.
  await page.getByRole("button", { name: "Empty Trash" }).click();
  await page.getByRole("dialog", { name: "Empty trash?" }).getByRole("button", { name: "Empty Trash" }).click();
  await expect(page.getByText("Trash emptied successfully.")).toBeVisible();
  await expect(trash).toHaveCount(0);
});

test("On a phone the bar is at the bottom of the menu, and the menu button shows new notifications", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phones only: on wide screens the sidebar is always there.");
  const { email } = await signUpAndLogIn(page, "E2E phone bar");
  await queryDatabase(
    `INSERT INTO "Notification" (id, "userId", type, title, "createdAt")
     SELECT 'e2e_' || md5(random()::text), id, 'MENTION', 'Ana mentioned you in Launch', now() AT TIME ZONE 'utc' FROM "User" WHERE email = $1`,
    [email],
  );
  await page.goto("/");
  await expectHome(page);

  const menuButton = page.getByRole("button", { name: "Open navigation, 1 new notification" });
  await menuButton.click();
  const sheet = page.getByRole("dialog", { name: "Navigation" });
  const bell = sheet.getByRole("button", { name: "Notifications, 1 new" });
  await expect(bell).toBeVisible();
  await expect(accountMenuButton(page)).toBeVisible();
  // The bar is the sheet's last row.
  const sheetBox = (await sheet.boundingBox())!;
  const bellBox = (await bell.boundingBox())!;
  expect(sheetBox.y + sheetBox.height - (bellBox.y + bellBox.height)).toBeLessThan(60);

  // Following a notification closes the menu and clears the dot.
  await bell.click();
  await page.getByRole("menuitem", { name: /Ana mentioned you in Launch/ }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Open navigation", exact: true })).toBeVisible();
});
