import { expect, test, type Page } from "@playwright/test";
import { AI_NOTICE_VERSION } from "../../src/lib/ai/notice";
import { continueAsGuest, signUpAndLogIn, uniqueName } from "./helpers";

// The AI bar on every page (#308, round 3's quiet bar), end to end with the fake model
// (src/lib/ai/providers/fake.ts): a message naming a tool calls it, anything else gets "You asked: …".

const bar = (page: Page) => page.getByRole("form", { name: "Ask AI Multi" });
const chat = (page: Page) => page.getByRole("region", { name: "AI chat" });
const chatBox = (page: Page) => chat(page).getByRole("textbox", { name: "Message the AI" });

async function agree(page: Page) {
  expect((await page.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).status()).toBe(200);
}

/**
 * Ctrl J, pressed again until the page has hydrated and the chat opens. Only while it's closed:
 * Ctrl J from inside the chat closes it.
 */
async function openWithShortcut(page: Page) {
  await expect(async () => {
    if ((await chat(page).count()) === 0) await page.keyboard.press("Control+j");
    await expect(chat(page)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** The middle of a box, for comparing where things sit. */
function middle(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe("on a computer", () => {
  test.skip(({ isMobile }) => isMobile, "Phones get the bar as a button above the tabs; see below.");

  test("the bar is at the bottom of every page but the AI page, and the chats get the ✦ button", async ({ page }) => {
    await signUpAndLogIn(page, "E2E AI bar");
    for (const path of ["/", "/tasks", "/events", "/account"]) {
      await page.goto(path);
      await expect(bar(page), path).toBeVisible();
    }
    // Centred over the page, 24 px from the bottom, at most 720 px wide.
    const main = (await page.locator("#main-content").boundingBox())!;
    const box = (await bar(page).boundingBox())!;
    expect(Math.abs(middle(box).x - middle(main).x)).toBeLessThan(2);
    expect(Math.round(box.width)).toBe(720);
    expect(Math.round(page.viewportSize()!.height - (box.y + box.height))).toBe(24);
    await expect(bar(page).getByRole("textbox", { name: "Ask AI Multi" })).toHaveAttribute("placeholder", "Create a task, ask anything, or create an event");
    await expect(bar(page).getByText("Ctrl J")).toBeVisible();

    await page.goto("/ai");
    await expect(page.getByRole("region", { name: "Conversation" })).toBeVisible();
    await expect(bar(page)).toHaveCount(0);

    // The chats have their own message box: the AI waits as the ✦ button there.
    await page.goto("/chats");
    await expect(page.getByRole("button", { name: "Ask AI Multi" })).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Ask AI Multi" }).click();
    await expect(chat(page)).toBeVisible();
    await expect(chatBox(page)).toBeFocused();
  });

  test("guests don't get the bar", async ({ page }) => {
    await continueAsGuest(page);
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
  });

  test("sending from the bar opens the chat, with the notice first, and the answer streams in", async ({ page }) => {
    await signUpAndLogIn(page, "E2E AI bar ask");
    const task = uniqueName("E2E bar task");
    expect((await page.request.post("/api/tasks", { data: { title: task } })).status()).toBe(201);
    await page.goto("/tasks");

    const input = bar(page).getByRole("textbox", { name: "Ask AI Multi" });
    await input.fill("What's on my plate? list_open_tasks");
    await expect(bar(page).getByText("Ctrl J")).toHaveCount(0);
    await expect(bar(page).getByRole("button", { name: "Send" })).toHaveClass(/\bai-send\b/);
    await input.press("Enter");

    await expect(chat(page)).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
    const notice = chat(page).getByRole("region", { name: "Before your first question" });
    await expect(notice).toBeVisible();
    await notice.getByRole("button", { name: "Agree and continue" }).click();
    await expect(chat(page).getByText(`list_open_tasks found 1: ${task}`)).toBeVisible();
    await expect(chat(page).getByText("38 of 40 left today · Answers can be wrong. Nothing changes until you confirm it.")).toBeVisible();
    // The chat's title is its first question.
    await expect(chat(page).getByText("What's on my plate? list_open_tasks", { exact: true }).first()).toBeVisible();

    // Collapse: back to the bar, with the cursor in it.
    await chat(page).getByRole("button", { name: "Collapse" }).click();
    await expect(chat(page)).toHaveCount(0);
    await expect(input).toBeFocused();

    // The conversation follows to other pages, and onto the AI page.
    await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Notes" }).click();
    await expect(page).toHaveURL(/\/notes$/);
    await bar(page).getByRole("button", { name: "Open the AI chat" }).click();
    await expect(chat(page).getByText(`list_open_tasks found 1: ${task}`)).toBeVisible();
    await chat(page).getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Open on the AI page" }).click();
    await expect(page).toHaveURL(/\/ai$/);
    await expect(page.getByRole("region", { name: "Conversation" }).getByText(`list_open_tasks found 1: ${task}`)).toBeVisible();
  });

  test("Ctrl J opens the chat from anywhere, even while typing, and Escape or Ctrl J closes it", async ({ page }) => {
    await signUpAndLogIn(page, "E2E AI bar keys");
    await agree(page);
    await page.goto("/");

    await openWithShortcut(page);
    await expect(chatBox(page)).toBeFocused();
    await expect(chat(page).getByRole("button", { name: "What's overdue?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(chat(page)).toHaveCount(0);

    // From a text field too, like Ctrl K.
    await page.goto("/tasks");
    const add = page.getByRole("main").getByRole("textbox").first();
    await add.focus();
    await openWithShortcut(page);
    await expect(chatBox(page)).toBeFocused();
    await page.keyboard.type("Hello there");
    await page.keyboard.press("Enter");
    await expect(chat(page).getByText("You asked: Hello there")).toBeVisible();
    // Ctrl J inside the chat closes it, and the bar keeps the cursor.
    await chatBox(page).focus();
    await page.keyboard.press("Control+j");
    await expect(chat(page)).toHaveCount(0);
    await expect(bar(page).getByRole("textbox", { name: "Ask AI Multi" })).toBeFocused();

    // The chat's history lists this tab's chats.
    await page.keyboard.press("Control+j");
    await chat(page).getByRole("button", { name: "Chat history" }).click();
    await expect(chat(page).getByRole("list", { name: "Chats" }).getByRole("button", { name: "Hello there" })).toHaveAttribute("aria-current", "true");

    // The shortcut is listed with the others.
    await page.keyboard.press("Escape");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" }).getByText("Ask AI Multi")).toBeVisible();
  });

  test("the open chat is 760 × 560, resizes from its top edge and corners, and keeps its size", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signUpAndLogIn(page, "E2E AI bar size");
    await page.goto("/");
    await openWithShortcut(page);
    const card = chat(page);
    const edge = card.getByRole("separator", { name: "Resize the chat" });
    let box = (await card.boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([760, 560]);
    await expect(edge).toHaveAttribute("aria-valuenow", "560");

    // Keys on the top edge: ↑ 24 px taller, End the tallest, Home the lowest, Enter back to the start.
    await edge.focus();
    await page.keyboard.press("ArrowUp");
    await expect(edge).toHaveAttribute("aria-valuenow", "584");
    await page.keyboard.press("End");
    await expect(edge).toHaveAttribute("aria-valuenow", "720");
    await page.keyboard.press("Home");
    await expect(edge).toHaveAttribute("aria-valuenow", "400");
    await page.keyboard.press("Enter");
    await expect(edge).toHaveAttribute("aria-valuenow", "560");

    // Dragging the top edge up 100 px makes it 100 px taller; its bottom stays put.
    box = (await card.boundingBox())!;
    const edgeBox = (await edge.boundingBox())!;
    await page.mouse.move(middle(edgeBox).x, middle(edgeBox).y);
    await page.mouse.down();
    await page.mouse.move(middle(edgeBox).x, middle(edgeBox).y - 100, { steps: 5 });
    await page.mouse.up();
    let after = (await card.boundingBox())!;
    expect(Math.round(after.height)).toBe(660);
    expect(Math.round(after.y + after.height)).toBe(Math.round(box.y + box.height));

    // The right corner 50 px to the right: 100 px wider, since it stays centred.
    const corner = card.locator('[data-chat-corner="right"]');
    const cornerBox = (await corner.boundingBox())!;
    await page.mouse.move(middle(cornerBox).x, middle(cornerBox).y);
    await page.mouse.down();
    await page.mouse.move(middle(cornerBox).x + 50, middle(cornerBox).y, { steps: 5 });
    await page.mouse.up();
    after = (await card.boundingBox())!;
    expect(Math.round(after.width)).toBe(860);
    expect(Math.abs(middle(after).x - middle(box).x)).toBeLessThan(2);

    // Never wider than 960 px.
    const leftCorner = card.locator('[data-chat-corner="left"]');
    const leftBox = (await leftCorner.boundingBox())!;
    await page.mouse.move(middle(leftBox).x, middle(leftBox).y);
    await page.mouse.down();
    await page.mouse.move(middle(leftBox).x - 300, middle(leftBox).y, { steps: 5 });
    await page.mouse.up();
    expect(Math.round((await card.boundingBox())!.width)).toBe(960);

    // Remembered on this device.
    await page.reload();
    await openWithShortcut(page);
    box = (await chat(page).boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([960, 660]);
    // A double-click on the edge brings back 760 × 560.
    await chat(page).getByRole("separator", { name: "Resize the chat" }).dblclick();
    box = (await chat(page).boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([760, 560]);
  });
});

test.describe("on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "Phones only.");

  test("the bar sits above the tabs and opens the chat full screen", async ({ page }) => {
    await signUpAndLogIn(page, "E2E AI bar phone");
    await agree(page);
    await page.goto("/tasks");

    const opener = page.getByRole("button", { name: "Ask AI Multi: Create a task, ask, or create an event" });
    await expect(opener).toBeVisible();
    const tabs = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!;
    const box = (await opener.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(tabs.y);

    await opener.click();
    const sheet = page.getByRole("dialog", { name: "AI chat" });
    await expect(sheet).toBeVisible();
    // Full screen, but for a strip at the top.
    const sheetBox = (await sheet.boundingBox())!;
    expect(sheetBox.height).toBeGreaterThan(page.viewportSize()!.height - 60);
    await sheet.getByRole("button", { name: "What analytics can you give?" }).click();
    await expect(sheet.getByText("You asked: What analytics can you give?", { exact: true })).toBeVisible();

    await sheet.getByRole("button", { name: "Collapse" }).click();
    await expect(sheet).toBeHidden();
    await opener.click();
    await expect(sheet.getByText("You asked: What analytics can you give?", { exact: true })).toBeVisible();
  });

  test("on the chats the ✦ button sits above their message box and opens the chat", async ({ page }) => {
    await signUpAndLogIn(page, "E2E AI bar phone chats");
    await page.goto("/chats");
    const button = page.getByRole("button", { name: "Ask AI Multi" });
    await expect(button).toBeVisible();
    await expect(page.getByRole("button", { name: /^Ask AI Multi: / })).toHaveCount(0);
    await button.click();
    await expect(page.getByRole("dialog", { name: "AI chat" })).toBeVisible();
  });
});
