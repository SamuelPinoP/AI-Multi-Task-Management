import { expect, test, type Locator, type Page } from "@playwright/test";
import { AI_NOTICE_VERSION } from "../../src/lib/ai/notice";
import { continueAsGuest, signUpAndLogIn, storeAiChat, uniqueName } from "./helpers";

// The message boxes grow with their text like WhatsApp's (#569): a line at a time, on the keystroke
// that moves a word to a new line, up to a limit, then they scroll inside. The chats' box, the AI's
// chat (the floating chat on a computer, the AI page) and the AI bar at the bottom of the pages.
//
// Headless Chromium hides scrollbars. Real ones take 15 px from the text on Windows, and that's what
// kept the old boxes a line short with their first line hidden, so these tests show them.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

// Long enough to wrap two or three times in the widest box, the chats' on a computer.
const MESSAGE =
  "Please create a task to review the launch plan with the team on Friday, then draft the release notes, " +
  "check the open bugs on the board and move the ones we can't fix to next week. After that, send a short " +
  "summary to everyone who joined the planning call so they know what changed, what is next and who owns " +
  "each part, and remind me on Monday morning to look at the answers before the weekly meeting starts.";

const bar = (page: Page) => page.getByRole("form", { name: "Ask AI Multi" });
const chat = (page: Page) => page.getByRole("region", { name: "AI chat" });

async function agree(page: Page) {
  expect((await page.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).status()).toBe(200);
}

/** The box's height and limit, its line height and padding, and whether text runs past its bottom edge. */
function measure(box: Locator) {
  return box.evaluate((element: HTMLTextAreaElement) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      limit: parseFloat(style.maxHeight),
      lineHeight: parseFloat(style.lineHeight),
      padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      scrolls: element.scrollHeight > element.clientHeight + 1,
    };
  });
}

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `Line ${index + 1}`).join("\n");
}

/** How far above the AI bar the page ends: main's bottom padding less the bar and the space below it. */
async function pageEndGap(page: Page) {
  const padding = await page.locator("#main-content").evaluate((main) => parseFloat(getComputedStyle(main).paddingBottom));
  const top = (await bar(page).boundingBox())!.y;
  return Math.round(padding - (page.viewportSize()!.height - top));
}

/**
 * Types `text` a letter at a time, as a person does, checking the box after every key: below its
 * limit, every line shows and nothing scrolls. It must grow one line at a time, at least twice.
 */
async function typeWatching(page: Page, box: Locator, text: string) {
  const empty = await measure(box);
  const heights = [empty.height];
  for (let index = 0; index < text.length; index += 1) {
    await page.keyboard.type(text[index]);
    const size = await measure(box);
    if (size.height < size.limit - 1) expect(size.scrolls, `a line was hidden after typing "…${text.slice(Math.max(0, index - 24), index + 1)}"`).toBe(false);
    if (Math.abs(size.height - heights.at(-1)!) > 0.5) heights.push(size.height);
  }
  expect(heights.length, "the box grew at least twice").toBeGreaterThanOrEqual(3);
  heights.forEach((height, index) => expect(height, `${index + 1} lines`).toBeCloseTo(empty.height + index * empty.lineHeight, 0));
  return empty;
}

test("the chats' box grows on the keystroke a word wraps, without hiding a line, up to its limit", async ({ page, isMobile }) => {
  await continueAsGuest(page);
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("E2E boxes") } })).json()) as { id: string };
  await page.goto(`/projects/${project.id}/chat`);
  const box = page.getByPlaceholder("Type here", { exact: true });
  await box.click();
  const empty = await typeWatching(page, box, MESSAGE);

  // 6 lines on a phone and 10 on a computer, at most 40% of the screen, as before (#304).
  await box.fill(lines(20));
  const limit = Math.min((isMobile ? 6 : 10) * empty.lineHeight + empty.padding, 0.4 * page.viewportSize()!.height);
  await expect.poll(async () => (await measure(box)).height).toBeCloseTo(limit, 0);
  expect((await measure(box)).scrolls).toBe(true);
});

