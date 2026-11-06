import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse, type BrowserContext, type Page } from "@playwright/test";
import { expectHome, queryDatabase, signUpAndLogIn } from "./helpers";
import { googleStubUrl } from "./google-stub";

// #356: "Continue with Google" signs in, and the first time it creates the
// account. Google's endpoints are played by tests/e2e/google-stub.ts.

type GoogleAccount = { sub: string; email: string; name?: string; hd?: string } & Record<string, unknown>;

const googleAccount = (overrides: Partial<GoogleAccount> = {}): GoogleAccount => {
  const id = randomUUID().slice(0, 8);
  return { sub: `1${Date.now()}${Math.floor(Math.random() * 1e6)}`, email: `e2e.google.${id}@gmail.com`, name: `E2E Google ${id}`, ...overrides };
};

/** Picks the account the stand-in's chooser returns, or makes it answer with an error such as access_denied. */
async function atGoogle(context: BrowserContext, choice: { account: GoogleAccount } | { error: string }) {
  await context.clearCookies({ domain: "127.0.0.1" });
  const [name, value] = "account" in choice ? ["stub_account", JSON.stringify(choice.account)] : ["stub_error", choice.error];
  await context.addCookies([{ name, value: encodeURIComponent(value), url: googleStubUrl() }]);
}

async function continueWithGoogle(page: Page, from = "/login") {
  await page.goto(from);
  await page.getByRole("button", { name: "Continue with Google" }).click();
}

async function userFor(email: string) {
  const { rows } = await queryDatabase<{ id: string; name: string | null; passwordHash: string | null; emailVerifiedAt: Date | null; username: string | null }>(
    `SELECT id, name, "passwordHash", "emailVerifiedAt", username FROM "User" WHERE email = $1`,
    [email],
  );
  return rows[0];
}

async function googleLinks(userId: string) {
  const { rows } = await queryDatabase<{ providerAccountId: string; email: string }>(
    `SELECT "providerAccountId", email FROM "OAuthAccount" WHERE provider = 'google' AND "userId" = $1`,
    [userId],
  );
  return rows;
}

async function logOut(page: Page) {
  await page.request.post("/api/auth/logout", { maxRedirects: 0 });
}

/** Where a redirect points, as a path and query. */
function redirectTarget(response: APIResponse) {
  const location = new URL(response.headers().location, "http://local.invalid");
  return `${location.pathname}${location.search}`;
}

test("the first Continue with Google creates the account; later ones log in to it by Google's id", async ({ page, context }) => {
  const account = googleAccount();
  await atGoogle(context, { account });
  await continueWithGoogle(page, "/signup");
  await expectHome(page);

  // Stored as a sign-up: confirmed by Google, no password, linked by Google's id.
  const user = await userFor(account.email);
  expect(user).toMatchObject({ name: account.name, passwordHash: null, username: null });
  expect(user.emailVerifiedAt).not.toBeNull();
  expect(await googleLinks(user.id)).toEqual([{ providerAccountId: account.sub, email: account.email }]);

  // Back later, even after the Google address changed: the same account, no second one.
  await logOut(page);
  const renamed = { ...account, email: `e2e.renamed.${randomUUID().slice(0, 8)}@gmail.com` };
  await atGoogle(context, { account: renamed });
  await continueWithGoogle(page);
  await expectHome(page);
  expect(await userFor(renamed.email)).toBeUndefined();
  expect(await googleLinks(user.id)).toEqual([{ providerAccountId: account.sub, email: renamed.email }]);
});

test("Google sign-in continues to the page it was headed for", async ({ page, context }) => {
  await atGoogle(context, { account: googleAccount() });
  await page.goto("/notes");
  await expect(page).toHaveURL(/\/login\?next=%2Fnotes$/);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL(/\/notes$/);
});

test("an account with the same address is linked only when Google vouches for it", async ({ page, context, browser }) => {
  // A Gmail address: Google vouches for it, so its account opens, and the password still works too.
  const other = await browser.newContext();
  const gmailUser = await signUpAndLogIn(await other.newPage(), "E2E has Gmail", { email: `e2e.has.${randomUUID().slice(0, 8)}@gmail.com` });
  await other.close();
  await atGoogle(context, { account: googleAccount({ email: gmailUser.email }) });
  await continueWithGoogle(page);
  await expectHome(page);
  const linked = await userFor(gmailUser.email);
  expect(await googleLinks(linked.id)).toHaveLength(1);
  expect(linked.passwordHash).not.toBeNull();

  // A Google Workspace address (an hd claim) counts too.
  await logOut(page);
  const workspace = await browser.newContext();
  const workspaceUser = await signUpAndLogIn(await workspace.newPage(), "E2E Workspace", { email: `e2e.${randomUUID().slice(0, 8)}@company.test` });
  await workspace.close();
  await atGoogle(context, { account: googleAccount({ email: workspaceUser.email, hd: "company.test" }) });
  await continueWithGoogle(page);
  await expectHome(page);

  // Any other address: Google checked it once, but someone else may own it now. The password it is.
  await logOut(page);
  const plain = await browser.newContext();
  const plainUser = await signUpAndLogIn(await plain.newPage(), "E2E plain address");
  await plain.close();
  await atGoogle(context, { account: googleAccount({ email: plainUser.email }) });
  await continueWithGoogle(page);
  await expect(page).toHaveURL(/\/login\?error=google-account-exists$/);
  await expect(page.getByText("An account with this email already exists. Log in with your email or username and password.")).toBeVisible();
  expect(await googleLinks((await userFor(plainUser.email)).id)).toHaveLength(0);
});

