import { expect, test } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

// Labels on tasks (#276): create one from a task, filter by it, rename it and delete it.
test("labels: create from a task, filter by it, rename and delete", async ({ page, isMobile }) => {
  const labeled = uniqueName("Labeled task");
  const other = uniqueName("Other task");
  const label = uniqueName("design").toLowerCase();
  await continueAsGuest(page);
  for (const title of [labeled, other]) {
    expect((await page.request.post("/api/tasks", { data: { title } })).ok()).toBe(true);
  }
  await page.goto("/tasks");

  // Create the label from the task's page; it's added to the task at once.
  await page.getByRole("button", { name: labeled, exact: true }).click();
  await expect(page.getByLabel("Title")).toHaveValue(labeled);
  const properties = page.getByRole("complementary", { name: "Properties" });
  await properties.getByRole("button", { name: "Add labels" }).click();
  await page.getByLabel("Find or create a label").fill(label);
  await page.getByRole("option", { name: `Create label “${label}”` }).click();
  // Checked labels say so to screen readers: "‹name›, added".
  await expect(page.getByRole("option", { name: new RegExp(`^${label}\\W+added$`) })).toBeVisible();
  // Escape closes only the picker; the page stays (it goes back to the list only when nothing has it).
  const taskUrl = page.url();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Find or create a label")).toHaveCount(0);
  await expect(properties).toContainText(label);
  expect(page.url()).toBe(taskUrl);
  await page.getByRole("link", { name: "Back to Tasks" }).click();
  const row = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: labeled, exact: true }) });
  await expect(row).toContainText(label);

  // Filter (#520): only the labeled task stays. (The quick add has a Labels button too.) Phones filter from the
  // Filter and sort sheet (#521).
  if (isMobile) {
    const sheet = page.getByRole("dialog", { name: "Filter and sort" });
    await page.getByRole("button", { name: "Filter and sort", exact: true }).click();
    await sheet.getByRole("group", { name: "Labels" }).getByRole("button", { name: label }).click();
    await sheet.getByRole("button", { name: "Show 1 task" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("button", { name: "Filter and sort, 1 on" })).toBeVisible();
  } else {
    const filters = page.getByRole("search", { name: "Filter tasks" });
    await filters.getByRole("button", { name: "Filter", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: label }).click();
    await page.keyboard.press("Escape");
    await expect(filters.getByRole("button", { name: "Filter, 1 on" })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: labeled, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: other, exact: true })).toHaveCount(0);
  if (isMobile) {
    const sheet = page.getByRole("dialog", { name: "Filter and sort" });
    await page.getByRole("button", { name: "Filter and sort, 1 on" }).click();
    await sheet.getByRole("button", { name: "Clear", exact: true }).click();
    await sheet.getByRole("button", { name: "Show 2 tasks" }).click();
    await expect(page.getByRole("button", { name: "Filter and sort", exact: true })).toBeVisible();
  } else {
    const filters = page.getByRole("search", { name: "Filter tasks" });
    await filters.getByRole("button", { name: "Filter, 1 on" }).click();
    await page.getByRole("menuitem", { name: "Clear filters" }).click();
    await expect(filters.getByRole("button", { name: "Filter", exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: other, exact: true })).toBeVisible();

  // Rename it from Edit labels; every task shows the new name.
  const renamed = `${label}-ui`;
  await page.getByRole("button", { name: labeled, exact: true }).click();
  await properties.getByRole("button", { name: "Change labels" }).click();
  await page.getByRole("button", { name: "Edit labels…" }).click();
  const manager = page.getByRole("dialog", { name: "Edit labels" });
  await manager.getByLabel(`Name of ${label}`).fill(renamed);
  await manager.getByLabel(`Name of ${label}`).press("Enter");
  await expect(manager.getByLabel(`Name of ${renamed}`)).toBeVisible();

  // Delete it: the task loses the label and stays.
  await manager.getByRole("button", { name: `Delete ${renamed}` }).click();
  await page.getByRole("dialog", { name: `Delete “${renamed}”?` }).getByRole("button", { name: "Delete label" }).click();
  await expect(page.getByText("Label deleted")).toBeVisible();
  await expect(manager).toContainText("No labels yet.");
  await page.keyboard.press("Escape");
  await expect(manager).toBeHidden();
  await expect(properties).not.toContainText(renamed);
  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: labeled, exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ has: page.getByRole("button", { name: labeled, exact: true }) })).not.toContainText(renamed);
});

test("labels: the project board shows the project's labels and filters by them", async ({ page }) => {
  await continueAsGuest(page);
  const post = async <T>(url: string, data: Record<string, unknown>) => (await (await page.request.post(url, { data })).json()) as T;
  const project = await post<{ id: string }>("/api/projects", { name: uniqueName("Board labels") });
  const bug = await post<{ id: string; name: string }>("/api/labels", { name: uniqueName("bug"), projectId: project.id });
  const tagged = uniqueName("Tagged card");
  const plain = uniqueName("Plain card");
  await post("/api/tasks", { title: tagged, projectId: project.id, labelIds: [bug.id] });
  await post("/api/tasks", { title: plain, projectId: project.id });

  await page.goto(`/projects/${project.id}/board`);
  const card = page.getByRole("article").filter({ hasText: tagged });
  await expect(card).toContainText(bug.name);
  await page.getByRole("button", { name: "Labels", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(`^${bug.name}`) }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("article").filter({ hasText: tagged })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: plain })).toHaveCount(0);
});
