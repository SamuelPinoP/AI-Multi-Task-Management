import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest, plusTab, uniqueName } from "./helpers";

// Permanent task numbers (#486, design 5B): AM-142 after the title in the list and on the task's
// page, Copy ID, Copy link and Copy branch name, search by number, and the short address /t/142.

type CreatedTask = { id: string; number: number; title: string };

async function addTask(page: Page, title: string) {
  const response = await page.request.post("/api/tasks", { data: { title } });
  expect(response.ok(), `/api/tasks answered ${response.status()}`).toBe(true);
  return (await response.json()) as CreatedTask;
}

const notFound = (page: Page) => page.getByText("This page could not be found.");

test("a task's number follows its title in the list and on its page, and Task ID hides it in the list", async ({ page, isMobile }) => {
  await continueAsGuest(page);
  // Short enough to share its line with the number on a phone's task page; a longer title puts it on the next line.
  const task = await addTask(page, "Dark mode");
  const id = `AM-${task.number}`;
  await page.goto("/tasks");

  // Shown by default, right after the title on the same line.
  const row = page.locator(`#task-${task.id}`);
  const title = row.getByRole("button", { name: task.title, exact: true });
  const number = row.getByText(id, { exact: true });
  await expect(number).toBeVisible();
  const [titleBox, numberBox] = [(await title.boundingBox())!, (await number.boundingBox())!];
  expect(numberBox.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width);
  expect(numberBox.x - (titleBox.x + titleBox.width)).toBeLessThan(16);
  expect(Math.abs(numberBox.y + numberBox.height / 2 - (titleBox.y + titleBox.height / 2))).toBeLessThan(4);

  // Display → Task ID turns it off; on a phone, Task ID in Filter and sort.
  if (isMobile) {
    await page.getByRole("button", { name: "Filter and sort" }).click();
    const sheet = page.getByRole("dialog", { name: "Filter and sort" });
    const chip = sheet.getByRole("button", { name: "Task ID", exact: true });
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await sheet.getByRole("button", { name: /^Show \d+ tasks?$/ }).click();
    await expect(sheet).toBeHidden();
  } else {
    await page.getByRole("button", { name: "Display", exact: true }).click();
    const option = page.getByRole("menuitemcheckbox", { name: "Task ID" });
    await expect(option).toHaveAttribute("aria-checked", "true");
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");
  }
  await expect(number).toHaveCount(0);
  await expect(title).toBeVisible();

  // The task's page shows it after the title.
  await title.click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
  await expect(page.getByLabel("Title")).toHaveValue(task.title);
  const pageNumber = page.locator("#main-content").getByText(id, { exact: true });
  await expect(pageNumber).toBeVisible();
  const [fieldBox, afterBox] = [(await page.getByLabel("Title").boundingBox())!, (await pageNumber.boundingBox())!];
  expect(afterBox.x).toBeGreaterThanOrEqual(fieldBox.x + fieldBox.width);
  expect(Math.abs(afterBox.y - fieldBox.y)).toBeLessThan(4);
});

test("Copy ID, Copy link and Copy branch name copy AM-142, its /t/ link and am-142-…", async ({ page, context, isMobile }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await continueAsGuest(page);
  // A fresh guest's only task, so its title needn't be unique.
  const task = await addTask(page, "Dark & light mode");
  const id = `AM-${task.number}`;
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const toast = (text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text }).last();

  await page.goto(`/tasks/${task.id}`);
  const origin = new URL(page.url()).origin;
  const more = page.getByRole("button", { name: "More actions", exact: true });
  await more.click();
  await page.getByRole("menuitem", { name: "Copy ID" }).click();
  await expect(toast(`Copied ${id}`)).toBeVisible();
  expect(await clipboard()).toBe(id);

  await more.click();
  await page.getByRole("menuitem", { name: "Copy link" }).click();
  await expect(toast(`Copied the link to ${id}`)).toBeVisible();
  expect(await clipboard()).toBe(`${origin}/t/${task.number}`);

  await more.click();
  await page.getByRole("menuitem", { name: "Copy branch name" }).click();
  const branch = `am-${task.number}-dark-light-mode`;
  await expect(toast("Copied the branch name")).toContainText(branch);
  expect(await clipboard()).toBe(branch);

  // The header's link button copies the same permanent link.
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(toast(`Copied the link to ${id}`)).toBeVisible();
  expect(await clipboard()).toBe(`${origin}/t/${task.number}`);

  // A row's ⋯ has them too; phone rows have no menu, and a press selects (#521).
  if (!isMobile) {
    await page.goto("/tasks");
    await page.getByRole("button", { name: `More actions for ${task.title}` }).click();
    await page.getByRole("menuitem", { name: "Copy ID" }).click();
    await expect(toast(`Copied ${id}`)).toBeVisible();
    expect(await clipboard()).toBe(id);
  }
});

