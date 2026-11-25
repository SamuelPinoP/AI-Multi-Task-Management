import { expect, test, type Locator } from "@playwright/test";
import { AI_NOTICE_VERSION } from "../../src/lib/ai/notice";
import { continueAsGuest, signUpAndLogIn, uniqueName } from "./helpers";

// A link longer than its line used to run out of its message, and the chat could then be dragged
// sideways to read the rest (#552): chat messages wrapped only at spaces, and the AI's answers sat in a
// column that grew to fit the link. Now a word too long for its line breaks across lines.

/** Longer than a computer's widest message, so it has to break there too. */
const link = `https://example.com/shared/${"a1B2c3D4e5F6g7H8i9J0".repeat(8)}#page=3093caf867`;

/**
 * How far the text reaches past the right edge of the box around it (0 or less is inside), how many
 * lines it takes, and how far the closest element that scrolls it could scroll sideways.
 */
function measure(text: Locator, box: string) {
  return text.evaluate((element, selector) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const words = range.getBoundingClientRect();
    const right = element.closest(selector)!.getBoundingClientRect().right;
    let scroller = element.parentElement;
    while (scroller && !["auto", "scroll"].includes(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    return {
      overhang: Math.round(words.right - right),
      lines: Math.round(words.height / parseFloat(getComputedStyle(element).lineHeight)),
      sideways: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
    };
  }, box);
}

test("a long link wraps inside its chat message, and the chat never scrolls sideways", async ({ page }) => {
  await continueAsGuest(page);
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("E2E long link") } })).json()) as { id: string };
  const message = `Have a look: ${link}`;
  expect((await page.request.post(`/api/projects/${project.id}/comments`, { data: { message } })).status()).toBe(201);

  await page.goto(`/projects/${project.id}/chat`);
  const text = page.getByText(message, { exact: true }).filter({ visible: true });
  await expect(text).toBeVisible();
  const chat = await measure(text, "article");
  expect(chat.overhang, "the link stays inside its message").toBeLessThanOrEqual(0);
  expect(chat.lines, "the link breaks across lines").toBeGreaterThan(2);
  expect(chat.sideways, "the chat has nothing to scroll sideways").toBeLessThanOrEqual(0);

  // The project page's discussion preview shows the message's first two lines, inside its card too.
  await page.goto(`/projects/${project.id}`);
  const preview = page.getByText(message, { exact: true }).filter({ visible: true });
  await expect(preview).toBeVisible();
  expect((await measure(preview, "article")).overhang, "the preview's link stays inside its card").toBeLessThanOrEqual(0);
});

test("a long link in the AI's answer wraps, and the AI chat never scrolls sideways", async ({ page }) => {
  await signUpAndLogIn(page, "E2E long link");
  expect((await page.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).status()).toBe(200);
  await page.goto("/ai");

  // The test server's AI answers with the question's first 200 characters: "You asked: …".
  const question = `What is at ${link}?`;
  await page.getByRole("textbox", { name: "Message the AI" }).fill(question);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const answer = page.getByRole("region", { name: "Conversation" }).getByText(`You asked: ${question.slice(0, 200)}`, { exact: true });
  await expect(answer).toBeVisible();
  const ai = await measure(answer, '[aria-label="Conversation"]');
  expect(ai.overhang, "the link stays inside the conversation").toBeLessThanOrEqual(0);
  expect(ai.lines, "the link breaks across lines").toBeGreaterThan(2);
  expect(ai.sideways, "the AI chat has nothing to scroll sideways").toBeLessThanOrEqual(0);
});
