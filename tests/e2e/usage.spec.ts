import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest, openAccountMenu, signUpAndLogIn, signUpAsAppAdmin } from "./helpers";

// #286: the free-tier usage page opens only for the accounts in ADMIN_EMAILS (the e2e server lists
// APP_ADMIN_EMAIL). Everyone else gets the same 404 as for a page that doesn't exist, and no menu item.

const USAGE_TITLE = "Free-tier usage";

async function expectNotFound(page: Page) {
  await expect(page.getByText("This page could not be found.").filter({ visible: true })).toBeVisible();
  // Not even hidden: the phone bar's title or a menu item would give the page away.
  await expect(page.getByText(USAGE_TITLE)).toHaveCount(0);
}

test("an account that isn't an admin gets a 404 and no menu item", async ({ page }) => {
  await signUpAndLogIn(page, "Not an admin");

  await openAccountMenu(page);
  await expect(page.getByRole("menuitem", { name: "Account settings" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: USAGE_TITLE })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.goto("/usage");
  await expectNotFound(page);
  // Exactly what a page that doesn't exist shows.
  await page.goto("/usage-nowhere");
  await expectNotFound(page);
});

test("a guest gets a 404 too", async ({ page }) => {
  await continueAsGuest(page);
  await page.goto("/usage");
  await expectNotFound(page);
});

test("signed out, it goes to log in like any other address", async ({ page }) => {
  await page.goto("/usage");
  await expect(page).toHaveURL(/\/login\?next=%2Fusage$/);
  await expect(page.getByText(USAGE_TITLE)).toHaveCount(0);
});

test("an admin opens it from the profile menu and sees each limit", async ({ page }) => {
  await signUpAsAppAdmin(page);

  await openAccountMenu(page);
  await page.getByRole("menuitem", { name: USAGE_TITLE }).click();
  await expect(page).toHaveURL(/\/usage$/);
  await expect(page.getByRole("heading", { level: 1, name: USAGE_TITLE }).filter({ visible: true })).toBeVisible();

  // The database against Neon's free 1 GB, with the percentage in words and the limit's source.
  const database = page.getByRole("region", { name: "Database" });
  await expect(database.getByRole("heading", { level: 3, name: "Database size" })).toBeVisible();
  await expect(database.getByText(/^[\d.,]+ (B|KB|MB|GB) of 1 GB · (<1|\d+)%$/)).toBeVisible();
  await expect(database.locator("[data-usage-level]")).toHaveAttribute("data-usage-level", "ok");
  await expect(database.getByRole("link", { name: "Neon's Free plan limits (opens in a new tab)" })).toHaveAttribute(
    "href",
    "https://neon.com/faqs/free-plan-limits-and-quotas",
  );

  // The e2e server keeps files on disk and sends no email, so those cards say why there's no bar.
  await expect(page.getByRole("region", { name: "File storage" }).getByText(/No R2 bucket is set up here/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Email" }).getByText(/Email sending is off here/)).toBeVisible();

  // Totals for context: at least this admin's own account.
  const totals = page.getByRole("region", { name: "For context" });
  for (const label of ["Accounts", "Guest workspaces", "Projects", "Chat attachments"]) {
    await expect(totals.getByText(label, { exact: true })).toBeVisible();
  }
  expect(Number((await totals.locator("dd").first().innerText()).replace(/,/g, ""))).toBeGreaterThanOrEqual(1);

  // What only the providers' dashboards know, with the free limits beside them.
  const dashboards = page.getByRole("region", { name: "On the providers' dashboards" });
  await expect(dashboards.getByText("1,000,000 function invocations a month")).toBeVisible();
  await expect(dashboards.getByText("100 CU-hours of compute a month")).toBeVisible();
  await expect(dashboards.getByRole("link", { name: "Open Vercel (opens in a new tab)" })).toHaveAttribute(
    "href",
    "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fusage&title=Go+to+Usage",
  );
  // Anonymous visits (#428): Hobby's allowance, and that it pauses rather than bills.
  await expect(dashboards.getByText("50,000 page views a month; past it, counting pauses and nothing is billed")).toBeVisible();
  await expect(dashboards.getByRole("link", { name: "Open Web Analytics (opens in a new tab)" })).toHaveAttribute(
    "href",
    "https://vercel.com/d?to=%2F%5Bteam%5D%2F%5Bproject%5D%2Fanalytics&title=Go+to+Web+Analytics",
  );
  await expect(dashboards.getByRole("link", { name: "Open Neon (opens in a new tab)" })).toHaveAttribute("href", "https://console.neon.tech/app/projects");
  await expect(dashboards.getByRole("link", { name: "Open Cloudflare R2 (opens in a new tab)" })).toHaveAttribute(
    "href",
    "https://dash.cloudflare.com/?to=/:account/r2/overview",
  );
});
