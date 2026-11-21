import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest, longPress, plusTab, signUpAndLogIn, uniqueName } from "./helpers";

// The Tasks page on phones (#521, design 2A): Search and Filter and sort as buttons beside the title, the add box and
// the filters as sheets from the bottom, a circle to mark each task done, and a long press to select.
test.skip(({ isMobile }) => !isMobile, "Phones only; computers have their own layout (#520), in tasks.spec.ts.");

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function row(page: Page, title: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("button", { name: title, exact: true }) });
}

/** Waits for open animations to end, so boxes and colors are measured where they settle. */
async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

/** axe's WCAG 2.1 A and AA violations inside `include`, a CSS selector. */
async function violations(page: Page, include: string) {
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).include(include).analyze();
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes[0]?.target.join(" ")}`);
}

const middle = (box: { y: number; height: number }) => box.y + box.height / 2;

test("the header: Search and Filter and sort beside the title, the tabs across the screen, and a search that clears as it closes", async ({ page }) => {
  const [found, other] = [uniqueName("Find me"), uniqueName("Other task")];
  await continueAsGuest(page);
  for (const title of [found, other]) expect((await page.request.post("/api/tasks", { data: { title } })).ok()).toBe(true);
  await page.goto("/tasks");
  await expect(row(page, found)).toBeVisible();
  const width = page.viewportSize()!.width;

  // Two 44px buttons on the title's line, the second at the right edge; the tabs take the line under it.
  const heading = (await page.getByRole("heading", { level: 1, name: "Tasks" }).boundingBox())!;
  const searchButton = page.getByRole("button", { name: "Search tasks", exact: true });
  const filterButton = page.getByRole("button", { name: "Filter and sort", exact: true });
  for (const button of [searchButton, filterButton]) {
    const box = (await button.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    expect(Math.abs(middle(box) - middle(heading))).toBeLessThan(3);
  }
  const filterBox = (await filterButton.boundingBox())!;
  expect(filterBox.x + filterBox.width).toBeLessThanOrEqual(width);
  expect(filterBox.x + filterBox.width).toBeGreaterThan(width - 16);
  const tabs = (await page.getByRole("radiogroup", { name: "Status" }).boundingBox())!;
  expect(tabs.y).toBeGreaterThanOrEqual(heading.y + heading.height);
  expect(tabs.width).toBeGreaterThanOrEqual(width - 33);

  // The bands and the tasks run edge to edge.
  for (const box of [await page.getByRole("region", { name: "No project", exact: true }).boundingBox(), await row(page, found).boundingBox()]) {
    expect(Math.abs(box!.x)).toBeLessThan(1);
    expect(Math.abs(box!.width - width)).toBeLessThan(1);
  }

  // The computer's search field, Filter and Display menus and add box aren't on a phone's page.
  await expect(page.getByRole("searchbox", { name: "Search tasks" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Filter", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Display", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Add a task", exact: true })).toHaveCount(0);

  // Search opens a field across the screen, with the cursor in it.
  await searchButton.click();
  await expect(searchButton).toHaveAttribute("aria-expanded", "true");
  const search = page.getByRole("searchbox", { name: "Search tasks" });
  await expect(search).toBeFocused();
  expect((await search.boundingBox())!.width).toBeGreaterThanOrEqual(width - 33);
  await search.fill(found.slice(-8));
  await expect(page.getByRole("button", { name: other, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: found, exact: true })).toBeVisible();

  // Closing it clears it, so a search out of sight hides no tasks.
  await searchButton.click();
  await expect(searchButton).toHaveAttribute("aria-expanded", "false");
  await expect(search).toHaveCount(0);
  await expect(page.getByRole("button", { name: other, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("+ opens the add box as a sheet: it reads the text, and Add task adds the task and closes it", async ({ page }) => {
  const title = uniqueName("Sheet task");
  await continueAsGuest(page);
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "No tasks yet." })).toBeVisible();
  await expect(page.getByText("Tap + at the bottom of the screen to add one.")).toBeVisible();

  // A sheet across the bottom of the screen, with the cursor in the box.
  await plusTab(page).click();
  const sheet = page.getByRole("dialog", { name: "Add a task" });
  const input = sheet.getByRole("textbox", { name: "Add a task", exact: true });
  await expect(input).toBeFocused();
  await settle(page);
  const box = (await sheet.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThan(1);
  expect(Math.abs(box.width - viewport.width)).toBeLessThan(1);
  // The computer box's details, as chips under the text.
  const details = sheet.getByRole("group", { name: "Task details" });
  for (const name of ["Due date", "Project", "Priority", "Assignee", "Labels"]) {
    await expect(details.getByRole("button", { name, exact: true })).toBeVisible();
  }
  const add = sheet.getByRole("button", { name: "Add task", exact: true });
  await expect(add).toBeDisabled();
  expect(await violations(page, '[role="dialog"]')).toEqual([]);

  // It reads the text as the box on a computer does.
  await input.fill(`${title} !high`);
  await expect(sheet.getByRole("list", { name: "Details from your text" })).toContainText("High");
  await add.click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Task added")).toBeVisible();
  await expect(row(page, title).getByText("High priority")).toBeVisible();

  // The task's circle, a 44px target, marks it done; Undo puts it back.
  const circle = page.getByRole("button", { name: `Mark done: ${title}` });
  const circleBox = (await circle.boundingBox())!;
  expect(Math.min(circleBox.width, circleBox.height)).toBeGreaterThanOrEqual(44);
  await circle.click();
  await expect(page.getByText("Task completed")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(circle).toHaveAttribute("aria-pressed", "false");

  // Each time it opens, it starts empty; Escape closes it.
  await plusTab(page).click();
  await expect(input).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("a band's ⋯ starts a task in its project, and More details takes the text into the New task pop-up", async ({ page }) => {
  await continueAsGuest(page);
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("Phone project") } })).json()) as {
    id: string;
    name: string;
  };
  expect((await page.request.post("/api/tasks", { data: { title: uniqueName("Already here"), projectId: project.id } })).ok()).toBe(true);
  await page.goto("/tasks");

  // The band's + is in its ⋯ on a phone.
  const band = page.getByRole("region", { name: project.name });
  await expect(band.getByRole("button", { name: `New task in ${project.name}` })).toHaveCount(0);
  await band.getByRole("button", { name: `More for ${project.name}` }).click();
  await page.getByRole("menuitem", { name: `New task in ${project.name}` }).click();
  const sheet = page.getByRole("dialog", { name: "Add a task" });
  const input = sheet.getByRole("textbox", { name: "Add a task", exact: true });
  await expect(input).toBeFocused();
  await expect(sheet.getByRole("list", { name: "Details you picked" })).toContainText(project.name);

  // More details hands the title, the project and the typed priority to the full form.
  const title = uniqueName("More details task");
  await input.fill(`${title} !urgent`);
  await sheet.getByRole("button", { name: "More details" }).click();
  await expect(sheet).toBeHidden();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog.getByLabel("Title")).toHaveValue(title);
  await expect(dialog.getByLabel("Title")).toBeFocused();
  await expect(dialog.getByRole("button", { name: `Project: ${project.name}` })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Priority: Urgent" })).toBeVisible();
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();
  await expect(band.getByRole("button", { name: title, exact: true })).toBeVisible();
});

test("Filter and sort: chips filter the list as they're tapped, the button counts them, and Clear resets the sort too", async ({ page }) => {
  await continueAsGuest(page);
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("Sheet project") } })).json()) as { id: string };
  const [urgent, soon, later] = [uniqueName("Urgent one"), uniqueName("Due soon"), uniqueName("Due later")];
  for (const data of [
    { title: urgent, priority: "URGENT", projectId: project.id },
    { title: soon, dueDate: dateInputValue(2) },
    { title: later, dueDate: dateInputValue(5) },
  ]) {
    expect((await page.request.post("/api/tasks", { data })).ok()).toBe(true);
  }
  await page.goto("/tasks");
  await expect(row(page, urgent)).toBeVisible();

  const button = page.getByRole("button", { name: /^Filter and sort/ });
  const sheet = page.getByRole("dialog", { name: "Filter and sort" });
  await button.click();
  expect(await violations(page, '[role="dialog"]')).toEqual([]);

  // One priority: Show counts what's left, and closes the sheet on the filtered list.
  const urgentChip = sheet.getByRole("group", { name: "Priority", exact: true }).getByRole("button", { name: "Urgent", exact: true });
  await urgentChip.click();
  await expect(urgentChip).toHaveAttribute("aria-pressed", "true");
  await sheet.getByRole("button", { name: "Show 1 task" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: urgent, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: soon, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Filter and sort, 1 on" })).toBeVisible();

  // A task must match a chip in each group that has one: Urgent and No project match nothing here.
  await button.click();
  await sheet.getByRole("group", { name: "Project", exact: true }).getByRole("button", { name: "No project", exact: true }).click();
  await expect(sheet.getByRole("button", { name: "Show 0 tasks" })).toBeVisible();
  await urgentChip.click();
  await expect(urgentChip).toHaveAttribute("aria-pressed", "false");

  // Sort: Due latest puts the later task first.
  const dueLatest = sheet.getByRole("radiogroup", { name: "Sort" }).getByRole("radio", { name: "Due latest" });
  await dueLatest.click();
  await expect(dueLatest).toHaveAttribute("aria-checked", "true");
  await sheet.getByRole("button", { name: "Show 2 tasks" }).click();
  const titles = page.getByRole("button", { name: new RegExp(`^(${soon}|${later})$`) });
  await expect(titles).toHaveText([later, soon]);

  // Clear takes off every chip and puts the sort back to Due soonest.
  await button.click();
  await sheet.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(sheet.getByRole("radio", { name: "Due soonest" })).toHaveAttribute("aria-checked", "true");
  await sheet.getByRole("button", { name: "Show 3 tasks" }).click();
  await expect(page.getByRole("button", { name: "Filter and sort", exact: true })).toBeVisible();
  await expect(titles).toHaveText([soon, later]);
});

test("holding a task selects it, taps then select more, and the bar fits above the AI button and the tabs", async ({ page }) => {
  // An account: guests don't get the AI bar (#458).
  await signUpAndLogIn(page, "Tasks phone select");
  const [first, second, third] = [uniqueName("Hold one"), uniqueName("Hold two"), uniqueName("Hold three")];
  for (const title of [first, second, third]) expect((await page.request.post("/api/tasks", { data: { title } })).ok()).toBe(true);
  await page.goto("/tasks");
  await expect(row(page, first)).toBeVisible();
  // Until something is selected, rows have their circles and no select boxes.
  await expect(page.getByRole("checkbox", { name: /^Select / })).toHaveCount(0);

  // Holding selects the task instead of opening it, and every circle becomes a select box.
  await longPress(page.getByRole("button", { name: first, exact: true }));
  const bar = page.getByRole("toolbar", { name: "Selected tasks" });
  await expect(bar).toContainText("1 selected");
  await expect(page.getByRole("checkbox", { name: `Select ${first}` })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: `Select ${second}` })).not.toBeChecked();
  await expect(page.getByRole("button", { name: `Mark done: ${second}` })).toHaveCount(0);
  expect(page.url()).toMatch(/\/tasks$/);

  // While selecting, a tap on a task selects it too.
  await page.getByRole("button", { name: second, exact: true }).click();
  await expect(bar).toContainText("2 selected");
  expect(await violations(page, "#main-content")).toEqual([]);

  // The bar fits the screen, above the AI button and the tabs, and shows every action without scrolling, even on a
  // 360px phone, the narrowest width in common use.
  await page.setViewportSize({ width: 360, height: 800 });
  const width = page.viewportSize()!.width;
  expect(await bar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const barBox = (await bar.boundingBox())!;
  const aiBox = (await page.getByRole("button", { name: /^Ask AI Multi: / }).boundingBox())!;
  const tabsBox = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!;
  expect(barBox.x).toBeGreaterThanOrEqual(0);
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(width);
  expect(aiBox.y - (barBox.y + barBox.height)).toBeGreaterThanOrEqual(8);
  expect(barBox.y + barBox.height).toBeLessThan(tabsBox.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Its changes apply to the selected tasks only.
  await bar.getByRole("button", { name: "Priority" }).click();
  await page.getByRole("menuitem", { name: "High" }).click();
  await expect(page.getByText("2 tasks set to High priority")).toBeVisible();
  for (const title of [first, second]) await expect(row(page, title).getByText("High priority")).toBeVisible();
  await expect(row(page, third).getByText("High priority")).toHaveCount(0);

  // A selected task's box unselects it; once nothing is selected, the circles come back.
  await page.getByRole("checkbox", { name: `Select ${second}` }).click();
  await expect(bar).toContainText("1 selected");
  await bar.getByRole("button", { name: "Clear the selection" }).click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Mark done: ${first}` })).toBeVisible();

  // And a tap anywhere on a task opens it, even beside its title.
  const thirdRow = row(page, third);
  const box = (await thirdRow.boundingBox())!;
  await thirdRow.click({ position: { x: box.width - 24, y: box.height / 2 } });
  await expect(page).toHaveURL(/\/tasks\/[^/?]+$/);
  await expect(page.getByLabel("Title")).toHaveValue(third);
});
