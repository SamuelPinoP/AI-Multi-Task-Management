import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest, queryDatabase, signUpAndLogIn } from "./helpers";

// Minimizing and hiding the AI bar (#308, round 3), saved per account in User.aiDock.

const bar = (page: Page) => page.getByRole("form", { name: "Ask AI Multi" });
const bubble = (page: Page) => page.getByRole("button", { name: "Ask AI Multi", exact: true });
const chat = (page: Page) => page.getByRole("region", { name: "AI chat" });

async function savedDock(email: string) {
  const { rows } = await queryDatabase<{ aiDock: string | null }>(`SELECT "aiDock" FROM "User" WHERE email = $1`, [email]);
  return rows[0].aiDock;
}

/** Waits until the saved state is `state`: the page saves it right after it changes on screen. */
async function expectSaved(email: string, state: string | null) {
  await expect.poll(() => savedDock(email)).toBe(state);
}

test("only the account itself can move its AI bar, to one of the three places", async ({ page, browser, playwright, baseURL }) => {
  const signedOut = await playwright.request.newContext({ baseURL });
  expect((await signedOut.put("/api/agent/dock", { data: { dock: "hidden" } })).status()).toBe(401);
  await signedOut.dispose();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await continueAsGuest(guest);
  expect((await guest.request.put("/api/agent/dock", { data: { dock: "hidden" } })).status()).toBe(403);
  await guestContext.close();

  const { email } = await signUpAndLogIn(page, "E2E AI dock api");
  expect(await savedDock(email)).toBeNull();
  for (const body of [{ dock: "closed" }, { dock: "HIDDEN" }, { dock: "open", extra: true }, {}]) {
    expect((await page.request.put("/api/agent/dock", { data: body })).status(), JSON.stringify(body)).toBe(400);
  }
  const saved = await page.request.put("/api/agent/dock", { data: { dock: "minimized" } });
  expect(await saved.json()).toEqual({ dock: "minimized" });
  expect(await savedDock(email)).toBe("MINIMIZED");
});

test.describe("on a computer", () => {
  test.skip(({ isMobile }) => isMobile, "Phones minimize and hide from the chat's ⋯ menu; see below.");

  test("minimizing turns the bar into the ✦ button, kept for the account on every device", async ({ page, browser }) => {
    const { email } = await signUpAndLogIn(page, "E2E AI dock minimize");
    await page.goto("/tasks");
    await bar(page).getByRole("button", { name: "Minimize to a button" }).click();
    await expect(bar(page)).toHaveCount(0);
    await expect(bubble(page)).toBeVisible();
    // At the bottom right, 24 px from the edges.
    const box = (await bubble(page).boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(Math.round(viewport.width - (box.x + box.width))).toBe(24);
    expect(Math.round(viewport.height - (box.y + box.height))).toBe(24);
    await expectSaved(email, "MINIMIZED");

    // It comes that way from the server, here and in another browser signed in to the same account.
    await page.reload();
    await expect(bubble(page)).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
    const other = await browser.newContext({ storageState: await page.context().storageState() });
    const elsewhere = await other.newPage();
    await elsewhere.goto("/notes");
    await expect(bubble(elsewhere)).toBeVisible();
    await expect(bar(elsewhere)).toHaveCount(0);
    await other.close();

    // The button brings the bar back, with the cursor in it.
    await bubble(page).click();
    await expect(bar(page).getByRole("textbox", { name: "Ask AI Multi" })).toBeFocused();
    await expectSaved(email, "OPEN");
  });

  test("hiding moves the AI to the AI page, says so with Undo, and the AI page brings it back", async ({ page }) => {
    const { email } = await signUpAndLogIn(page, "E2E AI dock hide");
    await page.goto("/tasks");
    await bar(page).getByRole("button", { name: "Minimize to a button" }).click();

    // The small × shows on hover, on the button's right.
    const hide = page.getByRole("button", { name: "Hide from pages" });
    await bubble(page).hover();
    await expect(hide).toBeVisible();
    const bubbleBox = (await bubble(page).boundingBox())!;
    const hideBox = (await hide.boundingBox())!;
    expect(hideBox.x + hideBox.width).toBeGreaterThan(bubbleBox.x + bubbleBox.width);
    await hide.click();
    await expect(bubble(page)).toHaveCount(0);
    const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Moved to" });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole("link", { name: "AI page" })).toHaveAttribute("href", "/ai");
    await expectSaved(email, "HIDDEN");

    // Undo puts it back as it was: minimized.
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(bubble(page)).toBeVisible();
    await expectSaved(email, "MINIMIZED");

    // Hidden from the open chat's ⋯ menu this time. The note goes away by itself.
    await bubble(page).click();
    await expect(bar(page)).toBeVisible();
    await bar(page).getByRole("button", { name: "Open the AI chat" }).click();
    await chat(page).getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Hide from pages" }).click();
    await expect(chat(page)).toHaveCount(0);
    await expect(bar(page)).toHaveCount(0);
    await expect(bubble(page)).toHaveCount(0);
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCount(0, { timeout: 10_000 });
    await expectSaved(email, "HIDDEN");

    // Nothing on other pages, the chats included, and Ctrl J goes to the AI page.
    await page.goto("/chats");
    await expect(page.getByRole("heading", { name: "Chats" }).first()).toBeVisible();
    await expect(bubble(page)).toHaveCount(0);
    await expect(bar(page)).toHaveCount(0);
    await page.goto("/notes");
    await expect(page.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible();
    await expect(async () => {
      await page.keyboard.press("Control+j");
      await expect(page).toHaveURL(/\/ai$/, { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });

    // The AI page says where the bar is, and shows it on every page again.
    const pill = page.getByRole("button", { name: "AI bar: hidden" });
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.getByText("The AI bar is hidden from your pages.")).toBeVisible();
    await page.getByRole("menuitem", { name: "Show on every page" }).click();
    await expect(page.getByRole("button", { name: "AI bar: visible" })).toBeVisible();
    await expectSaved(email, "OPEN");
    await page.goto("/tasks");
    await expect(bar(page)).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "Phones only.");

  test("minimize and hide are in the chat's ⋯ menu", async ({ page }) => {
    const { email } = await signUpAndLogIn(page, "E2E AI dock phone");
    await page.goto("/tasks");
    const opener = page.getByRole("button", { name: /^Ask AI Multi: / });
    const sheet = page.getByRole("dialog", { name: "AI chat" });

    await opener.click();
    await sheet.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Minimize to a button" }).click();
    await expect(sheet).toBeHidden();
    await expect(opener).toHaveCount(0);
    await expect(bubble(page)).toBeVisible();
    // Above the tabs, at the right.
    const tabs = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!;
    const box = (await bubble(page).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(tabs.y);
    await expectSaved(email, "MINIMIZED");

    // The button opens the chat, full screen; hiding leaves the note and nothing else.
    await bubble(page).click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Hide from pages" }).click();
    await expect(sheet).toBeHidden();
    await expect(bubble(page)).toHaveCount(0);
    await expect(opener).toHaveCount(0);
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Moved to" })).toBeVisible();
    await expectSaved(email, "HIDDEN");

    // On the AI page, its ✦ in the header says so and brings it back.
    await page.goto("/ai");
    await page.getByRole("button", { name: "AI bar: hidden" }).click();
    await page.getByRole("menuitem", { name: "Show on every page" }).click();
    await expectSaved(email, "OPEN");
    await page.goto("/tasks");
    await expect(opener).toBeVisible();
  });
});
