import { expect, test, type Page } from "@playwright/test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { continueAsGuest, expectHome, queryDatabase, signUpAndLogIn } from "./helpers";

// #351: log in with a username or an email, with forms that browsers' password
// managers know how to save and fill in.

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function logOut(page: Page) {
  await page.request.post("/api/auth/logout", { maxRedirects: 0 });
}

async function logIn(page: Page, login: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill(login);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

test("an account logs in with its username or its email, in any case", async ({ page }) => {
  const { username, email, password } = await signUpAndLogIn(page, "E2E username");

  for (const login of [username.toUpperCase(), ` ${username} `, email.toUpperCase()]) {
    await logOut(page);
    await logIn(page, login, password);
    await expectHome(page);
  }

  // A login page left open from before usernames sends "email" instead of "login".
  await logOut(page);
  const oldForm = await page.request.post("/api/auth/login", { form: { email, password, next: "/" }, maxRedirects: 0 });
  expect(oldForm.status()).toBe(303);
  expect(new URL(oldForm.headers().location).pathname).toBe("/");
});

test("a failed login doesn't say which part was wrong, and keeps what was typed", async ({ page }) => {
  const { username, password } = await signUpAndLogIn(page, "E2E wrong password");
  await logOut(page);

  for (const [login, attempt] of [
    [username, "wrong-password"],
    [`nobody_${randomUUID().slice(0, 8)}`, password],
  ]) {
    await logIn(page, login, attempt);
    await expect(page).toHaveURL(/\/login\?error=invalid/);
    await expect(page.getByText("Incorrect email, username or password.")).toBeVisible();
    await expect(page.getByLabel("Email or username")).toHaveValue(login);
    await expect(page.getByLabel("Password")).toHaveValue("");
    // Kept in a short-lived cookie, never in the address.
    expect(page.url()).not.toContain(login);
  }

  await logIn(page, username, password);
  await expectHome(page);
  await logOut(page);
  await page.goto("/login");
  await expect(page.getByLabel("Email or username")).toHaveValue("");
});

test("sign-up refuses a taken or reserved username and keeps the rest of the form", async ({ page, browser }) => {
  const other = await browser.newContext();
  const existing = await signUpAndLogIn(await other.newPage(), "E2E taken");
  await other.close();

  const email = `e2e-${randomUUID().slice(0, 8)}@example.test`;
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("New person");
  await page.getByLabel("Email").fill(email);

  for (const [username, message] of [
    [existing.username.toUpperCase(), "That username is taken. Try another one."],
    ["Admin", "That username is reserved. Try another one."],
  ]) {
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill("a-long-password");
    await page.getByLabel("Confirm password").fill("a-long-password");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText(message)).toBeVisible();
    const field = page.getByLabel("Username");
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveValue(username);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("New person");
    await expect(page.getByLabel("Email")).toHaveValue(email);
    // Passwords never come back from the server.
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  }

  // The browser itself stops a username that breaks the rules.
  await page.getByLabel("Username").fill("no spaces");
  expect(await page.getByLabel("Username").evaluate((input: HTMLInputElement) => input.validity.patternMismatch)).toBe(true);

  // A good one is saved in lowercase.
  const username = `New_${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill("a-long-password");
  await page.getByLabel("Confirm password").fill("a-long-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const saved = await queryDatabase<{ username: string }>(`SELECT username FROM "User" WHERE email = $1`, [email]);
  expect(saved.rows[0]?.username).toBe(username.toLowerCase());
});

test("an account without a username adds one on the Account page, then logs in with it", async ({ page, browser }) => {
  const { email, password } = await signUpAndLogIn(page, "E2E add username");
  // Like the accounts made before usernames existed.
  await queryDatabase(`UPDATE "User" SET username = NULL WHERE email = $1`, [email]);
  const other = await browser.newContext();
  const someoneElse = await signUpAndLogIn(await other.newPage(), "E2E someone else");
  await other.close();

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Account settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const field = page.getByLabel("Username");
  await expect(field).toHaveValue("");

  await field.fill(someoneElse.username);
  await page.getByRole("button", { name: "Save username" }).click();
  await expect(page.getByText("That username is taken. Try another one.")).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");

  const username = `e2e_new_${randomUUID().slice(0, 8)}`;
  await field.fill(username.toUpperCase());
  await page.getByRole("button", { name: "Save username" }).click();
  await expect(page.getByText("Username saved")).toBeVisible();
  await expect(field).toHaveValue(username);
  await expect(page.getByRole("button", { name: "Change username" })).toBeDisabled();

  await logOut(page);
  await logIn(page, username, password);
  await expectHome(page);
});

test("guest workspaces have no username", async ({ page }) => {
  await continueAsGuest(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Log out" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Account settings" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.goto("/account");
  await expect(page.getByText("This is a guest workspace.")).toBeVisible();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  expect((await page.request.patch("/api/account", { data: { username: "guest_name" } })).status()).toBe(403);
});

test("the forms tell password managers which login to save and fill in", async ({ page, browser }) => {
  // Logging in: one field names the account, whether it holds an email or a username.
  await page.goto("/login");
  const login = page.getByLabel("Email or username");
  await expect(login).toHaveAttribute("type", "text");
  await expect(login).toHaveAttribute("autocomplete", "username");
  await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");

  // Signing up: the email is the login that gets saved, with a new password.
  await page.goto("/signup");
  await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "username");
  await expect(page.getByLabel("Username")).toHaveAttribute("autocomplete", "off");
  for (const label of ["Password", "Confirm password"]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute("autocomplete", "new-password");
  }

  // Resetting: the page names the account, so its saved password is the one updated.
  const other = await browser.newContext();
  const { email } = await signUpAndLogIn(await other.newPage(), "E2E reset markup");
  await other.close();
  const resetToken = randomBytes(32).toString("base64url");
  await queryDatabase(
    `INSERT INTO "PasswordResetToken" (id, "userId", "tokenHash", "expiresAt")
     SELECT $1, id, $2, now() AT TIME ZONE 'utc' + interval '1 hour' FROM "User" WHERE email = $3`,
    [`e2e-${randomUUID()}`, sha256(resetToken), email],
  );
  await page.goto(`/reset-password?token=${encodeURIComponent(resetToken)}`);
  const account = page.locator('input[autocomplete="username"]');
  await expect(account).toHaveValue(email);
  await expect(account).toBeHidden();
  for (const label of ["New password", "Confirm new password"]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute("autocomplete", "new-password");
  }

  // A link that doesn't work says so before anything is typed.
  await page.goto(`/reset-password?token=${randomBytes(32).toString("base64url")}`);
  await expect(page.getByText("This reset link is invalid or expired.")).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
});
