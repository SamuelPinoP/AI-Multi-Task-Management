import { expect, test } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

// The Tasks page groups tasks by project (#348, design 1B).
test("tasks: one card per project, no project first, then by priority", async ({ page }) => {
  await continueAsGuest(page);
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

  // Each project links to its Calendar and Notes, already filtered.
  await expect(cards.nth(1).getByRole("link", { name: `Calendar for ${urgent.name}` })).toHaveAttribute("href", `/events/calendar?project=${urgent.id}`);
  await expect(cards.nth(1).getByRole("link", { name: `Notes for ${urgent.name}` })).toHaveAttribute("href", `/notes?project=${urgent.id}`);
  await cards.nth(1).getByRole("link", { name: `Calendar for ${urgent.name}` }).click();
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue(urgent.id);

  // "No project" itself files its tasks into a project, with Undo.
  await page.goto("/tasks");
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

test("notes: a project link opens the Notes page filtered to it", async ({ page }) => {
  await continueAsGuest(page);
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("Notes project") } })).json()) as { id: string };
  await page.goto(`/notes?project=${project.id}`);
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue(project.id);
  await page.goto("/notes?project=none");
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue("none");
});