test("someone who signed up with another person's Gmail address loses the account to its owner", async ({ page, context, browser }) => {
  // They never confirmed the address, because they can't: it isn't theirs.
  const squatter = await browser.newContext();
  const squatterPage = await squatter.newPage();
  const email = `e2e.owner.${randomUUID().slice(0, 8)}@gmail.com`;
  const taken = await signUpAndLogIn(squatterPage, "E2E squatter", { confirmEmail: false, email });

  // The owner uses Google with it: they get the account, confirmed.
  await atGoogle(context, { account: googleAccount({ email }) });
  await continueWithGoogle(page);
  await expectHome(page);
  const user = await userFor(email);
  expect(user.emailVerifiedAt).not.toBeNull();
  expect(user.passwordHash).toBeNull();

  // The squatter's password and session are gone.
  expect((await squatterPage.request.post("/api/auth/verify-email", { data: {} })).status()).toBe(401);
  await squatterPage.goto("/login");
  await squatterPage.getByLabel("Email or username").fill(taken.username);
  await squatterPage.getByLabel("Password").fill(taken.password);
  await squatterPage.getByRole("button", { name: "Log in" }).click();
  await expect(squatterPage.getByText("Incorrect email, username or password.")).toBeVisible();
  await squatter.close();
});

test("problems at Google or with its answer come back to the login page with a message", async ({ page, context }) => {
  const cases: { at: Parameters<typeof atGoogle>[1]; message: string }[] = [
    { at: { error: "access_denied" }, message: "Google sign-in was cancelled." },
    { at: { account: googleAccount({ email_verified: false }) }, message: "Google hasn't confirmed that email address, so it can't be used to sign in." },
    // ID tokens that aren't for this sign-in, this app, from Google, or still valid.
    { at: { account: googleAccount({ nonce: "someone-elses-sign-in" }) }, message: "Google sign-in didn't work. Try again." },
    { at: { account: googleAccount({ aud: "another-app.apps.googleusercontent.com" }) }, message: "Google sign-in didn't work. Try again." },
    { at: { account: googleAccount({ iss: "https://accounts.example" }) }, message: "Google sign-in didn't work. Try again." },
    { at: { account: googleAccount({ exp: Math.floor(Date.now() / 1000) - 60 }) }, message: "Google sign-in didn't work. Try again." },
  ];
  for (const { at, message } of cases) {
    await atGoogle(context, at);
    await continueWithGoogle(page, "/login?next=%2Ftasks");
    await expect(page).toHaveURL(/\/login\?error=google-[a-z-]+&next=%2Ftasks$/);
    await expect(page.getByText(message)).toBeVisible();
  }
  expect((await page.request.get("/api/projects")).status()).toBe(401);
});

test("the callback finishes only a sign-in this browser started", async ({ page, context }) => {
  // Someone else's code and state, opened here (login CSRF): no cookie from this browser, so no sign-in.
  const forged = await page.request.get("/api/auth/google/callback?code=stolen&state=theirs", { maxRedirects: 0 });
  expect(forged.status()).toBe(303);
  expect(redirectTarget(forged)).toBe("/login?error=google-failed");

  // A real start, then a different state coming back.
  await atGoogle(context, { account: googleAccount() });
  const start = await page.request.post("/api/auth/google", { form: { next: "/" }, maxRedirects: 0 });
  const toGoogle = new URL(start.headers().location);
  expect(toGoogle.origin).toBe(googleStubUrl());
  expect(toGoogle.searchParams.get("code_challenge_method")).toBe("S256");
  const wrongState = await page.request.get(`/api/auth/google/callback?code=x&state=${toGoogle.searchParams.get("state")}x`, { maxRedirects: 0 });
  expect(redirectTarget(wrongState)).toBe("/login?error=google-failed");
  // The cookie is spent with that try, so the right state afterwards is refused too.
  const replay = await page.request.get(`/api/auth/google/callback?code=x&state=${toGoogle.searchParams.get("state")}`, { maxRedirects: 0 });
  expect(redirectTarget(replay)).toBe("/login?error=google-failed");
  expect((await page.request.get("/api/projects")).status()).toBe(401);
});
