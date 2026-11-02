import { expect, test, type Locator, type Page } from "@playwright/test";
import { continueAsGuest } from "./helpers";

/*
 * Form fields on phones (#337). iOS Safari zooms the page in when a field's
 * text is under 16px and leaves it zoomed, so below 640px every text field
 * uses at least 16px. Wider screens keep their 14px fields. Chromium never
 * zooms like that, so these tests read the computed size instead.
 */

/** Fields that take typed text; checkboxes, radios and buttons don't. */
const textFields =
  'input:not([type="checkbox"], [type="radio"], [type="range"], [type="color"], [type="file"], [type="hidden"], [type="button"], [type="submit"], [type="reset"], [type="image"]), textarea, select';

function fontSize(field: Locator) {
  return field.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
}

/** Each visible text field on the page, named by its label, placeholder or id, with its font size. */
function visibleFieldSizes(page: Page) {
  return page.locator(textFields).evaluateAll((fields) =>
    fields
      .filter((field) => field.checkVisibility())
      .map((field) => ({
        name: field.getAttribute("aria-label") || field.getAttribute("placeholder") || field.id || field.tagName,
        size: parseFloat(getComputedStyle(field).fontSize),
      })),
  );
}

test("the sign-in fields use 16px text on phones and 14px on wider screens", async ({ page, isMobile }) => {
  await page.goto("/login");
  for (const field of [page.getByLabel("Email"), page.getByLabel("Password")]) {
    expect(await fontSize(field)).toBe(isMobile ? 16 : 14);
  }
});

test("the command palette's search field uses 16px text on phones and 14px on wider screens", async ({ page, isMobile }) => {
  await continueAsGuest(page);
  if (isMobile) {
    await page.getByRole("button", { name: "Search" }).click();
  } else {
    await page.keyboard.press("Control+K");
  }
  const search = page.getByPlaceholder("Search or run a command...");
  await expect(search).toBeVisible();
  expect(await fontSize(search)).toBe(isMobile ? 16 : 14);
});

test("every visible field on the main pages uses at least 16px text on phones", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Wider screens keep their sizes; the tests above check them.");
  await continueAsGuest(page);

  const tooSmall: string[] = [];
  let checked = 0;
  for (const path of ["/tasks", "/notes", "/projects", "/goals"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const fields = await visibleFieldSizes(page);
    checked += fields.length;
    tooSmall.push(...fields.filter((field) => field.size < 16).map((field) => `${path}: ${field.name} (${field.size}px)`));
  }
  expect(tooSmall).toEqual([]);
  // Guards against a page change that leaves nothing to check.
  expect(checked).toBeGreaterThan(5);
});

test("the Tasks filters have room for their 16px labels on phones", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Wider screens size the filters to their labels.");
  await continueAsGuest(page);
  await page.goto("/tasks");

  const filters = page.getByRole("search", { name: "Filter tasks" }).locator("select");
  await expect(filters).toHaveCount(3);
  const cramped = await filters.evaluateAll((selects) => {
    const context = document.createElement("canvas").getContext("2d")!;
    return selects.flatMap((element) => {
      const select = element as HTMLSelectElement;
      const style = getComputedStyle(select);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const label = select.selectedOptions[0]?.text ?? "";
      // The label, the side padding and about 24px for the arrow.
      const needed = context.measureText(label).width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 24;
      const width = select.getBoundingClientRect().width;
      return needed > width ? [`"${label}" needs ${Math.ceil(needed)}px and has ${Math.round(width)}px`] : [];
    });
  });
  expect(cramped).toEqual([]);
});
