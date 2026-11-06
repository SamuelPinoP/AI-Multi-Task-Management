import "dotenv/config";
import { expect, type Page } from "@playwright/test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";

export function uniqueName(prefix: string) {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

/** Waits for the signed-in home screen ("Good morning", "Good afternoon", ...). */
export async function expectHome(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
}

/** Starts a guest workspace (local server only: guest login is off in production). */
export async function continueAsGuest(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /continue as guest/i }).click();
  await expectHome(page);
}

/**
 * Follows a navigation link by its exact name: from the sidebar on wide
 * screens, or from the bottom tabs or the menu sheet on a phone.
 */
export async function openSection(page: Page, name: string) {
  const link = page.getByRole("link", { name, exact: true });
  if (!(await link.first().isVisible())) {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }
  await link.first().click();
}

/** Runs one query against the test database (the server's DATABASE_URL). */
export async function queryDatabase<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values: unknown[] = []) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    return await pool.query<T>(text, values);
  } finally {
    await pool.end();
  }
}

/**
 * A link like the one in the confirmation email (#130), for the account with
 * `email`. Only its SHA-256 is stored, so tests make their own. `sentMinutesAgo`
 * dates it back, as if it went out earlier.
 */
export async function confirmationLink(
  email: string,
  { expiresInHours = 24, next, sentMinutesAgo = 0 }: { expiresInHours?: number; next?: string; sentMinutesAgo?: number } = {},
) {
  const token = randomBytes(32).toString("base64url");
  await queryDatabase(
    `INSERT INTO "EmailVerificationToken" (id, "userId", "tokenHash", "createdAt", "expiresAt")
     SELECT $1, id, $2, (now() AT TIME ZONE 'utc') - make_interval(mins => $3), (now() AT TIME ZONE 'utc') + make_interval(hours => $4)
     FROM "User" WHERE email = $5`,
    [`e2e-${randomUUID()}`, createHash("sha256").update(token).digest("hex"), sentMinutesAgo, expiresInHours, email],
  );
  const params = new URLSearchParams({ token });
  if (next) params.set("next", next);
  return `/api/auth/verify-email?${params}`;
}

/**
 * Signs up a throwaway account on the local server. Sign-up ends on "Check
 * your email" (#350); unless `confirmEmail` is false, the account's link is
 * then opened in the same browser, which signs it in, as a person would.
 */
export async function signUpAndLogIn(page: Page, label = "E2E user", { confirmEmail = true } = {}) {
  const id = randomUUID().slice(0, 8);
  const name = `${label} ${id}`;
  const username = `e2e_${id}`;
  const email = `e2e-${id}@example.test`;
  const password = `e2e-${randomUUID()}`;

  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  if (confirmEmail) {
    await page.goto(await confirmationLink(email));
    await expectHome(page);
  }

  return { name, username, email, password };
}
