import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

// TEST-04 (#140) and DES-06 (#134): every page passes axe's WCAG 2.1 A and AA rules.
const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function violations(page: Page, label: string) {
  // Let open/close animations finish, so colors are measured at full opacity.
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  const results = await new AxeBuilder({ page }).withTags(wcag).analyze();
  return results.violations.map(
    (violation) => `${label}: ${violation.id} (${violation.nodes.length}) ${violation.help} -> ${violation.nodes[0]?.target.join(" ")}`,
  );
}

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function seedWorkspace(page: Page) {
  const post = async (url: string, data: Record<string, unknown>) => (await page.request.post(url, { data })).json();
  const project = (await post("/api/projects", { name: uniqueName("A11y project"), color: "#0f9488" })) as { id: string };
  await post("/api/tasks", { title: "Overdue task", priority: "HIGH", dueDate: dateInputValue(-2), projectId: project.id });
  await post("/api/tasks", { title: "Task for today", dueDate: dateInputValue(0) });
  await post("/api/tasks", { title: "Finished task", status: "DONE" });
  await post("/api/events", {
    title: "Stand-up",
    startDate: dateInputValue(-3),
    startTime: "09:00",
    endDate: "",
    endTime: "",
    recurrence: "DAILY",
    projectId: project.id,
  });
  await post("/api/notes", { title: "A note", content: "Some text", projectId: project.id });
  return project.id;
}

test("public pages have no WCAG A/AA violations", async ({ page }) => {
  const found: string[] = [];
  for (const path of ["/login", "/signup", "/forgot-password"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    found.push(...(await violations(page, path)));
  }
  expect(found).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`every signed-in page has no WCAG A/AA violations (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await continueAsGuest(page);
    const projectId = await seedWorkspace(page);
    await page.evaluate((value) => localStorage.setItem("ai-multi-theme", value), theme);

    const found: string[] = [];
    for (const path of ["/", "/today", "/tasks", "/projects", `/projects/${projectId}`, "/notes", "/events", "/events/calendar", "/board", "/planner", "/roadmap", "/trash"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      found.push(...(await violations(page, path)));
    }

    // At 320px wide, tables scroll sideways whatever the fonts; they must stay keyboard-reachable.
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/projects/${projectId}`);
    await page.waitForLoadState("networkidle");
    found.push(...(await violations(page, "project page at 320px")));
    if (viewport) await page.setViewportSize(viewport);

    // Dialogs and sheets too.
    await page.goto("/tasks");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Overdue task", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Edit task" })).toBeVisible();
    found.push(...(await violations(page, "task sheet")));
    await page.keyboard.press("Escape");

    await page.keyboard.press("n");
    await expect(page.getByRole("dialog", { name: "New task" })).toBeVisible();
    found.push(...(await violations(page, "new task dialog")));
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+K");
    await page.keyboard.type("task");
    await expect(page.getByRole("option").first()).toBeVisible();
    found.push(...(await violations(page, "command palette")));

    expect(found).toEqual([]);
  });
}
