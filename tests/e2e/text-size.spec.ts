import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest } from "./helpers";

/*
 * Text size (DES-19, #338): the account menu's four sizes set the root font
 * size, so text, icons and spacing grow together, and the next page load
 * applies the saved size before the app's JavaScript runs. The open menu's
 * accessibility is scanned by accessibility.spec.ts.
 */

function rootFontSize(page: Page) {
  return page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
}

/** The computed font size of a throwaway element with these classes. */
function classFontSize(page: Page, className: string) {
  return page.evaluate((classes) => {
    const probe = document.createElement("span");
    probe.className = classes;
    probe.textContent = "A";
    document.body.append(probe);
    const size = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    return size;
  }, className);
}

test("the account menu changes the text size of the whole app, and a reload keeps it", async ({ page }) => {
  await continueAsGuest(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-text-size", "default");
  expect(await rootFontSize(page)).toBe(16);
  // includeHidden: the open menu hides the rest of the page, avatar included, from role queries.
  const topBar = page.locator("header").filter({ has: page.getByRole("button", { name: "Account menu", includeHidden: true }) });
  const barHeight = () => topBar.evaluate((header) => header.getBoundingClientRect().height);
  expect(await barHeight()).toBe(56);

  await page.getByRole("button", { name: "Account menu" }).click();
  const defaultSize = page.getByRole("menuitemradio", { name: "Default", exact: true });
  const large = page.getByRole("menuitemradio", { name: "Large", exact: true });
  await expect(defaultSize).toHaveAttribute("aria-checked", "true");
  await large.click();

  await expect(html).toHaveAttribute("data-text-size", "large");
  // The menu stays open for trying more sizes, and shows which one is picked.
  await expect(large).toHaveAttribute("aria-checked", "true");
  await expect(defaultSize).toHaveAttribute("aria-checked", "false");
  // Text and spacing both grow: 14px body text becomes 15.75px, and the 56px bar 63px.
  expect(await rootFontSize(page)).toBe(18);
  expect(await classFontSize(page, "text-sm")).toBe(15.75);
  expect(await barHeight()).toBe(63);

  await page.keyboard.press("Escape");
  await page.reload();
  await expect(html).toHaveAttribute("data-text-size", "large");
  expect(await rootFontSize(page)).toBe(18);
});

test("a saved text size applies before the app's JavaScript runs, and an unknown one falls back to Default", async ({ page }) => {
  await continueAsGuest(page);
  const html = page.locator("html");

  await page.evaluate(() => localStorage.setItem("ai-multi-text-size", "larger"));
  // Without its scripts the app never starts, so only the inline script in <head> can set the size.
  await page.route(/\/_next\/static\//, (route) => (route.request().resourceType() === "script" ? route.abort() : route.continue()));
  await page.reload();
  await expect(html).toHaveAttribute("data-text-size", "larger");
  expect(await rootFontSize(page)).toBe(20);
  await page.unrouteAll();

  await page.evaluate(() => localStorage.setItem("ai-multi-text-size", "huge"));
  await page.reload();
  await expect(html).toHaveAttribute("data-text-size", "default");
  expect(await rootFontSize(page)).toBe(16);
});

test("Small shrinks the text but keeps the smallest text at 11px, and phone fields at 16px", async ({ page, isMobile }) => {
  await continueAsGuest(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitemradio", { name: "Small", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "small");

  expect(await rootFontSize(page)).toBe(15);
  expect(await classFontSize(page, "text-sm")).toBe(13.125);
  expect(await classFontSize(page, "text-2xs")).toBe(11);

  // iOS Safari zooms into fields under 16px (#337), so on phones they stay 16px at Small too.
  await page.goto("/tasks");
  const search = page.getByPlaceholder("Search tasks");
  expect(await search.evaluate((field) => parseFloat(getComputedStyle(field).fontSize))).toBe(isMobile ? 16 : 13.125);
});

test("at Larger the main pages still fit the screen without scrolling sideways", async ({ page }) => {
  await continueAsGuest(page);
  await page.evaluate(() => localStorage.setItem("ai-multi-text-size", "larger"));

  const overflowing: string[] = [];
  for (const path of ["/", "/tasks", "/events", "/notes", "/projects", "/chats"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-text-size", "larger");
    await page.waitForLoadState("networkidle");
    const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
    if (widths.page > widths.screen) overflowing.push(`${path}: ${widths.page}px wide on a ${widths.screen}px screen`);
  }
  expect(overflowing).toEqual([]);
});
