import AxeBuilder from "@axe-core/playwright";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { resendTooSoonMessage } from "../../src/lib/email-confirmation-core";
import { confirmationLink, continueAsGuest, expectHome, queryDatabase, signUpAndLogIn } from "./helpers";

// #350: an account can't be used until the link sent to its email is opened,
// which proves the address is real. Until then it only reaches "Check your
// email", which resends the link the way professional apps do.

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const UTC_NOW = `(now() AT TIME ZONE 'utc')`;

async function isConfirmed(email: string) {
  const { rows } = await queryDatabase<{ emailVerifiedAt: Date | null }>('SELECT "emailVerifiedAt" FROM "User" WHERE email = $1', [email]);
  return rows[0]?.emailVerifiedAt != null;
}

async function linkCount(email: string) {
  const { rows } = await queryDatabase<{ count: string }>(
    `SELECT count(*) FROM "EmailVerificationToken" t JOIN "User" u ON u.id = t."userId" WHERE u.email = $1`,
    [email],
  );
  return Number(rows[0].count);
}

/** As if every link so far went out a few minutes ago, so the wait after the last one is over. */
async function backdateLinks(email: string) {
  await queryDatabase(
    `UPDATE "EmailVerificationToken" SET "createdAt" = "createdAt" - interval '5 minutes'
     WHERE "userId" = (SELECT id FROM "User" WHERE email = $1)`,
    [email],
  );
}

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.map((violation) => `${violation.id}: ${violation.help} -> ${violation.nodes[0]?.target.join(" ")}`);
}

const countdown = (page: Page) => page.getByText(/^You can resend in \d+:\d\d$/);

