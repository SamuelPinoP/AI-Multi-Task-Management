import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest } from "./helpers";

/*
 * Accent colors (DES-15, #321): the account menu's swatches and the command
 * palette switch the app's palette, and the next page load applies it again
 * before the app's JavaScript runs. Contrast in every palette is checked by
 * src/lib/design-tokens.test.ts and accessibility.spec.ts.
 */

/** A CSS custom property as <html> resolves it. */
function token(page: Page, name: string) {
  return page.evaluate((property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(), name);
}

test("the account menu switches the accent color, and a reload keeps it", async ({ page }) => {
  await continueAsGuest(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-accent", "teal");
  const teal = await token(page, "--accent");
  const success = await token(page, "--success");

  await page.getByRole("button", { name: "Account menu" }).click();
  const tealSwatch = page.getByRole("menuitemradio", { name: "Teal" });
  const blueSwatch = page.getByRole("menuitemradio", { name: "Blue" });
  await expect(tealSwatch).toHaveAttribute("aria-checked", "true");
  await blueSwatch.click();

  await expect(html).toHaveAttribute("data-accent", "blue");
  // The menu stays open for trying more colors, and shows which one is picked.
  await expect(blueSwatch).toHaveAttribute("aria-checked", "true");
  await expect(tealSwatch).toHaveAttribute("aria-checked", "false");
  // The page takes the swatch's color, and status colors such as On track stay.
  const blue = await blueSwatch.locator("span").evaluate((swatch) => getComputedStyle(swatch).getPropertyValue("--accent").trim());
  expect(blue).not.toBe(teal);
  expect(await token(page, "--accent")).toBe(blue);
  expect(await token(page, "--success")).toBe(success);

  await page.keyboard.press("Escape");
  await page.reload();
  await expect(html).toHaveAttribute("data-accent", "blue");
  expect(await token(page, "--accent")).toBe(blue);
});

test("a saved accent applies before the app's JavaScript runs, and an unknown one falls back to teal", async ({ page }) => {
  await continueAsGuest(page);
  const html = page.locator("html");

  await page.evaluate(() => localStorage.setItem("ai-multi-accent", "plum"));
  // Without its scripts the app never starts, so only the inline script in <head> can set the palette.
  await page.route(/\/_next\/static\/chunks\//, (route) => route.abort());
  await page.reload();
  await expect(html).toHaveAttribute("data-accent", "plum");
  await page.unrouteAll();

  await page.evaluate(() => localStorage.setItem("ai-multi-accent", "neon"));
  await page.reload();
  await expect(html).toHaveAttribute("data-accent", "teal");
});

test("the command palette switches the accent color", async ({ page, isMobile }) => {
  await continueAsGuest(page);
  if (isMobile) {
    await page.getByRole("button", { name: "Search" }).click();
  } else {
    await page.keyboard.press("Control+K");
  }

  await page.getByPlaceholder("Search or run a command...").fill("accent");
  // Every color except the current one.
  await expect(page.getByRole("option", { name: /^Switch to \w+ accent$/ })).toHaveCount(4);
  await page.getByRole("option", { name: "Switch to Violet accent" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "violet");
});
