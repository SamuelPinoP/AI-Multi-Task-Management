import { expect, test } from "@playwright/test";
import { continueAsGuest, plusTab, signUpAndLogIn, uniqueName } from "./helpers";

// The Tasks page groups tasks by project (#348): one full-width band each since #520 (design 1D).
test("tasks: one band per project, no project first, then by priority", async ({ page }) => {
  // An account: it makes more projects than a guest workspace holds (#458).
  await signUpAndLogIn(page, "Tasks by project");
  const post = async <T>(url: string, data: Record<string, unknown>) => (await (await page.request.post(url, { data })).json()) as T;
  const low = await post<{ id: string; name: string }>("/api/projects", { name: uniqueName("Low project"), priority: "LOW" });
  const urgent = await post<{ id: string; name: string }>("/api/projects", { name: uniqueName("Urgent project"), priority: "URGENT" });
  const loose = uniqueName("Loose task");
  await post("/api/tasks", { title: uniqueName("Low task"), projectId: low.id });
  await post("/api/tasks", { title: uniqueName("Urgent task"), projectId: urgent.id });
  await post("/api/tasks", { title: loose });

  await page.goto("/tasks");
  const cards = page.locator("#main-content section[aria-labelledby^='group-']");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0).getByRole("heading", { level: 2 })).toHaveText(/^No project/);
  await expect(cards.nth(1).getByRole("heading", { level: 2 })).toHaveText(urgent.name);
  await expect(cards.nth(2).getByRole("heading", { level: 2 })).toHaveText(low.name);
  await expect(cards.nth(1)).toContainText("Urgent");
  await expect(cards.nth(1)).toContainText("1 active");

  // Each band's ⋯ opens its project's Calendar and Notes, already filtered, and its page (#520).
  await cards.nth(1).getByRole("button", { name: `More for ${urgent.name}` }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Open in Calendar" })).toHaveAttribute("href", `/events/calendar?project=${urgent.id}`);
  await expect(menu.getByRole("menuitem", { name: "Project notes" })).toHaveAttribute("href", `/notes?project=${urgent.id}`);
  await expect(menu.getByRole("menuitem", { name: "Open project" })).toHaveAttribute("href", `/projects/${urgent.id}`);
  await menu.getByRole("menuitem", { name: "Open in Calendar" }).click();
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue(urgent.id);

  // No project's ⋯ has its Calendar and Notes too.
  await page.goto("/tasks");
  await cards.nth(0).getByRole("button", { name: "More for No project" }).click();
  await expect(menu.getByRole("menuitem", { name: "Open in Calendar" })).toHaveAttribute("href", "/events/calendar?project=none");
  await expect(menu.getByRole("menuitem", { name: "Notes with no project" })).toHaveAttribute("href", "/notes?project=none");
  await expect(menu.getByRole("menuitem", { name: "Open project" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // "No project" itself files its tasks into a project, with Undo.
  await page.getByRole("button", { name: "No project", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: low.name }).click();
  await expect(page.getByText(`1 task moved to ${low.name}`)).toBeVisible();
  await expect(cards).toHaveCount(2);
  await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: low.name }) }).getByRole("button", { name: loose, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Change undone")).toBeVisible();
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0).getByRole("button", { name: loose, exact: true })).toBeVisible();
});

test("a band's + starts a task in its project from the add box, and a band folds (#520)", async ({ page, isMobile }) => {
  await continueAsGuest(page);
  const post = async <T>(url: string, data: Record<string, unknown>) => (await (await page.request.post(url, { data })).json()) as T;
  const project = await post<{ id: string; name: string }>("/api/projects", { name: uniqueName("Band project") });
  const first = uniqueName("First in band");
  await post("/api/tasks", { title: first, projectId: project.id });
  await page.goto("/tasks");

  // + puts the cursor in the add box with the project picked; Enter adds the task to the band. On a phone the band's
  // ⋯ has it, and the add box opens as a sheet (#521).
  const band = page.getByRole("region", { name: project.name });
  if (isMobile) {
    await band.getByRole("button", { name: `More for ${project.name}` }).click();
    await page.getByRole("menuitem", { name: `New task in ${project.name}` }).click();
  } else {
    await band.getByRole("button", { name: `New task in ${project.name}` }).click();
  }
  const input = page.getByRole("textbox", { name: "Add a task", exact: true });
  await expect(input).toBeFocused();
  await expect(page.getByRole("list", { name: "Details you picked" })).toContainText(project.name);
  const second = uniqueName("Added from the band");
  await input.fill(second);
  await input.press("Enter");
  await expect(band.getByRole("button", { name: second, exact: true })).toBeVisible();

  // Folding a band hides its tasks, not the band.
  await band.getByRole("button", { name: `Fold ${project.name}` }).click();
  await expect(band.getByRole("button", { name: first, exact: true })).toHaveCount(0);
  await expect(band.getByRole("heading", { level: 2 })).toHaveText(project.name);
  await band.getByRole("button", { name: `Unfold ${project.name}` }).click();
  await expect(band.getByRole("button", { name: first, exact: true })).toBeVisible();
});

test("notes: a project link opens the Notes page filtered to it", async ({ page }) => {
  await continueAsGuest(page);
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("Notes project") } })).json()) as { id: string };
  await page.goto(`/notes?project=${project.id}`);
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue(project.id);
  await page.goto("/notes?project=none");
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue("none");
});

test("a long project name truncates in its band, and the quick add's text keeps its width on phones", async ({ page, isMobile }) => {
  await continueAsGuest(page);
  const post = async <T>(url: string, data: Record<string, unknown>) => (await (await page.request.post(url, { data })).json()) as T;
  const project = await post<{ id: string; name: string }>("/api/projects", { name: uniqueName("A project with a rather long name for a phone screen"), priority: "HIGH" });
  await post("/api/tasks", { title: uniqueName("Long name task"), projectId: project.id });
  await page.goto("/tasks");

  // The name gives way; ⋯ stays on the name's line, and so does + on a computer (a phone's band has it in ⋯, #521).
  const band = page.getByRole("region", { name: project.name });
  const middle = async (box: { y: number; height: number } | null) => (box ? box.y + box.height / 2 : Number.NaN);
  const name = await middle(await band.getByRole("heading", { level: 2 }).boundingBox());
  const controls = [band.getByRole("button", { name: `More for ${project.name}` })];
  if (!isMobile) controls.push(band.getByRole("button", { name: `New task in ${project.name}` }));
  for (const control of controls) {
    expect(Math.abs((await middle(await control.boundingBox())) - name)).toBeLessThan(6);
  }

  // On phones the add box is a sheet from the + tab, whose buttons sit under the text, which keeps most of the width.
  if (isMobile) {
    await plusTab(page).click();
    await expect(page.getByRole("dialog", { name: "Add a task" })).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  }
  const input = await page.getByRole("textbox", { name: "Add a task", exact: true }).boundingBox();
  const details = await page.getByRole("group", { name: "Task details" }).boundingBox();
  expect(input && details).toBeTruthy();
  if (isMobile) {
    expect(details!.y).toBeGreaterThanOrEqual(input!.y + input!.height - 1);
    expect(input!.width).toBeGreaterThan(250);
  } else {
    expect(Math.abs(details!.y + details!.height / 2 - (input!.y + input!.height / 2))).toBeLessThan(6);
  }
});
