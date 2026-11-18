import { expect, test } from "@playwright/test";
import { expectHome, openAccountMenu, signUpAndLogIn } from "./helpers";

/*
 * Visitors land in the app (#460): a new one gets a guest workspace with sample content and lands
 * on Home, started from the browser; a browser that has signed in before goes to log in instead.
 */

test("a new visitor lands on Home in a guest workspace with sample content", async ({ page }) => {
  await page.goto("/");
  await expectHome(page);
  await expect(page).toHaveURL(/\/$/);
  // The sample: tasks around today in two projects, a note, and events.
  await expect(page.getByRole("link", { name: "Write the launch post" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Fix the signup form" }).first()).toBeVisible();

  // None of it counts against the guest's own.
  const profile = page.getByRole("region", { name: "Guest workspace" });
  if (!(await profile.isVisible())) await page.getByRole("button", { name: /^Open navigation/ }).click();
  await expect(profile.getByText("5 left")).toBeVisible();
  await expect(profile.getByText("2 left")).toBeVisible();
});

test("a browser that has signed in before goes to log in", async ({ page }) => {
  await signUpAndLogIn(page, "Returning");
  await openAccountMenu(page);
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Email or username")).toBeVisible();
});

test("without scripts, / only shows the start page and makes no workspace", async ({ browser, baseURL }) => {
  // The uptime check and link previews read "/" this way.
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "AI Multi" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
    expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain("ai_multi_task_session");
  } finally {
    await context.close();
  }
});

test("with guest workspaces off, / offers sign-up and log-in instead of a log-in wall", async ({ page }) => {
  // The server shows this when GUEST_LOGIN_ENABLED is off, as on previews until it's turned on; the
  // browser falls back to it when the start route says guests were switched off meanwhile.
  await page.route("**/api/auth/guest/start", (route) => route.fulfill({ status: 403, json: { error: "guest-disabled" } }));
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign up free" })).toHaveAttribute("href", "/signup");
  await expect(page.getByRole("link", { name: "Log in", exact: true })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByText("Setting up your workspace…")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("link", { name: "Sign up free" }).click();
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
});

test("the start route refuses other sites, automated visitors and a second workspace", async ({ page, request }) => {
  // No browser headers saying it's this site: refused, so another site can't swap someone's session.
  const bare = await request.post("/api/auth/guest/start", { data: {} });
  expect(bare.status()).toBe(403);
  expect(await bare.json()).toEqual({ error: "cross-site" });
  expect((await request.post("/api/auth/guest/start", { data: {}, headers: { "sec-fetch-site": "cross-site" } })).status()).toBe(403);

  // Crawlers that run scripts get none either.
  const crawler = await request.post("/api/auth/guest/start", {
    data: {},
    headers: { "sec-fetch-site": "same-origin", "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
  });
  expect(crawler.status()).toBe(403);
  expect(await crawler.json()).toEqual({ error: "automated" });

  // Someone already signed in keeps their session.
  await page.goto("/");
  await expectHome(page);
  const again = await page.request.post("/api/auth/guest/start", { data: {}, headers: { "sec-fetch-site": "same-origin" } });
  expect(again.status()).toBe(409);
});
