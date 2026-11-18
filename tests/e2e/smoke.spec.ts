import { expect, test } from "@playwright/test";

// @smoke tests also run against Vercel previews, which share the production
// database. Keep them read-only: no sign-ups, no sign-ins, no writes.

// With scripts on, "/" starts a guest workspace (#460), a write; with them off it only shows the start page.
test.describe("the start page", () => {
  test.use({ javaScriptEnabled: false });

  test("the start page loads", { tag: "@smoke" }, async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "AI Multi" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
    // Google's sign-in review looks for the Privacy Policy on the home page (#358).
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  });
});

test("login page loads", { tag: "@smoke" }, async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);
  await expect(page.getByLabel("Email or username")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("signed-out visitors are sent to the login page", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login\?next=%2Fprojects$/);
});

test("the API refuses signed-out requests", { tag: "@smoke" }, async ({ request }) => {
  for (const path of ["/api/projects", "/api/tasks", "/api/notes", "/api/search?q=x"]) {
    const response = await request.get(path);
    expect.soft(response.status(), path).toBe(401);
  }
});
