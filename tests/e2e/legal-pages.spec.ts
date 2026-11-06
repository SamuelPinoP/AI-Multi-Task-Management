import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest } from "./helpers";

// #358: the Privacy Policy and Terms of Service, which Google's sign-in
// Branding page links to (#356), open signed out and are linked where people
// look for them.

const CONTACT = "samuelpinopena@gmail.com";

async function expectLegalLinks(page: Page, scope = page.locator("body")) {
  await expect(scope.getByRole("link", { name: "Privacy Policy" }).first()).toHaveAttribute("href", "/privacy");
  await expect(scope.getByRole("link", { name: "Terms of Service" }).first()).toHaveAttribute("href", "/terms");
}

test("both documents open signed out, dated, with the contact address", async ({ page }) => {
  const privacy = await page.goto("/privacy");
  expect(privacy?.status()).toBe(200);
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page).toHaveTitle("Privacy Policy · AI Multi");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByText(/^Last updated [A-Z][a-z]+ \d{1,2}, \d{4}$/)).toBeVisible();
  // What Google's review looks for: how Google user data is used, and the Limited Use statement.
  await expect(page.getByRole("heading", { name: "Google user data" })).toBeVisible();
  await expect(page.getByText(/adheres to the Google API Services User Data Policy, including the Limited Use requirements/)).toBeVisible();
  await expect(page.getByText("AI Multi is for people 18 and older.")).toBeVisible();
  await expect(page.getByRole("link", { name: CONTACT }).first()).toHaveAttribute("href", `mailto:${CONTACT}`);

  const terms = await page.goto("/terms");
  expect(terms?.status()).toBe(200);
  await expect(page).toHaveTitle("Terms of Service · AI Multi");
  await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();
  await expect(page.getByText("You must be at least 18 years old.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: CONTACT }).first()).toHaveAttribute("href", `mailto:${CONTACT}`);

  // Each links to the other, from its footer.
  await expectLegalLinks(page, page.getByRole("navigation", { name: "Legal" }));
  await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy Policy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
});

test("the home page, log in and sign up link to both", async ({ page }) => {
  // The home page that Google's Branding page names: its footer links the privacy policy.
  await page.goto("/");
  const footer = page.locator("footer");
  await expect(footer.getByText("AI Multi, a free app by Samuel Pino.")).toBeVisible();
  await expectLegalLinks(page, footer);

  await page.goto("/login");
  await expect(page.getByText("By continuing, you agree to the Terms of Service and the Privacy Policy.")).toBeVisible();
  await expectLegalLinks(page);

  await page.goto("/signup");
  await expect(
    page.getByText("You must be 18 or older. By creating an account or continuing with Google, you agree to the Terms of Service and the Privacy Policy."),
  ).toBeVisible();
  await expectLegalLinks(page);
  await page.getByRole("link", { name: "Terms of Service" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();
});

test("signed in, the documents still open, and the Account page links to them", async ({ page }) => {
  await continueAsGuest(page);
  await page.goto("/privacy");
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();

  await page.goto("/account");
  await expectLegalLinks(page, page.locator("#main-content"));
  // Guests have no email to write from, so the deletion note is for accounts.
  await expect(page.getByText("To get a copy of your data or delete your account")).toHaveCount(0);
});

test("no Search Console tag until GOOGLE_SITE_VERIFICATION is set", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[name="google-site-verification"]')).toHaveCount(0);
});
