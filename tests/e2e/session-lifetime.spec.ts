import { createHash } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { continueAsGuest, expectHome, queryDatabase, signUpAndLogIn } from "./helpers";

// #354: a session stays signed in while it's used: it ends 30 days after its
// last use, and a year after logging in at the latest.

const SESSION_COOKIE = "ai_multi_task_session";
const DAY_SECONDS = 24 * 60 * 60;
// Prisma keeps UTC in "timestamp without time zone" columns.
const UTC_NOW = `(now() AT TIME ZONE 'utc')`;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function currentSession(context: BrowserContext) {
  const cookie = (await context.cookies()).find((item) => item.name === SESSION_COOKIE);
  expect(cookie, "session cookie").toBeTruthy();
  return { cookie: cookie!, tokenHash: sha256(cookie!.value) };
}

/** Days until the session ends, as the database has it, or null once it's gone. */
async function daysLeft(tokenHash: string) {
  const { rows } = await queryDatabase<{ days: string }>(
    `SELECT EXTRACT(EPOCH FROM ("expiresAt" - ${UTC_NOW})) / 86400 AS days FROM "Session" WHERE token = $1`,
    [tokenHash],
  );
  return rows.length ? Number(rows[0].days) : null;
}

async function setSession(tokenHash: string, assignments: string) {
  await queryDatabase(`UPDATE "Session" SET ${assignments} WHERE token = $1`, [tokenHash]);
}

test("using the app keeps a session going: 30 days after the last use, a year at most", async ({ page, context }) => {
  await signUpAndLogIn(page, "E2E session lifetime");
  const { cookie, tokenHash } = await currentSession(context);

  // The cookie lasts the whole year; the server decides when the session ends.
  const cookieDays = (cookie.expires - Date.now() / 1000) / DAY_SECONDS;
  expect(cookieDays).toBeGreaterThan(364.9);
  expect(cookieDays).toBeLessThanOrEqual(365);
  expect(await daysLeft(tokenHash)).toBeCloseTo(30, 1);

  // Last used 28 days ago: opening a page gives it 30 more days.
  await setSession(tokenHash, `"expiresAt" = ${UTC_NOW} + interval '2 days'`);
  await page.goto("/");
  await expectHome(page);
  expect(await daysLeft(tokenHash)).toBeCloseTo(30, 1);

  // So does a request from a page that's already open.
  await setSession(tokenHash, `"expiresAt" = ${UTC_NOW} + interval '3 days'`);
  expect((await page.request.get("/api/projects")).status()).toBe(200);
  expect(await daysLeft(tokenHash)).toBeCloseTo(30, 1);

  // Renewed less than a day ago: nothing is written.
  await setSession(tokenHash, `"expiresAt" = ${UTC_NOW} + interval '29 days 12 hours'`);
  await page.goto("/");
  await expectHome(page);
  expect(await daysLeft(tokenHash)).toBeCloseTo(29.5, 1);

  // Logged in 360 days ago: it only goes on until the year is up.
  await setSession(tokenHash, `"createdAt" = ${UTC_NOW} - interval '360 days', "expiresAt" = ${UTC_NOW} + interval '1 hour'`);
  await page.goto("/");
  await expectHome(page);
  expect(await daysLeft(tokenHash)).toBeCloseTo(5, 1);
});

test("an ended session sends you to log in, then back to the page you opened", async ({ page, context }) => {
  const { email, password } = await signUpAndLogIn(page, "E2E ended session");
  let { tokenHash } = await currentSession(context);

  // Unused for 30 days: the cookie is still there, but the session is over.
  await setSession(tokenHash, `"expiresAt" = ${UTC_NOW} - interval '1 minute'`);
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login\?next=%2Ftoday$/);
  // An ended session is deleted, not left behind.
  expect(await daysLeft(tokenHash)).toBeNull();

  await page.getByLabel("Email or username").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/today$/);

  // The same from a page that loads its data in the browser.
  ({ tokenHash } = await currentSession(context));
  await setSession(tokenHash, `"expiresAt" = ${UTC_NOW} - interval '1 minute'`);
  await page.goto("/trash");
  await expect(page).toHaveURL(/\/login\?next=%2Ftrash$/);

  // With no cookie at all, the address keeps its query too.
  await context.clearCookies();
  await page.goto("/events?view=agenda");
  await expect(page).toHaveURL(/\/login\?next=%2Fevents%3Fview%3Dagenda$/);
});

test("Log out of other devices ends every other session at once", async ({ page, browser }) => {
  const { email, password } = await signUpAndLogIn(page, "E2E other devices");
  const phone = await browser.newContext();
  try {
    const phonePage = await phone.newPage();
    await phonePage.goto("/login");
    await phonePage.getByLabel("Email or username").fill(email);
    await phonePage.getByLabel("Password").fill(password);
    await phonePage.getByRole("button", { name: "Log in" }).click();
    await expectHome(phonePage);

    await page.goto("/account");
    await expect(page.getByText("Signed in on 2 devices, including this one.")).toBeVisible();
    await page.getByRole("button", { name: "Log out of other devices" }).click();
    await expect(page.getByText("Logged out of 1 other device")).toBeVisible();
    await expect(page.getByText("Only this device is signed in.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Log out of other devices" })).toBeDisabled();

    // The other device is logged out at once, and comes back to its page after logging in.
    expect((await phonePage.request.get("/api/projects")).status()).toBe(401);
    await phonePage.goto("/today");
    await expect(phonePage).toHaveURL(/\/login\?next=%2Ftoday$/);
    // This one stays signed in.
    expect((await page.request.get("/api/projects")).status()).toBe(200);
  } finally {
    await phone.close();
  }
});

test("guest workspaces have no other devices to log out of", async ({ page }) => {
  await continueAsGuest(page);
  await page.goto("/account");
  await expect(page.getByText("This is a guest workspace.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out of other devices" })).toHaveCount(0);
  expect((await page.request.delete("/api/account/sessions")).status()).toBe(403);
});
