import { expect, test } from "@playwright/test";
import { signUpAndLogIn, uniqueName } from "./helpers";

// SMART-11: project templates and simple automations.

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

test("automations: new tasks go to a member until the rule is turned off", async ({ page }) => {
  await signUpAndLogIn(page, "Automations");
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("Rules") } })).json()) as { id: string };
  const member = await page.request.post(`/api/projects/${project.id}/members`, { data: { name: "Alex Rivera", role: "EDITOR" } });
  expect(member.status()).toBe(201);
  const newTask = async (title: string) =>
    (await (await page.request.post("/api/tasks", { data: { title, projectId: project.id } })).json()) as {
      id: string;
      assignee: { name: string } | null;
    };

  await page.goto(`/projects/${project.id}`);
  const section = page.getByRole("region", { name: "Automations" });
  await expect(section).toContainText("No automations yet");

  await section.getByLabel("New rule").selectOption({ label: "When a task is added without an assignee, assign it to a member" });
  await section.getByLabel("Assign to").selectOption({ label: "Alex Rivera" });
  await section.getByRole("button", { name: "Add rule" }).click();
  const assignRule = section.getByRole("switch", { name: "When a task is added without an assignee, assign it to Alex Rivera" });
  await expect(assignRule).toHaveAttribute("aria-checked", "true");

  const parent = await newTask("Goes to Alex");
  expect(parent.assignee?.name).toBe("Alex Rivera");
  // Subtasks are checklist items: the rule leaves them alone.
  const subtask = (await (
    await page.request.post("/api/tasks", { data: { title: "Checklist item", parentId: parent.id } })
  ).json()) as { assignee: unknown };
  expect(subtask.assignee).toBeNull();

  await assignRule.click();
  await expect(assignRule).toHaveAttribute("aria-checked", "false");
  expect((await newTask("Stays unassigned")).assignee).toBeNull();

  // The email rule is added the same way (this test server doesn't send email).
  await section.getByLabel("New rule").selectOption({ label: "When a task moves to Done, email the project owner" });
  await section.getByRole("button", { name: "Add rule" }).click();
  await expect(section.getByRole("switch", { name: "When a task moves to Done, email the project owner" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await page.reload();
  await expect(assignRule).toHaveAttribute("aria-checked", "false");
  await section.getByRole("button", { name: "Delete rule: When a task is added without an assignee, assign it to Alex Rivera" }).click();
  await expect(assignRule).toHaveCount(0);
  await page.reload();
  await expect(section.getByRole("switch")).toHaveCount(1);
});
