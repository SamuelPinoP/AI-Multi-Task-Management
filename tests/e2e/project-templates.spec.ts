import { expect, test } from "@playwright/test";
import { signUpAndLogIn, uniqueName } from "./helpers";

// SMART-11: project templates. Its automations were removed in #383.

test("a template starts the project with tasks, subtasks and a weekly check-in", async ({ page }) => {
  await signUpAndLogIn(page, "Templates");
  await page.goto("/projects");
  const main = page.locator("#main-content");
  const name = uniqueName("Capstone");

  await main.getByRole("button", { name: "New project" }).click();
  const sheet = page.getByRole("dialog", { name: "New project" });
  await sheet.getByLabel("Name").fill(name);
  await expect(sheet.getByRole("radio", { name: /^Blank project/ })).toHaveAttribute("aria-checked", "true");
  const capstone = sheet.getByRole("radio", { name: /^Capstone/ });
  await expect(capstone).toContainText("Adds 10 tasks and a recurring check-in");
  await capstone.click();
  await expect(capstone).toHaveAttribute("aria-checked", "true");
  await sheet.getByRole("button", { name: "Create project" }).click();
  await expect(sheet).toBeHidden();

  await main.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(main.getByText("Capstone project: from the problem statement to the final presentation.")).toBeVisible();
  await expect(main.getByRole("heading", { name: "Write the problem statement" })).toBeVisible();
  // Subtasks come along with their parent.
  await expect(main.getByRole("heading", { name: "Proofread" })).toBeVisible();
  const checkIn = main.locator("article").filter({ has: page.getByRole("heading", { name: "Advisor check-in" }) });
  await expect(checkIn).toContainText(/Repeats weekly until/);

  // The Sprint template puts its first task on the board's In progress column.
  const sprint = await (
    await page.request.post("/api/projects", { data: { name: uniqueName("Sprint"), templateId: "sprint" } })
  ).json();
  const tasks = (await (await page.request.get("/api/tasks")).json()) as { title: string; status: string; projectId: string }[];
  expect(tasks.find((task) => task.projectId === sprint.id && task.title === "Set the sprint goal")?.status).toBe("IN_PROGRESS");

  const unknown = await page.request.post("/api/projects", { data: { name: "No such template", templateId: "nope" } });
  expect(unknown.status()).toBe(400);
});

test("projects have no automations: no section, no API, and a new task keeps the assignee it names (#383)", async ({ page }) => {
  await signUpAndLogIn(page, "No automations");
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("Rules") } })).json()) as { id: string };
  const { member } = (await (
    await page.request.post(`/api/projects/${project.id}/members`, { data: { name: "Alex Rivera", role: "EDITOR" } })
  ).json()) as { member: { id: string } };

  expect((await page.request.get(`/api/projects/${project.id}/automations`)).status()).toBe(404);
  const unassigned = (await (await page.request.post("/api/tasks", { data: { title: "Nobody yet", projectId: project.id } })).json()) as {
    assignee: unknown;
  };
  expect(unassigned.assignee).toBeNull();
  const assigned = (await (
    await page.request.post("/api/tasks", { data: { title: "For Alex", projectId: project.id, assigneeId: member.id } })
  ).json()) as { assignee: { name: string } | null };
  expect(assigned.assignee?.name).toBe("Alex Rivera");

  await page.goto(`/projects/${project.id}`);
  await expect(page.getByRole("heading", { name: "Assigned Notes" }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Automations" })).toHaveCount(0);
  await expect(page.getByText("No automations yet")).toHaveCount(0);
});
