import { expect, test } from "@playwright/test";
import { STUB_REPO } from "./github-stub";
import { signUpAndLogIn, uniqueName } from "./helpers";

// SMART-12: a public GitHub repository per project, shown on the project page.
// GitHub is played by tests/e2e/github-stub.ts.

test("an owner links GitHub, sees its pull requests and issues, and unlinks it", async ({ page }) => {
  await signUpAndLogIn(page, "GitHub owner");
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("GitHub project") } })).json()) as {
    id: string;
  };

  await page.goto(`/projects/${project.id}`);
  const github = page.getByRole("region", { name: "GitHub" });
  await expect(github).toBeVisible();
  // Share links were removed (#342): the page has no Share section, even for the owner.
  await expect(page.getByRole("region", { name: "Share" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create share link" })).toHaveCount(0);

  // Refused repositories explain why; a public one shows its pull requests and issues.
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
  await expect(github.getByRole("link", { name: "#12 Add a weekly summary email" })).toBeVisible();
  await expect(github.getByRole("link", { name: "#7 Export the calendar" })).toBeVisible();
  // The issue list from GitHub includes the pull request; it shows once.
  await expect(github.getByRole("link", { name: /#12/ })).toHaveCount(1);

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

test("old share links show nothing", async ({ page, browser }) => {
  // Links made before share links were removed (#342) look like this: 32 base64url characters.
  const oldLink = "/share/AbCdEfGhIjKlMnOpQrStUvWxYz012345";

  // Signed out, an old link asks for a login like any other private page.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(oldLink);
  await expect(visitor).toHaveURL(/\/login\?next=%2Fshare%2F/);
  await visitorContext.close();

  // Signed in, it's a missing page, and the API that made links is gone.
  await signUpAndLogIn(page, "Old link");
  await page.goto(oldLink);
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("No sharing") } })).json()) as { id: string };
  expect((await page.request.post(`/api/projects/${project.id}/share`)).status()).toBe(404);
});
