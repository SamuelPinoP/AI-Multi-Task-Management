import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

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

/** Signs up a throwaway account on the local server and logs it in. */
export async function signUpAndLogIn(page: Page, label = "E2E user") {
  const id = randomUUID().slice(0, 8);
  const name = `${label} ${id}`;
  const email = `e2e-${id}@example.test`;
  const password = `e2e-${randomUUID()}`;

  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/login\?error=created/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expectHome(page);

  return { name, email };
}
