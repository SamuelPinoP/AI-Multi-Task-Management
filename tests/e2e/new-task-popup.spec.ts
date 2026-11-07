import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

// The New task pop-up (#362, design 3A) and the quick add's buttons.

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function setUp(page: Page) {
  await continueAsGuest(page);
  const post = async <T>(url: string, data: Record<string, unknown>) => (await (await page.request.post(url, { data })).json()) as T;
  const project = await post<{ id: string; name: string }>("/api/projects", { name: uniqueName("Popup project") });
  expect((await page.request.post(`/api/projects/${project.id}/members`, { data: { name: "Dana Lee", role: "EDITOR" } })).ok()).toBe(true);
  const label = await post<{ id: string; name: string }>("/api/labels", { name: uniqueName("backend"), projectId: project.id });
  return { project, label };
}

/** Waits for open animations to end, as a person would, then clicks the page's top-left corner. */
async function clickOutside(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  await page.mouse.click(8, 8);
}

test("New task: every property from its buttons, then the task's page shows them", async ({ page }) => {
  const { project, label } = await setUp(page);
  const title = uniqueName("Popup task");
  await page.goto("/tasks");
  await page.getByRole("main").getByRole("button", { name: "New task", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Description").fill("Written in the pop-up.");

  // Without a project, the assignee picker says why it has no one to offer.
  await dialog.getByRole("button", { name: "Assignee: Unassigned" }).click();
  await expect(page.getByText("Add a project first: people are assigned within a project.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();

  // The pickers narrow as you type; Enter picks the highlighted one.
  await dialog.getByRole("button", { name: "Project: Add project" }).click();
  await page.getByLabel("Add to project").fill(project.name.slice(0, 12));
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: `Project: ${project.name}` })).toBeVisible();
  await dialog.getByRole("button", { name: "Status: To do" }).click();
  await page.getByRole("option", { name: "In progress" }).click();
  await dialog.getByRole("button", { name: "Priority: No priority" }).click();
  await page.getByRole("option", { name: "Urgent" }).click();
  await dialog.getByRole("button", { name: "Assignee: Unassigned" }).click();
  await expect(page.getByText(`Members of ${project.name}`)).toBeVisible();
  await page.getByRole("option", { name: "Dana Lee" }).click();
  await dialog.getByRole("button", { name: "Labels", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(`^${label.name}`) }).click();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Due date: none" }).click();
  await page.getByRole("button", { name: /^Tomorrow/ }).click();
  await dialog.getByRole("button", { name: "Repeat: Does not repeat" }).click();
  await page.getByRole("option", { name: "Weekly" }).click();

  // The pop-up passes axe with everything filled in.
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.nodes[0]?.target.join(" ")}`)).toEqual([]);

  await dialog.getByLabel("Title").press("ControlOrMeta+Enter");
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByLabel("Title")).toHaveValue(title);
  const properties = page.getByRole("complementary", { name: "Properties" });
  await expect(properties.getByRole("button", { name: "Status: In progress" })).toBeVisible();
  await expect(properties.getByRole("button", { name: "Priority: Urgent" })).toBeVisible();
  await expect(properties.getByRole("button", { name: "Assignee: Dana Lee" })).toBeVisible();
  await expect(properties.getByRole("button", { name: `Project: ${project.name}` })).toBeVisible();
  await expect(properties.getByRole("button", { name: "Repeats: Weekly" })).toBeVisible();
  await expect(properties).toContainText(label.name);
  await expect(page.getByLabel("Description")).toHaveValue("Written in the pop-up.");
});

test("New task: a click outside closes the open picker first, then the pop-up", async ({ page }) => {
  const { project } = await setUp(page);
  await page.goto("/tasks");
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByRole("button", { name: "Project: Add project" }).click();
  await page.getByRole("option", { name: project.name }).click();

  // The assignee picker: the first click outside closes only the picker.
  await dialog.getByRole("button", { name: "Assignee: Unassigned" }).click();
  await expect(page.getByRole("option", { name: "Dana Lee" })).toBeVisible();
  await clickOutside(page);
  await expect(page.getByRole("option", { name: "Dana Lee" })).toHaveCount(0);
  await expect(dialog).toBeVisible();

  // The labels picker behaves the same way.
  await dialog.getByRole("button", { name: "Labels", exact: true }).click();
  await expect(page.getByLabel("Find or create a label")).toBeVisible();
  await clickOutside(page);
  await expect(page.getByLabel("Find or create a label")).toHaveCount(0);
  await expect(dialog).toBeVisible();

  // So does the due date picker, and its Set button doesn't create the task.
  await dialog.getByLabel("Title").fill("Not yet");
  await dialog.getByRole("button", { name: "Due date: none" }).click();
  await page.getByLabel("Pick a date").fill(dateInputValue(3));
  await page.getByRole("button", { name: "Set", exact: true }).click();
  await expect(dialog.getByRole("button", { name: /^Due date: (?!none)/ })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Title")).toHaveValue("Not yet");

  // With nothing open, a click outside closes the pop-up.
  await clickOutside(page);
  await expect(dialog).toBeHidden();
});

test("quick add: its buttons set the details, and win over typed codes", async ({ page }) => {
  await continueAsGuest(page);
  const title = uniqueName("Buttons task");
  await page.goto("/tasks");
  const input = page.getByLabel("Add a task", { exact: true });
  await input.fill(`${title} !low`);
  const details = page.getByRole("group", { name: "Task details" });

  // The typed !low shows as the current priority; typing narrows the list.
  await details.getByRole("button", { name: "Priority", exact: true }).click();
  await expect(page.getByRole("option", { name: /^Low\W+current$/ })).toBeVisible();
  await page.getByLabel("Change priority").fill("high");
  await page.keyboard.press("Enter");

  // Without a project, the assignee picker says to add one.
  await details.getByRole("button", { name: "Assignee", exact: true }).click();
  await expect(page.getByText("Add a project first: people are assigned within a project.")).toBeVisible();
  await page.keyboard.press("Escape");

  // A date from the date field doesn't send the quick add early.
  await details.getByRole("button", { name: "Due date", exact: true }).click();
  await page.getByLabel("Pick a date").fill(dateInputValue(2));
  await page.getByRole("button", { name: "Set", exact: true }).click();
  await expect(input).toHaveValue(`${title} !low`);
  await expect(page.getByRole("list", { name: "Details you picked" })).toContainText("High");
  await input.press("Enter");
  await expect(input).toHaveValue("");

  const tasks = (await (await page.request.get("/api/tasks")).json()) as { title: string; priority: string; dueDate: string | null }[];
  const task = tasks.find((item) => item.title === title);
  expect(task?.priority).toBe("HIGH");
  expect(task?.dueDate?.slice(0, 10)).toBe(dateInputValue(2));
});