test("/t/<number> opens the task's page for anyone who can see it; everyone else gets the usual 404", async ({ page, browser, baseURL }) => {
  await continueAsGuest(page);
  const task = await addTask(page, uniqueName("Short link"));

  await page.goto(`/t/${task.number}`);
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
  await expect(page.getByLabel("Title")).toHaveValue(task.title);
  await page.goto(`/t/am-${task.number}`);
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));

  // A number no task has, and no number at all.
  for (const path of ["/t/2147483647", "/t/0", "/t/dark-mode"]) {
    await page.goto(path);
    await expect(notFound(page), path).toBeVisible();
  }

  // The task is the guest's own, so to anyone else its number is like one no task has.
  const strangerContext = await browser.newContext({ baseURL });
  try {
    const stranger = await strangerContext.newPage();
    await continueAsGuest(stranger);
    await stranger.goto(`/t/${task.number}`);
    await expect(notFound(stranger)).toBeVisible();
    await expect(stranger.getByText(task.title)).toHaveCount(0);
  } finally {
    await strangerContext.close();
  }

  // Signed out, it asks to log in first and comes back to it.
  const visitorContext = await browser.newContext({ baseURL });
  try {
    const visitor = await visitorContext.newPage();
    await visitor.goto(`/t/${task.number}`);
    await expect(visitor).toHaveURL(new RegExp(`/login\\?next=%2Ft%2F${task.number}$`));
  } finally {
    await visitorContext.close();
  }
});

test("search finds a task by AM-142 or 142, on the Tasks page and in Ctrl K", async ({ page, isMobile }) => {
  await continueAsGuest(page);
  // No digits in the titles, so a search for the number can only match by number.
  const found = await addTask(page, "Found by its number");
  const other = await addTask(page, "Another task");
  await page.goto("/tasks");
  const foundRow = page.getByRole("button", { name: found.title, exact: true });
  const otherRow = page.getByRole("button", { name: other.title, exact: true });
  await expect(otherRow).toBeVisible();

  if (isMobile) await page.getByRole("button", { name: "Search tasks", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search tasks" });
  for (const query of [`AM-${found.number}`, `am-${found.number}`, String(found.number)]) {
    await search.fill(query);
    await expect(foundRow, query).toBeVisible();
    await expect(otherRow, query).toHaveCount(0);
  }

  // Ctrl K lists it with its number after the title, and opens it. A guest's phone has Sign up free where its
  // Search button goes, and the palette is the same component there.
  if (isMobile) return;
  await page.keyboard.press("Control+K");
  await page.getByPlaceholder("Search or run a command...").fill(`AM-${found.number}`);
  const option = page.getByRole("option", { name: new RegExp(found.title) });
  await expect(option).toContainText(`AM-${found.number}`);
  await expect(page.getByRole("option", { name: new RegExp(other.title) })).toHaveCount(0);
  await option.click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${found.id}$`));
});

test("quick add keeps a task number in the title, never reading it as a date", async ({ page, isMobile }) => {
  await continueAsGuest(page);
  await page.goto("/tasks");
  if (isMobile) await plusTab(page).click();
  const input = page.getByRole("textbox", { name: "Add a task", exact: true });
  const details = page.getByRole("list", { name: "Details from your text" });

  // "3 Dec" was read as December 3, and the title lost the 3.
  await input.fill("Review AM-3 Dec");
  await expect(details).toHaveCount(0);
  // A real date beside a number still counts.
  await input.fill("Review AM-3 tomorrow");
  await expect(details.getByRole("listitem")).toHaveCount(1);
  await input.fill("Review AM-3 Dec");
  await expect(details).toHaveCount(0);
  await input.press("Enter");
  if (isMobile) await expect(page.getByRole("dialog", { name: "Add a task" })).toBeHidden();
  else await expect(input).toHaveValue("");
  await expect(page.getByRole("region", { name: /^No due date/ }).getByRole("button", { name: "Review AM-3 Dec", exact: true })).toBeVisible();
});