test.describe("on a computer", () => {
  test.skip(({ isMobile }) => isMobile, "Phones get the AI page's box; see below.");

  test("the AI chat's box grows a line at a time and keeps the newest answer in view, then stops at 8 lines and scrolls", async ({ page }) => {
    const { email } = await signUpAndLogIn(page, "E2E AI box");
    await agree(page);
    await storeAiChat(email, "A long chat", 20);
    await page.goto("/tasks");
    await bar(page).getByRole("button", { name: "Open the AI chat" }).click();
    await chat(page).getByRole("button", { name: "Chat history" }).click();
    await chat(page).getByRole("button", { name: "A long chat" }).click();
    const newest = chat(page).getByText("Answer 20", { exact: true });
    await expect(newest).toBeInViewport({ ratio: 1 });

    const box = chat(page).getByRole("textbox", { name: "Message the AI" });
    await box.click();
    const empty = await typeWatching(page, box, MESSAGE);
    // The conversation gets shorter as the box grows, and stays at its end.
    await expect(newest).toBeInViewport({ ratio: 1 });

    await box.fill(lines(20));
    const limit = Math.min(8 * empty.lineHeight + empty.padding, 0.4 * page.viewportSize()!.height);
    await expect.poll(async () => (await measure(box)).height).toBeCloseTo(limit, 0);
    expect((await measure(box)).scrolls).toBe(true);
    await expect(newest).toBeInViewport({ ratio: 1 });

    // Deleting shrinks it again, and sending empties it back to one line.
    await box.fill(lines(2));
    await expect.poll(async () => (await measure(box)).height).toBeCloseTo(empty.height + empty.lineHeight, 0);
    expect((await measure(box)).scrolls).toBe(false);
    await box.press("Enter");
    await expect(box).toHaveValue("");
    await expect.poll(async () => (await measure(box)).height).toBeCloseTo(empty.height, 0);
  });

  test("the bar grows upward with a long message, pages ending above it, its buttons beside the last line; Shift+Enter starts a line and Enter sends", async ({ page }) => {
    await signUpAndLogIn(page, "E2E AI bar box");
    await agree(page);
    await page.goto("/tasks");
    const box = bar(page).getByRole("textbox", { name: "Ask AI Multi" });
    await expect(box).toBeVisible();
    // One line is as tall as the bar always was, and pages end 16 px above it.
    expect(Math.round((await bar(page).boundingBox())!.height)).toBe(56);
    await expect.poll(() => pageEndGap(page)).toBe(16);

    await box.click();
    const empty = await typeWatching(page, box, MESSAGE);
    // It grew upward: still 24 px above the bottom of the page, with every button beside the last line.
    const barBounds = (await bar(page).boundingBox())!;
    expect(Math.round(page.viewportSize()!.height - (barBounds.y + barBounds.height))).toBe(24);
    const boxBounds = (await box.boundingBox())!;
    const lastLine = boxBounds.y + boxBounds.height - empty.padding / 2 - empty.lineHeight / 2;
    for (const name of ["Open the AI chat", "Send", "Minimize to a button"]) {
      const button = (await bar(page).getByRole("button", { name, exact: true }).boundingBox())!;
      expect(Math.abs(button.y + button.height / 2 - lastLine), name).toBeLessThanOrEqual(2);
    }
    // The space pages end with grew as much, so a draft left in the bar hides nothing for good.
    await expect.poll(() => pageEndGap(page)).toBe(16);

    await box.fill(lines(20));
    const limit = Math.min(8 * empty.lineHeight + empty.padding, 0.4 * page.viewportSize()!.height);
    await expect.poll(async () => (await measure(box)).height).toBeCloseTo(limit, 0);
    expect((await measure(box)).scrolls).toBe(true);
    await expect.poll(() => pageEndGap(page)).toBe(16);

    // As in the chat's box: Shift+Enter starts a new line, and Enter sends and opens the chat.
    await box.fill("First line");
    await box.press("Shift+Enter");
    await page.keyboard.type("second line");
    await expect(box).toHaveValue("First line\nsecond line");
    await box.press("Enter");
    await expect(chat(page)).toBeVisible();
    await expect(chat(page).getByText("second line").first()).toBeVisible();
    await expect(chat(page).getByRole("textbox", { name: "Message the AI" })).toHaveValue("");
    // The chat took the bar's place, and pages end where they did with one line.
    await expect.poll(() => page.locator("#main-content").evaluate((main) => getComputedStyle(main).paddingBottom)).toBe("96px");
  });
});

test.describe("on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "Computers get the floating chat and the bar; see above.");

  test("the AI page's box grows a line at a time up to 6 lines, then scrolls", async ({ page }) => {
    await signUpAndLogIn(page, "E2E AI box phone");
    await agree(page);
    await page.goto("/ai");
    const box = page.getByRole("textbox", { name: "Message the AI" });
    await box.click();
    // The empty box is one line, its hint cut short rather than wrapped.
    const before = await measure(box);
    expect(before.height).toBeCloseTo(before.lineHeight + before.padding, 0);
    const empty = await typeWatching(page, box, MESSAGE.slice(0, 120));

    await box.fill(lines(20));
    const limit = Math.min(6 * empty.lineHeight + empty.padding, 0.4 * page.viewportSize()!.height);
    await expect.poll(async () => (await measure(box)).height).toBeCloseTo(limit, 0);
    expect((await measure(box)).scrolls).toBe(true);
  });
});
