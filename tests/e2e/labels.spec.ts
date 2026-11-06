import { expect, test } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

// Labels on tasks (#276): create one from a task, filter by it, rename it and delete it.
test("labels: create from a task, filter by it, rename and delete", async ({ page }) => {
  const labeled = uniqueName("Labeled task");
  const other = uniqueName("Other task");
  const label = uniqueName("design").toLowerCase();
  await continueAsGuest(page);
  for (const title of [labeled, other]) {
    expect((await page.request.post("/api/tasks", { data: { title } })).ok()).toBe(true);
  }
  await page.goto("/tasks");

  // Create the label from the task's form; it's added to the task at once.
  await page.getByRole("button", { name: labeled, exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Edit task" });
  await sheet.getByRole("button", { name: "Add labels" }).click();
  await page.getByLabel("Find or create a label").fill(label);
  await page.getByRole("option", { name: `Create label “${label}”` }).click();
  // Checked labels say so to screen readers: "‹name›, added".
  await expect(page.getByRole("option", { name: new RegExp(`^${label}\\W+added$`) })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet.getByRole("group", { name: "Labels" })).toContainText(label);
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(sheet).toBeHidden();
  const row = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: labeled, exact: true }) });
  await expect(row).toContainText(label);

  // Filter: only the labeled task stays.
  await page.getByRole("button", { name: "Labels", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(`^${label}`) }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Labels: 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: labeled, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: other, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Labels: 1" }).click();
  await page.getByRole("button", { name: "Clear label filter" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Labels", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: other, exact: true })).toBeVisible();

  // Rename it from Edit labels; every task shows the new name.
  const renamed = `${label}-ui`;
  await page.getByRole("button", { name: labeled, exact: true }).click();
  await sheet.getByRole("button", { name: "Change labels" }).click();
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
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await page.reload();
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
