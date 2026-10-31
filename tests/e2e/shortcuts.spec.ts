import { expect, test } from "@playwright/test";
import { continueAsGuest } from "./helpers";

test("keyboard shortcuts open dialogs and move between pages", async ({ page, isMobile }) => {
  test.skip(isMobile, "Shortcuts are for keyboards.");
  await continueAsGuest(page);

  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  // The Calendar's two tabs keep the keys of the old Events and Calendar items (DES-13).
  await expect(help.locator("li", { hasText: "Calendar: Agenda" }).locator("kbd")).toHaveText(["G", "E"]);
  await expect(help.locator("li", { hasText: "Calendar: Month" }).locator("kbd")).toHaveText(["G", "C"]);
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();

  const views = page.getByRole("navigation", { name: "Calendar views" });
  await page.keyboard.press("g");
  await page.keyboard.press("e");
  await expect(page).toHaveURL(/\/events$/);
  await expect(views.getByRole("link", { name: "Agenda" })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("g");
  await page.keyboard.press("c");
  await expect(page).toHaveURL(/\/events\/calendar$/);
  await expect(views.getByRole("link", { name: "Month" })).toHaveAttribute("aria-current", "page");

  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await expect(page).toHaveURL(/\/tasks$/);
  await page.keyboard.press("g");
  await page.keyboard.press("n");
  await expect(page).toHaveURL(/\/notes$/);

  await page.keyboard.press("n");
  await expect(page.getByRole("dialog", { name: "New task" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("/");
  await expect(page.getByPlaceholder("Search or run a command...")).toBeFocused();
  await page.keyboard.press("Escape");

  // Typing in a field never triggers a shortcut.
  await page.getByLabel("Search notes").fill("");
  await page.getByLabel("Search notes").press("n");
  await expect(page.getByLabel("Search notes")).toHaveValue("n");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
