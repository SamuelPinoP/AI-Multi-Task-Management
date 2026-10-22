import AxeBuilder from "@axe-core/playwright";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { continueAsGuest, queryDatabase, signUpAndLogIn, uniqueName } from "./helpers";

// Email verification (#130): invitations are matched by email, so only someone
// who proved they own the address may see or answer them.

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const UTC_NOW = `(now() AT TIME ZONE 'utc')`;

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.url()} -> ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

/** A link like the one in the confirmation email. Only its SHA-256 is stored, so the test makes its own. */
async function confirmationLink(email: string, expiresInHours = 24) {
  const token = randomBytes(32).toString("base64url");
  await queryDatabase(
    `INSERT INTO "EmailVerificationToken" (id, "userId", "tokenHash", "expiresAt")
     SELECT $1, id, $2, ${UTC_NOW} + make_interval(hours => $3) FROM "User" WHERE email = $4`,
    [`e2e-${randomUUID()}`, sha256(token), expiresInHours, email],
  );
  return `/api/auth/verify-email?token=${encodeURIComponent(token)}`;
}

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

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.map((violation) => `${violation.id}: ${violation.help} -> ${violation.nodes[0]?.target.join(" ")}`);
}

test("invitations wait until the invited person confirms their email", async ({ browser }) => {
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext();
  const inviteeContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const page = await inviteeContext.newPage();
  const owner = ownerContext.request;
  const invitee = inviteeContext.request;

  try {
    await signUpAndLogIn(ownerPage, "E2E verify owner");
    const { email } = await signUpAndLogIn(page, "E2E unconfirmed", { confirmEmail: false });

    // Signing up sent a confirmation link, and the app asks for it everywhere.
    expect(await linkCount(email)).toBe(1);
    const banner = page.getByText(`Confirm your email address, ${email}, to see and accept project invitations.`);
    await expect(banner).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => localStorage.setItem("ai-multi-theme", value), theme);
      await page.reload();
      await page.waitForLoadState("networkidle");
      expect(await axeViolations(page), `home with the banner (${theme})`).toEqual([]);
    }

    const projectName = uniqueName("Verify project");
    const project = await json<{ id: string }>(await owner.post("/api/projects", { data: { name: projectName } }));
    await json(await owner.post(`/api/projects/${project.id}/invitations`, { data: { email, role: "EDITOR" } }));
    const [invitation] = await json<{ id: string }[]>(await owner.get(`/api/projects/${project.id}/invitations`));

    // Until then the invitation is hidden and can't be answered either way.
    expect(await json<unknown[]>(await invitee.get("/api/project-invitations"))).toEqual([]);
    for (const action of ["ACCEPT", "DECLINE"]) {
      const response = await invitee.patch(`/api/project-invitations/${invitation.id}`, { data: { action } });
      expect(response.status(), action).toBe(403);
      expect((await response.json()).error).toMatch(/^Confirm your email address/);
    }

    // Asking for another link sends one; the first still works until it expires.
    await page.getByRole("button", { name: "Email me a confirmation link" }).click();
    await expect(page.getByText("Email sending is not configured.")).toBeVisible();
    expect(await linkCount(email)).toBe(2);

    // An expired link does nothing.
    await page.goto(await confirmationLink(email, -1));
    await expect(page).toHaveURL(/\/verify-email\?status=invalid$/);
    await expect(page.getByRole("heading", { name: "This link didn't work" })).toBeVisible();
    expect(await isConfirmed(email)).toBe(false);

    // A live link confirms the email and retires the other links.
    const link = await confirmationLink(email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/verify-email\?status=confirmed$/);
    await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
    expect(await isConfirmed(email)).toBe(true);
    expect(await linkCount(email)).toBe(0);
    // Opening it again (an email scanner may have opened it first) still says it's confirmed.
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
    expect((await invitee.post("/api/auth/verify-email")).status()).toBe(409);

    // Now the invitation shows up and can be accepted; the banner is gone.
    await page.getByRole("link", { name: "Go to your projects" }).click();
    const invitations = page.getByRole("region", { name: "You're invited to a project" });
    await invitations.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByText(`You joined ${projectName}`)).toBeVisible();
    await expect(banner).toHaveCount(0);
  } finally {
    await ownerContext.close();
    await inviteeContext.close();
  }
});

test("the confirmation link works signed out, and a password reset link confirms the email too", async ({ browser, page }) => {
  const first = await signUpAndLogIn(page, "E2E link signed out", { confirmEmail: false });
  const visitor = await browser.newPage();
  await visitor.goto(await confirmationLink(first.email));
  await expect(visitor.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
  await expect(visitor.getByRole("link", { name: "Log in" })).toBeVisible();
  expect(await isConfirmed(first.email)).toBe(true);

  const secondPage = await browser.newPage();
  const second = await signUpAndLogIn(secondPage, "E2E reset confirms", { confirmEmail: false });
  await secondPage.close();
  const resetToken = randomBytes(32).toString("base64url");
  await queryDatabase(
    `INSERT INTO "PasswordResetToken" (id, "userId", "tokenHash", "expiresAt")
     SELECT $1, id, $2, ${UTC_NOW} + interval '1 hour' FROM "User" WHERE email = $3`,
    [`e2e-${randomUUID()}`, sha256(resetToken), second.email],
  );
  await visitor.goto(`/reset-password?token=${encodeURIComponent(resetToken)}`);
  const newPassword = `e2e-${randomUUID()}`;
  await visitor.getByLabel("New password", { exact: true }).fill(newPassword);
  await visitor.getByLabel("Confirm new password").fill(newPassword);
  await visitor.getByRole("button", { name: "Reset password" }).click();
  await expect(visitor).toHaveURL(/\/login\?error=reset/);
  expect(await isConfirmed(second.email)).toBe(true);
  await visitor.close();
});

test("guest workspaces have no email to confirm", async ({ page }) => {
  await continueAsGuest(page);
  await expect(page.getByText(/^Confirm your email/)).toHaveCount(0);
  expect((await page.request.post("/api/auth/verify-email")).status()).toBe(400);
});
