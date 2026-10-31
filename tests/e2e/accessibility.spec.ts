import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { ACCENTS } from "../../src/lib/accent";
import { continueAsGuest, signUpAndLogIn, uniqueName } from "./helpers";

// TEST-04 (#140) and DES-06 (#134): every page passes axe's WCAG 2.1 A and AA rules.
const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function violations(page: Page, label: string) {
  // Let open/close animations finish, so colors are measured at full opacity.
  // Loading spinners loop forever, so skip animations that never end.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
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
  await post("/api/tasks", { title: "Task for today", description: "Shown under the title", dueDate: dateInputValue(0) });
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
  // Phase 6 sections on the project page: an automation, a linked repository (the GitHub
  // stand-in from github-stub.ts) and a share link, whose public page is scanned too.
  await post(`/api/projects/${project.id}/automations`, { trigger: "TASK_COMPLETED", action: "EMAIL_OWNER" });
  await page.request.put(`/api/projects/${project.id}/github`, { data: { repo: "ai-multi-demo/roadmap" } });
  const share = (await post(`/api/projects/${project.id}/share`, {})) as { path: string };
  // A tree page with a child, so the tree view shows a filled root card and a plain one.
  const tree = (await post("/api/tree-pages", { title: "A11y tree" })) as { id: string; nodes: { id: string }[] };
  await post(`/api/tree-pages/${tree.id}/nodes`, { title: "Child idea", parentId: tree.nodes[0].id, color: "amber" });
  return { projectId: project.id, sharePath: share.path, treePath: `/tree/${tree.id}` };
}

test("public pages have no WCAG A/AA violations", async ({ page }) => {
  const found: string[] = [];
  for (const path of ["/login", "/signup", "/signup?error=exists&email=a11y%40example.test", "/forgot-password", "/verify-email", "/verify-email?status=invalid"]) {
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
    const { projectId, sharePath, treePath } = await seedWorkspace(page);
    await page.evaluate((value) => localStorage.setItem("ai-multi-theme", value), theme);

    const found: string[] = [];
    // "/login?email=…" for another address shows "Switch accounts?".
    for (const path of ["/", "/today", "/login?email=a11y-other%40example.test", "/chats", `/chats?project=${projectId}`, "/tasks", "/projects", `/projects/${projectId}`, "/notes", "/events", "/events/calendar", "/board", "/tree", treePath, "/planner", "/goals", "/roadmap", "/trash", sharePath]) {
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

    await page.goto("/projects");
    await page.locator("#main-content").getByRole("button", { name: "New project" }).click();
    await expect(page.getByRole("dialog", { name: "New project" })).toBeVisible();
    found.push(...(await violations(page, "new project sheet")));
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+K");
    await page.keyboard.type("task");
    await expect(page.getByRole("option").first()).toBeVisible();
    found.push(...(await violations(page, "command palette")));

    expect(found).toEqual([]);
  });
}

// DES-15 (#321): Home and the account menu that picks the color, in every accent palette and both themes.
test("every accent palette has no WCAG A/AA violations", async ({ page, isMobile }) => {
  test.skip(isMobile, "The palettes don't depend on the screen size.");
  test.setTimeout(120_000);
  await continueAsGuest(page);
  await seedWorkspace(page);

  const found: string[] = [];
  for (const theme of ["light", "dark"]) {
    for (const { id } of ACCENTS) {
      await page.evaluate(
        ([themeValue, accentValue]) => {
          localStorage.setItem("ai-multi-theme", themeValue);
          localStorage.setItem("ai-multi-accent", accentValue);
        },
        [theme, id],
      );
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveAttribute("data-accent", id);
      found.push(...(await violations(page, `Home (${id}, ${theme})`)));

      await page.getByRole("button", { name: "Account menu" }).click();
      await expect(page.getByRole("menuitemradio", { name: "Teal" })).toBeVisible();
      found.push(...(await violations(page, `account menu (${id}, ${theme})`)));
      await page.keyboard.press("Escape");
    }
  }
  expect(found).toEqual([]);
});

// Unread badges only show after someone else posts, which the scans above never do.
test("unread chat badges have no WCAG A/AA violations", async ({ page, browser, isMobile }) => {
  test.skip(isMobile, "The sidebar is a menu sheet on phones.");
  const teammateContext = await browser.newContext();
  const teammatePage = await teammateContext.newPage();
  const teammate = await signUpAndLogIn(teammatePage, "A11y teammate");
  await continueAsGuest(page);

  const projectName = uniqueName("A11y shared project");
  const project = (await (await page.request.post("/api/projects", { data: { name: projectName } })).json()) as { id: string };
  expect((await page.request.post(`/api/projects/${project.id}/invitations`, { data: { email: teammate.email, role: "EDITOR" } })).ok()).toBe(true);
  const invitations = (await (await teammatePage.request.get("/api/project-invitations")).json()) as { id: string; project: { id: string } }[];
  const invitation = invitations.find((item) => item.project.id === project.id);
  expect(invitation).toBeTruthy();
  expect((await teammatePage.request.patch(`/api/project-invitations/${invitation!.id}`, { data: { action: "ACCEPT" } })).ok()).toBe(true);
  expect((await teammatePage.request.post(`/api/projects/${project.id}/comments`, { data: { message: "A new message" } })).ok()).toBe(true);
  await teammateContext.close();

  // The sidebar's Chats link and the open project's Chat link show a count.
  const found: string[] = [];
  await page.goto(`/projects/${project.id}`);
  await page.waitForLoadState("networkidle");
  const sidebar = page.getByRole("navigation", { name: "Workspace" });
  await expect(sidebar.getByRole("link", { name: "Chats, 1 with new messages" })).toBeVisible();
  await expect(sidebar.getByRole("group", { name: `${projectName} pages` }).getByRole("link", { name: "Chat, 1 unread" })).toBeVisible();
  found.push(...(await violations(page, "project page with an unread message")));

  await page.goto("/chats");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("list", { name: "Project chats" }).getByRole("link", { name: new RegExp(`^${projectName}.*1 unread message$`) })).toBeVisible();
  found.push(...(await violations(page, "Chats page with an unread message")));

  expect(found).toEqual([]);
});