test("a new account waits on Check your email until its link is opened, then carries on", async ({ page }) => {
  const { email } = await signUpAndLogIn(page, "E2E waits", { confirmEmail: false });
  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByText(`We sent a link to ${email}. Open it to confirm your address and start using AI Multi.`)).toBeVisible();
  await expect(page.getByText("Can't find it? Check your spam or junk folder. The link works for 24 hours.")).toBeVisible();
  expect(await linkCount(email)).toBe(1);

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => localStorage.setItem("ai-multi-theme", value), theme);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    expect(await axeViolations(page), `Check your email (${theme})`).toEqual([]);
  }

  // Signed in, but nothing else opens: API routes answer as if signed out...
  for (const path of ["/api/projects", "/api/workspace-nav", "/api/project-invitations"]) {
    expect((await page.request.get(path)).status(), path).toBe(401);
  }
  // ...and pages come back here, keeping where they were going, whether they load on the server or in the browser.
  await page.goto("/");
  await expect(page).toHaveURL(/\/verify-email$/);
  for (const path of ["/today", "/trash"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/verify-email\\?next=${encodeURIComponent(path)}$`));
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  }

  // The link from the email, opened in this browser: confirmed, and straight on to the page it was going to.
  await page.goto(await confirmationLink(email, { next: "/today" }));
  await expect(page).toHaveURL(/\/today$/);
  expect(await isConfirmed(email)).toBe(true);
  expect((await page.request.get("/api/projects")).status()).toBe(200);
  // The page has nothing left to do.
  await page.goto("/verify-email?next=%2Fnotes");
  await expect(page).toHaveURL(/\/notes$/);
});

test("logging in before confirming leads to Check your email, and only with the right password", async ({ page }) => {
  const { email, username, password } = await signUpAndLogIn(page, "E2E login first", { confirmEmail: false });
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login\?error=logged-out$/);

  // A wrong password gets the usual answer: nothing about the account.
  await page.getByLabel("Email or username").fill(username);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Incorrect email, username or password.")).toBeVisible();

  await page.goto("/login?next=%2Fnotes");
  await page.getByLabel("Email or username").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/verify-email\?next=%2Fnotes$/);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  // The link has expired: the page offers a new one.
  await queryDatabase(
    `UPDATE "EmailVerificationToken" SET "createdAt" = ${UTC_NOW} - interval '25 hours', "expiresAt" = ${UTC_NOW} - interval '1 hour'
     WHERE "userId" = (SELECT id FROM "User" WHERE email = $1)`,
    [email],
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Confirm your email" })).toBeVisible();
  await expect(page.getByText(`To start using AI Multi, confirm that ${email} is your address.`)).toBeVisible();
  await page.getByRole("button", { name: "Send link" }).click();
  // The e2e server sends no email; production says "We sent a new link to …".
  await expect(page.getByText("Email sending is not configured.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(countdown(page)).toBeVisible();
  expect(await linkCount(email)).toBe(2);
});

test("Resend waits a minute after each email, survives a reload, and stops at 5 emails an hour", async ({ page }) => {
  test.setTimeout(180_000);
  // The hourly count is a sliding window over clock hours: emails split across the turn of an
  // hour count a little less. Start well clear of it, so the sixth is always the one refused.
  const toNextHour = 3_600_000 - (Date.now() % 3_600_000);
  if (toNextHour < 90_000) await page.waitForTimeout(toNextHour + 1_000);

  const { email } = await signUpAndLogIn(page, "E2E resend", { confirmEmail: false });
  const resend = page.getByRole("button", { name: "Resend email" });

  // Sign-up just sent one, so the countdown runs from the start, and a reload doesn't reset it.
  await expect(countdown(page)).toBeVisible();
  await page.reload();
  await expect(countdown(page)).toBeVisible();
  // It keeps focus while it waits (aria-disabled), and pressing it does nothing.
  await expect(resend).toBeDisabled();
  await resend.click({ force: true });
  expect(await linkCount(email)).toBe(1);

  // The server holds to the same wait, whatever the page does.
  const early = await page.request.post("/api/auth/verify-email", { data: {} });
  expect(early.status()).toBe(429);
  const retry = Number(early.headers()["retry-after"]);
  expect(retry).toBeGreaterThan(0);
  expect(retry).toBeLessThanOrEqual(60);
  expect((await early.json()).error).toBe(resendTooSoonMessage(retry));

  // Each time the minute is up, one more goes out: 4 more make 5 in the hour, with the sign-up's.
  for (let sent = 2; sent <= 5; sent += 1) {
    await backdateLinks(email);
    await page.reload();
    await expect(countdown(page)).toHaveCount(0);
    await expect(resend).toBeEnabled();
    await resend.click();
    await expect(page.getByText("Email sending is not configured.")).toBeVisible();
    await expect(countdown(page)).toBeVisible();
    expect(await linkCount(email), `email ${sent}`).toBe(sent);
  }

  // The sixth in an hour is refused, saying when to try again.
  await backdateLinks(email);
  await page.reload();
  await resend.click();
  await expect(page.getByText(/^That's the most confirmation emails we can send for now\. Try again in \d+ minutes?\.$/)).toBeVisible();
  await expect(countdown(page)).toBeVisible();
  expect(await linkCount(email)).toBe(5);
});

test("a mistyped address can be changed, and links sent to the old one stop working", async ({ page, browser }) => {
  const other = await browser.newContext();
  const existing = await signUpAndLogIn(await other.newPage(), "E2E has the address");
  await other.close();

  const { email, username } = await signUpAndLogIn(page, "E2E typo", { confirmEmail: false });
  const oldLink = await confirmationLink(email);

  await page.getByRole("button", { name: "Change it" }).click();
  const field = page.getByLabel("New email address");
  await expect(field).toBeFocused();
  for (const [typed, message] of [
    [existing.email, "An account with that email already exists."],
    [email.toUpperCase(), "That's the address we sent the link to. If it hasn't arrived, use Resend email."],
  ]) {
    await field.fill(typed);
    await page.getByRole("button", { name: "Change address" }).click();
    await expect(page.getByText(message)).toBeVisible();
  }

  // The right one: no need to wait for the countdown, since it goes somewhere new.
  const fixed = `e2e-fixed-${randomUUID().slice(0, 8)}@example.test`;
  await expect(countdown(page)).toBeVisible();
  await field.fill(fixed);
  await page.getByRole("button", { name: "Change address" }).click();
  await expect(page.getByText(`We sent a link to ${fixed}.`)).toBeVisible();
  await expect(field).toHaveCount(0);
  const saved = await queryDatabase<{ email: string; username: string }>(`SELECT email, username FROM "User" WHERE username = $1`, [username]);
  expect(saved.rows[0]?.email).toBe(fixed);
  expect(await linkCount(fixed)).toBe(1);

  // Whoever has the old address can't confirm the account with it any more.
  await page.goto(oldLink);
  await expect(page).toHaveURL(/\/verify-email\?status=invalid$/);
  await expect(page.getByText("That link has expired or a newer one replaced it. Use the newest email, or send a new link.")).toBeVisible();
  expect(await isConfirmed(fixed)).toBe(false);

  await page.goto(await confirmationLink(fixed));
  await expectHome(page);
});

test("a link opened in another browser confirms the email, and the waiting page moves on when looked at again", async ({ page, browser }) => {
  await page.clock.install();
  const { email, password } = await signUpAndLogIn(page, "E2E other browser", { confirmEmail: false });
  const link = await confirmationLink(email);

  const phone = await browser.newPage();
  try {
    await phone.goto(link);
    await expect(phone).toHaveURL(/\/verify-email\?status=confirmed$/);
    await expect(phone.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
    // An email scanner may have opened it first: a second opening says the same.
    await phone.goto(link);
    await expect(phone.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
    await phone.getByRole("link", { name: "Log in" }).click();
    await phone.getByLabel("Email or username").fill(email);
    await phone.getByLabel("Password").fill(password);
    await phone.getByRole("button", { name: "Log in" }).click();
    await expectHome(phone);
  } finally {
    await phone.close();
  }

  // Back at the computer a while later: the page checks once, and carries on into the app.
  await page.clock.fastForward(15_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expectHome(page);
});

test("a password reset link confirms the email too", async ({ page, browser }) => {
  const { email } = await signUpAndLogIn(page, "E2E reset confirms", { confirmEmail: false });
  const resetToken = randomBytes(32).toString("base64url");
  await queryDatabase(
    `INSERT INTO "PasswordResetToken" (id, "userId", "tokenHash", "expiresAt")
     SELECT $1, id, $2, ${UTC_NOW} + interval '1 hour' FROM "User" WHERE email = $3`,
    [`e2e-${randomUUID()}`, sha256(resetToken), email],
  );

  const visitor = await browser.newPage();
  try {
    await visitor.goto(`/reset-password?token=${encodeURIComponent(resetToken)}`);
    const newPassword = `e2e-${randomUUID()}`;
    await visitor.getByLabel("New password", { exact: true }).fill(newPassword);
    await visitor.getByLabel("Confirm new password").fill(newPassword);
    await visitor.getByRole("button", { name: "Reset password" }).click();
    await expect(visitor).toHaveURL(/\/login\?error=reset/);
    expect(await isConfirmed(email)).toBe(true);

    await visitor.getByLabel("Email or username").fill(email);
    await visitor.getByLabel("Password").fill(newPassword);
    await visitor.getByRole("button", { name: "Log in" }).click();
    await expectHome(visitor);
  } finally {
    await visitor.close();
  }
});

test("guest workspaces have no email to confirm", async ({ page }) => {
  await continueAsGuest(page);
  await page.goto("/today");
  await expect(page).toHaveURL(/\/today$/);
  expect((await page.request.post("/api/auth/verify-email", { data: {} })).status()).toBe(400);
});
