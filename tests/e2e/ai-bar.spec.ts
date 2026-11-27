import { expect, test, type Locator, type Page } from "@playwright/test";
import { AI_NOTICE_VERSION } from "../../src/lib/ai/notice";
import { continueAsGuest, signUpAndLogIn, storeAiChat, uniqueName } from "./helpers";

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

/** Where something's box ends on the screen. */
async function bottomOf(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return box.y + box.height;
}

/** A project's chat's own message box. */
const messageBox = (page: Page) => page.locator("form", { has: page.locator("#project-chat-message") });

/** A new project whose chat has 8 messages, "Update 1" to "Update 8": enough to scroll on any screen. */
async function chatWithMessages(page: Page, name: string) {
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName(name) } })).json()) as { id: string };
  for (let index = 1; index <= 8; index += 1) {
    expect((await page.request.post(`/api/projects/${project.id}/comments`, { data: { message: `Update ${index}` } })).status()).toBe(201);
  }
  return project;
}

test.describe("on a computer", () => {
  test.skip(({ isMobile }) => isMobile, "Phones get the bar as a button above the tabs; see below.");

  test("the bar is at the bottom of every page but the AI page, and floats over the chats' messages", async ({ page }) => {
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

    // The chats have no band of their own for it (Samuel, November 26): it floats over their messages,
    // above their message box, and starts as the ✦ so the chat can be read. With no chat open, the ✦
    // sits where it does on any page.
    const project = await chatWithMessages(page, "AI bar chats");
    const bubble = page.getByRole("button", { name: "Ask AI Multi", exact: true });
    for (const path of ["/chats", `/chats?project=${project.id}`, `/projects/${project.id}/chat`]) {
      await page.goto(path);
      await expect(bubble, path).toBeVisible();
      await expect(bar(page), path).toHaveCount(0);
      await expect(chat(page), path).toHaveCount(0);
      const bubbleBox = (await bubble.boundingBox())!;
      if (path === "/chats") {
        expect(Math.round(page.viewportSize()!.height - (bubbleBox.y + bubbleBox.height)), path).toBe(24);
        continue;
      }
      // 24 px above the message box, and the latest message, scrolled to, stays clear of it.
      expect(Math.round((await messageBox(page).boundingBox())!.y - (bubbleBox.y + bubbleBox.height)), path).toBe(24);
      await expect.poll(async () => bottomOf(page.getByRole("article").filter({ hasText: "Update 8" })), path).toBeLessThan(bubbleBox.y);
    }

    // The ✦ brings the same bar as on any page, with the cursor in it: over the conversation, 24 px above its box.
    await bubble.click();
    const input = bar(page).getByRole("textbox", { name: "Ask AI Multi" });
    await expect(input).toBeFocused();
    await expect(bubble).toBeHidden();
    const chatsBox = (await messageBox(page).boundingBox())!;
    const barBox = (await bar(page).boundingBox())!;
    expect(Math.round(chatsBox.y - (barBox.y + barBox.height))).toBe(24);
    expect(Math.abs(middle(barBox).x - middle(chatsBox).x)).toBeLessThan(2);
    // Its ⌄ goes back to the ✦.
    await bar(page).getByRole("button", { name: "Minimize to a button" }).click();
    await expect(bubble).toBeVisible();
    await expect(bar(page)).toHaveCount(0);

    // The bar's ✦ opens the chat as on any page, also over the conversation, and Escape goes back to the bar.
    await bubble.click();
    await bar(page).getByRole("button", { name: "Open the AI chat" }).click();
    await expect(chat(page)).toBeVisible();
    await expect(chatBox(page)).toBeFocused();
    expect(Math.round(chatsBox.y - (await bottomOf(chat(page))))).toBe(24);
    await page.keyboard.press("Escape");
    await expect(chat(page)).toHaveCount(0);
    await expect(input).toBeFocused();

    // The bar stays until the person leaves the page. Minimizing there didn't change the setting, so
    // other pages still show the bar, and back on the chat it starts as the ✦ again.
    await page.locator("#app-sidebar").getByRole("link", { name: "Tasks", exact: true }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(bar(page)).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/chat$`));
    await expect(bubble).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
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
    // Under the box: the reminder on the left, today's allowance on the right (Samuel, November 21).
    const reminder = chat(page).getByText("Answers can be wrong. Nothing changes until you confirm it.");
    const left = chat(page).getByText("38 of 40 left today", { exact: true });
    await expect(reminder).toBeVisible();
    await expect(left).toBeVisible();
    const box = (await chatBox(page).locator("xpath=ancestor::form[1]").boundingBox())!;
    const reminderBox = (await reminder.boundingBox())!;
    const leftBox = (await left.boundingBox())!;
    expect(reminderBox.y).toBeGreaterThan(box.y + box.height - 1);
    expect(reminderBox.x - box.x).toBeLessThan(20);
    expect(box.x + box.width - (leftBox.x + leftBox.width)).toBeLessThan(20);
    expect(Math.abs(reminderBox.y - leftBox.y)).toBeLessThan(2);
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
    await page.keyboard.type("Hello there, is anything due this week for the launch website?");
    await page.keyboard.press("Enter");
    await expect(chat(page).getByText("You asked: Hello there")).toBeVisible();
    // Ctrl J inside the chat closes it, and the bar keeps the cursor.
    await chatBox(page).focus();
    await page.keyboard.press("Control+j");
    await expect(chat(page)).toHaveCount(0);
    await expect(bar(page).getByRole("textbox", { name: "Ask AI Multi" })).toBeFocused();

    // The chat's history lists the person's chats by day (#452).
    await page.keyboard.press("Control+j");
    await chat(page).getByRole("button", { name: "Chat history" }).click();
    await expect(chat(page).getByText("Your last 20 chats are kept. Delete any from its ⋯ menu.")).toBeVisible();
    const listed = chat(page).getByRole("list", { name: "Today" }).getByRole("button", { name: "Hello there" });
    await expect(listed).toHaveAttribute("aria-current", "true");
    // Its long title ends in an ellipsis inside the chat, never past its edge.
    await expect(listed).toHaveText("Hello there, is anything due this week for…");
    const cardBox = (await chat(page).boundingBox())!;
    const listedBox = (await listed.boundingBox())!;
    expect(listedBox.x + listedBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);

    // The shortcut is listed with the others.
    await page.keyboard.press("Escape");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" }).getByText("Ask AI Multi")).toBeVisible();
  });

  test("the chat's ⋯ menu renames and deletes a stored chat, and its history opens chats from before a reload (#452)", async ({ page }) => {
    await signUpAndLogIn(page, "E2E AI bar history");
    await agree(page);
    await page.goto("/tasks");
    await bar(page).getByRole("textbox", { name: "Ask AI Multi" }).fill("Draft the launch email");
    await bar(page).getByRole("textbox", { name: "Ask AI Multi" }).press("Enter");
    await expect(chat(page).getByText("You asked: Draft the launch email")).toBeVisible();

    await chat(page).getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const rename = page.getByRole("dialog", { name: "Rename chat" });
    await rename.getByRole("textbox", { name: "Chat name" }).fill("Launch email");
    await rename.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Chat renamed")).toBeVisible();
    await expect(chat(page).getByText("Launch email", { exact: true })).toBeVisible();

    // After a reload the chat is in the history, and opens with its conversation.
    await page.reload();
    await openWithShortcut(page);
    await chat(page).getByRole("button", { name: "Chat history" }).click();
    await chat(page).getByRole("list", { name: "Today" }).getByRole("button", { name: "Launch email" }).click();
    await expect(chat(page).getByText("You asked: Draft the launch email")).toBeVisible();

    await chat(page).getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Delete chat" }).click();
    await page.getByRole("dialog", { name: "Delete this chat?" }).getByRole("button", { name: "Delete chat" }).click();
    await expect(page.getByText("Chat deleted")).toBeVisible();
    await expect(chat(page).getByRole("button", { name: "What's overdue?" })).toBeVisible();
    await chat(page).getByRole("button", { name: "Chat history" }).click();
    await expect(chat(page).getByText("Your chats will show here.")).toBeVisible();
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

    // A stored chat is deleted from the full-screen chat's ⋯ menu too, its confirmation over the sheet (#452).
    await sheet.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Delete chat" }).click();
    await page.getByRole("dialog", { name: "Delete this chat?" }).getByRole("button", { name: "Delete chat" }).click();
    await expect(page.getByText("Chat deleted")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "What's overdue?" })).toBeVisible();
  });

  test("on the chats the ✦ button floats above their message box and opens the chat", async ({ page }) => {
    await signUpAndLogIn(page, "E2E AI bar phone chats");
    const project = await chatWithMessages(page, "AI bar phone chats");
    const button = page.getByRole("button", { name: "Ask AI Multi", exact: true });

    // The list: the ✦ 24 px above the tabs, without the bar.
    await page.goto("/chats");
    await expect(button).toBeVisible();
    await expect(page.getByRole("button", { name: /^Ask AI Multi: / })).toHaveCount(0);
    const tabs = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!;
    expect(Math.round(tabs.y - (await bottomOf(button)))).toBe(24);

    // A chat: 24 px above its message box, and the latest message, scrolled to, stays clear of it.
    await page.goto(`/chats?project=${project.id}`);
    await expect(button).toBeVisible();
    const buttonBox = (await button.boundingBox())!;
    expect(Math.round((await messageBox(page).boundingBox())!.y - (buttonBox.y + buttonBox.height))).toBe(24);
    await expect.poll(async () => bottomOf(page.getByRole("article").filter({ hasText: "Update 8" }))).toBeLessThan(buttonBox.y);

    // It opens the chat full screen, whose ⋯ menu has no bar to minimize to the ✦ here; closing it leaves the ✦.
    await button.click();
    const sheet = page.getByRole("dialog", { name: "AI chat" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menuitem", { name: "Hide from pages" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Minimize to a button" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "Hide from pages" })).toHaveCount(0);
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Collapse" }).click();
    await expect(sheet).toBeHidden();
    await expect(button).toBeVisible();
  });
});

// As on the AI page: the conversation's hidden labels ("You:", "AI Multi:") once escaped its scroller,
// here into the chat's frame, which then ran on below its own bottom edge. Only the conversation scrolls.
test("a long conversation scrolls inside the chat, not its frame (#566)", async ({ page, isMobile }) => {
  const { email } = await signUpAndLogIn(page, "E2E AI bar long chat");
  await storeAiChat(email, "A long chat", 20);
  await page.goto("/tasks");
  // The floating chat on a computer, the full-screen sheet on a phone.
  const frame = isMobile ? page.getByRole("dialog", { name: "AI chat" }) : chat(page);
  if (isMobile) await page.getByRole("button", { name: "Ask AI Multi: Create a task, ask, or create an event" }).click();
  else await openWithShortcut(page);
  await frame.getByRole("button", { name: "Chat history" }).click();
  await frame.getByRole("button", { name: "A long chat" }).click();
  await expect(frame.getByText("Answer 20", { exact: true })).toBeInViewport();

  const overflow = (locator: Locator) => locator.evaluate((element) => element.scrollHeight - element.clientHeight);
  expect(await overflow(frame.locator("[data-follows-end]"))).toBeGreaterThan(500);
  expect(await overflow(frame)).toBe(0);
});
