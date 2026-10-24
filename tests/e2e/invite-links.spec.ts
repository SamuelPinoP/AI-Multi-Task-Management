import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { invitationHref } from "../../src/lib/auth-links";
import { queryDatabase, signUpAndLogIn, uniqueName } from "./helpers";

async function inviteToNewProject(owner: APIRequestContext, email: string) {
  const projectName = uniqueName("Invite link project");
  const created = await owner.post("/api/projects", { data: { name: projectName } });
  expect(created.ok()).toBe(true);
  const project = (await created.json()) as { id: string };
  const invited = await owner.post(`/api/projects/${project.id}/invitations`, { data: { email, role: "EDITOR" } });
  expect(invited.ok(), await invited.text()).toBe(true);
  return projectName;
}

/** Waits for a same-site link's path and query, which a string toHaveURL would compare as a full URL. */
async function expectPath(page: Page, href: string) {
  await page.waitForURL((url) => url.pathname + url.search === href);
}

async function expectInvitation(page: Page, projectName: string) {
  await expect(page).toHaveURL(/\/projects$/);
  const invitations = page.getByRole("region", { name: "You're invited to a project" });
  await expect(invitations.getByText(projectName)).toBeVisible();
  await expect(invitations.getByRole("button", { name: "Accept" })).toBeVisible();
}

test("an invitee with an account logs in from the email's link and lands on the invitation", async ({ browser }) => {
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext();
  const inviteeContext = await browser.newContext();
  try {
    await signUpAndLogIn(await ownerContext.newPage(), "E2E owner");
    const invitee = await signUpAndLogIn(await inviteeContext.newPage(), "E2E invitee");
    await inviteeContext.close();
    const projectName = await inviteToNewProject(ownerContext.request, invitee.email);

    // Signed out, as when the email is opened on another device.
    const visitor = await browser.newContext();
    const page = await visitor.newPage();
    try {
      await page.goto(invitationHref(invitee.email, true));
      await expect(page.getByLabel("Email")).toHaveValue(invitee.email);
      // Switching to sign up keeps the email and the way back to the invitation.
      await page.getByRole("link", { name: "Create an account" }).first().click();
      await expectPath(page, invitationHref(invitee.email, false));
      await expect(page.getByLabel("Email")).toHaveValue(invitee.email);

      // Older emails always opened sign up: it now offers to log in instead.
      await page.getByLabel("Name").fill("Already here");
      await page.getByLabel("Password", { exact: true }).fill(invitee.password);
      await page.getByLabel("Confirm password").fill(invitee.password);
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page.getByText("An account with that email already exists.")).toBeVisible();
      await page.getByRole("link", { name: "Log in instead" }).click();
      await expectPath(page, invitationHref(invitee.email, true));
      await expect(page.getByLabel("Email")).toHaveValue(invitee.email);

      await page.getByLabel("Password").fill(invitee.password);
      await page.getByRole("button", { name: "Log in" }).click();
      await expectInvitation(page, projectName);
    } finally {
      await visitor.close();
    }
  } finally {
    await ownerContext.close();
  }
});

test("a new invitee signs up from the email's link and is brought back to the invitation", async ({ browser }) => {
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext();
  const visitor = await browser.newContext();
  try {
    await signUpAndLogIn(await ownerContext.newPage(), "E2E owner");
    const email = `e2e-new-${randomUUID().slice(0, 8)}@example.test`;
    const password = `e2e-${randomUUID()}`;
    const projectName = await inviteToNewProject(ownerContext.request, email);

    const page = await visitor.newPage();
    await page.goto(invitationHref(email, false));
    await expect(page.getByLabel("Email")).toHaveValue(email);
    await page.getByLabel("Name").fill("New invitee");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/login\?error=created&/);
    await expect(page.getByText("Account created.")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue(email);
    // As if the confirmation email's link was opened: unconfirmed addresses can't see invitations (#221).
    await queryDatabase(`UPDATE "User" SET "emailVerifiedAt" = now() AT TIME ZONE 'utc' WHERE email = $1`, [email]);

    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expectInvitation(page, projectName);
  } finally {
    await Promise.all([ownerContext.close(), visitor.close()]);
  }
});

test("a link for another address asks before switching accounts", async ({ page }) => {
  const signedIn = await signUpAndLogIn(page, "E2E signed in");
  const otherEmail = `e2e-other-${randomUUID().slice(0, 8)}@example.test`;

  // The link is for this account: straight to where it leads.
  await page.goto(invitationHref(signedIn.email, true));
  await expect(page).toHaveURL(/\/projects$/);

  for (const hasAccount of [false, true]) {
    await page.goto(invitationHref(otherEmail, hasAccount));
    await expect(page.getByRole("heading", { name: "Switch accounts?" })).toBeVisible();
    await expect(page.getByText(otherEmail, { exact: true })).toBeVisible();
    await expect(page.getByText(signedIn.email, { exact: true })).toBeVisible();
  }

  await page.getByRole("link", { name: "Stay signed in" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(invitationHref(otherEmail, true));
  await page.getByRole("button", { name: "Log out and continue" }).click();
  await expect(page).toHaveURL(/\/login\?error=logged-out&email=/);
  await expect(page.getByText("You have been logged out.")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue(otherEmail);
  expect((await page.request.get("/api/projects")).status()).toBe(401);
});
