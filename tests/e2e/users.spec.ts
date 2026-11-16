import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest, expectHome, openAccountMenu, queryDatabase, signUpAndLogIn, signUpAsAppAdmin } from "./helpers";

// The owner-only Users page lists every account with dates and counts, never what people wrote. Like
// the usage page (#286), only the accounts in ADMIN_EMAILS open it (the e2e server lists APP_ADMIN_EMAIL);
// everyone else gets the same 404 as for a page that doesn't exist.

// Prisma's timestamps are UTC "timestamp without time zone" columns.
const UTC_NOW = `(now() AT TIME ZONE 'utc')`;

async function expectNotFound(page: Page) {
  await expect(page.getByText("This page could not be found.").filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Users" })).toHaveCount(0);
}

async function userId(email: string) {
  const { rows } = await queryDatabase<{ id: string }>(`SELECT id FROM "User" WHERE email = $1`, [email]);
  return rows[0].id;
}

test("an account that isn't an admin gets a 404 and no menu item", async ({ page }) => {
  const { email } = await signUpAndLogIn(page, "Not a users admin");

  await openAccountMenu(page);
  await expect(page.getByRole("menuitem", { name: "Account settings" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Users" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.goto("/users");
  await expectNotFound(page);
  // Not even their own page.
  await page.goto(`/users/${await userId(email)}`);
  await expectNotFound(page);
});

test("a guest gets a 404 too", async ({ page }) => {
  await continueAsGuest(page);
  await page.goto("/users");
  await expectNotFound(page);
});

test("signed out, it goes to log in like any other address", async ({ page }) => {
  await page.goto("/users");
  await expect(page).toHaveURL(/\/login\?next=%2Fusers$/);
});

test("an admin sees each account's sign-ins, last activity and what it made, never its titles", async ({ page, browser }) => {
  // Someone signs up, makes a task, then signs in again from another browser.
  const visitorContext = await browser.newContext();
  const visitorPage = await visitorContext.newPage();
  const visitor = await signUpAndLogIn(visitorPage, "Users visitor");
  const privateTitle = `Private title ${randomUUID().slice(0, 8)}`;
  expect((await visitorPage.request.post("/api/tasks", { data: { title: privateTitle } })).ok()).toBe(true);
  const laterContext = await browser.newContext();
  const laterPage = await laterContext.newPage();
  await laterPage.goto("/login");
  await laterPage.getByLabel("Email or username").fill(visitor.username);
  await laterPage.getByLabel("Password").fill(visitor.password);
  await laterPage.getByRole("button", { name: "Log in" }).click();
  await expectHome(laterPage);
  await Promise.all([visitorContext.close(), laterContext.close()]);

  await signUpAsAppAdmin(page);
  await openAccountMenu(page);
  await page.getByRole("menuitem", { name: "Users" }).click();
  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByRole("heading", { level: 1, name: "Users" }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Summary" }).getByText("Accounts", { exact: true })).toBeVisible();

  // Their row: a table row on computers, a card on phones.
  const row = page.locator("tr, li").filter({ hasText: visitor.email }).filter({ visible: true });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(`@${visitor.username}`);
  await expect(row.getByText("New", { exact: true })).toBeVisible();
  await expect(row.getByText("Not confirmed", { exact: true })).toHaveCount(0);
  // The sign-up and the later log in.
  await expect(row.getByText("2", { exact: true })).toBeVisible();
  await expect(row).toContainText("1 task");
  await expect(row).toContainText(/Today, \d{1,2}:\d{2} (AM|PM)/);
  await expect(page.getByText(privateTitle)).toHaveCount(0);

  await row.getByRole("link", { name: visitor.name }).click();
  await expect(page).toHaveURL(/\/users\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: visitor.name }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Email Users" })).toHaveAttribute("href", `mailto:${visitor.email}`);

  const account = page.getByRole("region", { name: "Account" });
  await expect(account.getByText("Password", { exact: true })).toBeVisible();
  // Neither browser logged out.
  await expect(account.getByText("2 devices", { exact: true })).toBeVisible();

  const history = page.getByRole("region", { name: "Sign-in history" });
  await expect(history.getByRole("listitem")).toHaveCount(2);
  await expect(history.getByRole("listitem").first()).toContainText("Password");
  await expect(history.getByRole("listitem").last()).toContainText("Signed up with a password");
  // The kind of browser, never the whole user agent. The local server sends no country.
  await expect(history.getByText(/^Chrome on (Windows|Linux|macOS|Android|iPhone)$/)).toHaveCount(2);

  await expect(page.getByRole("region", { name: "What they made" })).toContainText("Created 1 task");
  await expect(page.getByRole("region", { name: "Recent actions" }).getByText("Created a task")).toBeVisible();
  await expect(page.getByText(privateTitle)).toHaveCount(0);

  // An id that isn't an account is a 404 too.
  await page.goto("/users/not-an-account");
  await expectNotFound(page);
});

test("using the app moves the last-active date, at most once an hour", async ({ page }) => {
  const { email } = await signUpAndLogIn(page, "Active visitor");
  const freshness = async () =>
    (
      await queryDatabase<{ minutes: number }>(
        `SELECT floor(extract(epoch FROM ${UTC_NOW} - "lastActiveAt") / 60)::int AS minutes FROM "User" WHERE email = $1`,
        [email],
      )
    ).rows[0].minutes;

  // Two hours without a request: the next one records it.
  await queryDatabase(`UPDATE "User" SET "lastActiveAt" = ${UTC_NOW} - interval '2 hours' WHERE email = $1`, [email]);
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" }).filter({ visible: true })).toBeVisible();
  expect(await freshness()).toBeLessThan(5);

  // Half an hour ago is recent enough: no write.
  await queryDatabase(`UPDATE "User" SET "lastActiveAt" = ${UTC_NOW} - interval '30 minutes' WHERE email = $1`, [email]);
  await page.goto("/notes");
  await expect(page.getByRole("heading", { level: 1, name: "Notes" }).filter({ visible: true })).toBeVisible();
  expect(await freshness()).toBeGreaterThanOrEqual(29);
});
