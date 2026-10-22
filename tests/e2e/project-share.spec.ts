import { expect, test } from "@playwright/test";
import { STUB_REPO } from "./github-stub";
import { signUpAndLogIn, uniqueName } from "./helpers";

// SMART-12: a GitHub repository per project, and read-only share links.
// GitHub is played by tests/e2e/github-stub.ts.

test("an owner links GitHub and shares a read-only roadmap that hides private details", async ({ page, browser }) => {
  await signUpAndLogIn(page, "Sharer");
  const name = uniqueName("Shared roadmap");
  const project = (await (
    await page.request.post("/api/projects", { data: { name, description: "Capstone for the advisor." } })
  ).json()) as { id: string };
  const post = async (url: string, data: Record<string, unknown>) => {
    const response = await page.request.post(url, { data });
    expect(response.ok(), `${url} -> ${response.status()}`).toBe(true);
    return (await response.json()) as { id: string };
  };
  const parent = await post("/api/tasks", { title: "Build the prototype", description: "Private task details", projectId: project.id, status: "IN_PROGRESS" });
  await post("/api/tasks", { title: "Wire up the sensors", parentId: parent.id, status: "DONE" });
  await post("/api/tasks", { title: "Write the report", projectId: project.id });
  await post(`/api/projects/${project.id}/members`, { name: "Dana Private", role: "EDITOR" });
  await post("/api/notes", { title: "Private note title", content: "Never on the share page", projectId: project.id });
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await post("/api/events", { title: "Weekly sync", startDate: tomorrow, startTime: "09:00", endDate: "", endTime: "", recurrence: "WEEKLY", projectId: project.id });

  await page.goto(`/projects/${project.id}`);

  // GitHub: refused repositories explain why; a public one shows its pull requests and issues.
  const github = page.getByRole("region", { name: "GitHub" });
  const repoField = github.getByLabel("Repository");
  await repoField.fill("ai-multi-demo/hidden");
  await github.getByRole("button", { name: "Link repository" }).click();
  await expect(github.getByRole("alert")).toContainText("doesn't show a public repository called ai-multi-demo/hidden");
  await repoField.fill("not a repository");
  await github.getByRole("button", { name: "Link repository" }).click();
  await expect(github.getByRole("alert")).toContainText("owner/name");
  await repoField.fill(`https://github.com/${STUB_REPO}.git`);
  await github.getByRole("button", { name: "Link repository" }).click();
  await expect(github.getByRole("link", { name: new RegExp(`^${STUB_REPO}`) })).toHaveAttribute("href", `https://github.com/${STUB_REPO}`);
  await expect(github).toContainText("42 stars");
  await expect(github.getByRole("link", { name: "#12 Add the share page" })).toBeVisible();
  await expect(github.getByRole("link", { name: "#7 Export the calendar" })).toBeVisible();
  // The issue list from GitHub includes the pull request; it shows once.
  await expect(github.getByRole("link", { name: /#12/ })).toHaveCount(1);

  // Share.
  const share = page.getByRole("region", { name: "Share" });
  await share.getByRole("button", { name: "Create share link" }).click();
  const link = share.getByLabel("Share link");
  await expect(link).toHaveValue(/\/share\/[A-Za-z0-9_-]{32}$/);
  const firstUrl = await link.inputValue();

  // A visitor who isn't signed in.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  // The root loading.tsx streams pages, so a missing page still answers HTTP 200 with the
  // "not found" page (and noindex). Check what the visitor sees, and the API's real status.
  const expectGone = async (url: string) => {
    await visitor.goto(url);
    await expect(visitor.getByText("This page could not be found.")).toBeVisible();
    await expect(visitor.getByText(name)).toHaveCount(0);
    const token = new URL(url, "http://x").pathname.split("/").pop();
    expect((await visitorContext.request.get(`/api/share/${token}/github`)).status()).toBe(404);
  };
  const response = await visitor.goto(firstUrl);
  expect(response?.status()).toBe(200);
  await expect(visitor.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(visitor.getByText("Capstone for the advisor.")).toBeVisible();
  const roadmap = visitor.getByRole("region", { name: "Roadmap" });
  await expect(roadmap.getByRole("region", { name: "In progress" })).toContainText("Build the prototype");
  await expect(roadmap.getByRole("region", { name: "In progress" })).toContainText("1 of 1 subtasks done");
  await expect(roadmap.getByRole("region", { name: "Up next" })).toContainText("Write the report");
  // A weekly event shows once, at its next date.
  const upcoming = visitor.getByRole("region", { name: "Coming up" });
  await expect(upcoming.getByRole("listitem").filter({ hasText: "Weekly sync" })).toHaveCount(1);
  await expect(upcoming).toContainText("Repeats weekly");
  await expect(visitor.getByRole("region", { name: "GitHub" }).getByRole("link", { name: "#7 Export the calendar" })).toBeVisible();
  for (const secret of ["Private task details", "Dana Private", "Private note title", "Never on the share page"]) {
    await expect(visitor.locator("body")).not.toContainText(secret);
  }
  // Next.js streams page metadata, so the tags can appear twice; the <head> copy is what browsers use first.
  await expect(visitor.locator('head meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
  await expect(visitor.locator('head meta[name="referrer"]').first()).toHaveAttribute("content", "no-referrer");
  // No app navigation for visitors.
  await expect(visitor.getByRole("link", { name: "Tasks", exact: true })).toHaveCount(0);

  // A new link replaces the old one.
  await share.getByRole("button", { name: "New link" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Replace link" }).click();
  await expect(link).not.toHaveValue(firstUrl);
  const secondUrl = await link.inputValue();
  await expectGone(firstUrl);
  await visitor.goto(secondUrl);
  await expect(visitor.getByRole("heading", { level: 1, name })).toBeVisible();

  // Turning sharing off ends it.
  await share.getByRole("button", { name: "Turn off" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Turn off" }).click();
  await expect(share.getByRole("button", { name: "Create share link" })).toBeVisible();
  await expectGone(secondUrl);
  await expectGone("/share/not-a-real-token");
  await visitorContext.close();

  // Unlinking hides the panel's repository; the form comes back.
  await github.getByRole("button", { name: "Unlink" }).click();
  await expect(github.getByLabel("Repository")).toBeVisible();
});

test("a busy GitHub doesn't stop linking", async ({ page }) => {
  await signUpAndLogIn(page, "Busy GitHub");
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("Busy") } })).json()) as { id: string };
  const linked = await page.request.put(`/api/projects/${project.id}/github`, { data: { repo: "ai-multi-demo/busy" } });
  expect(linked.status()).toBe(200);
  expect(await linked.json()).toEqual({ repo: "ai-multi-demo/busy", checked: false });

  await page.goto(`/projects/${project.id}`);
  await expect(page.getByRole("region", { name: "GitHub" })).toContainText("GitHub is limiting requests right now");
});