// Attachments need an account (guests can't upload), so the scans above never see them.
for (const theme of ["light", "dark"] as const) {
  test(`project chat with attachments has no WCAG A/AA violations (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    const fixture = (name: string) => path.join(process.cwd(), "tests", "fixtures", name);
    const chatMessage = uniqueName("A11y attachments");
    await signUpAndLogIn(page, "A11y uploader");
    await page.evaluate((value) => localStorage.setItem("ai-multi-theme", value), theme);
    const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("A11y chat project") } })).json()) as { id: string };

    const found: string[] = [];
    await page.goto(`/projects/${project.id}/chat`);
    await page.waitForLoadState("networkidle");
    await page
      .locator('input[type="file"]')
      .setInputFiles(["sample-photo.png", "sample-clip.webm", "sample-brief.pdf", "sample-notes.docx", "sample-tasks.csv"].map(fixture));
    await expect(page.getByRole("list", { name: "Files to send" }).getByRole("listitem")).toHaveCount(5);
    found.push(...(await violations(page, "chat composer with files")));

    await page.getByPlaceholder(/share an update/i).fill(chatMessage);
    await page.getByRole("button", { name: /send message/i }).click();
    const messageCard = page.locator("article").filter({ hasText: chatMessage });
    await expect(messageCard.getByText("Sending")).toBeHidden();
    await expect(messageCard.getByText(/^\d+:\d{2}$/)).toBeVisible();
    await messageCard.getByRole("button", { name: "Open sample-brief.pdf" }).scrollIntoViewIfNeeded();
    await expect(messageCard.getByText(/PDF document .* 2 pages/)).toBeVisible({ timeout: 30_000 });
    found.push(...(await violations(page, "chat message with attachments")));

    // The viewer, on a photo and on the PDF (its zoom bar), with the other files as thumbs.
    await messageCard.getByRole("button", { name: "Open sample-photo.png" }).click();
    const viewer = page.getByRole("dialog");
    await expect(viewer).toHaveAccessibleName("sample-photo.png, 1 of 5");
    found.push(...(await violations(page, "attachment viewer on a photo")));
    await viewer.getByRole("button", { name: "Show sample-brief.pdf" }).click();
    await expect(viewer).toHaveAccessibleName("sample-brief.pdf, 3 of 5");
    await expect(viewer.getByRole("button", { name: "Zoom in" })).toBeVisible();
    found.push(...(await violations(page, "attachment viewer on a PDF")));
    await viewer.getByRole("button", { name: "Show sample-tasks.csv" }).click();
    await expect(viewer.getByRole("table")).toBeVisible();
    found.push(...(await violations(page, "attachment viewer on a CSV file")));

    expect(found).toEqual([]);
  });
}
