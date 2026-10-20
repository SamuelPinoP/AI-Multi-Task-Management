import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

export function uniqueName(prefix: string) {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
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
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  return { name, email };
}
