import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { AI_NOTICE_VERSION } from "../../src/lib/ai/notice";
import { continueAsGuest, queryDatabase, signUpAndLogIn, uniqueName } from "./helpers";

// The AI page (#308), end to end against the real endpoint and database. The server runs with
// AI_PROVIDER="fake" (src/lib/ai/providers/fake.ts): a message naming a tool calls it, "[429]" fails
// like a rate limit, and anything else is answered "You asked: …". It runs on phones too.

const conversation = (page: Page) => page.getByRole("region", { name: "Conversation" });
const messageBox = (page: Page) => page.getByRole("textbox", { name: "Message the AI" });
/** The one control of several with this name that this screen size shows (the list's and the top bar's New chat). */
const shown = (locator: Locator) => locator.filter({ visible: true }).first();

/** Types a question and sends it with the button: on a touch screen Enter starts a new line (#303). */
async function ask(page: Page, question: string) {
  await messageBox(page).fill(question);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

async function openChats(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole("button", { name: "Your chats" }).click();
  return page.getByRole("region", { name: "Chats", exact: true });
}

async function agentRuns(email: string) {
  const { rows } = await queryDatabase<{ count: string }>(
    `SELECT count(*) FROM "AgentRun" r JOIN "User" u ON u.id = r."userId" WHERE u.email = $1`,
    [email],
  );
  return Number(rows[0].count);
}

test("a guest is told the assistant needs an account", async ({ page, playwright, baseURL }) => {
  await continueAsGuest(page);
  await page.goto("/ai");
  await expect(page.getByText("The AI assistant needs an account")).toBeVisible();
  await expect(messageBox(page)).toHaveCount(0);

  // The status the chat reads before a first question is for accounts only.
  expect((await page.request.get("/api/agent/status")).status()).toBe(403);
  const signedOut = await playwright.request.newContext({ baseURL });
  expect((await signedOut.get("/api/agent/status")).status()).toBe(401);
  await signedOut.dispose();
});

test("nothing is sent before the notice; agreeing sends the question, and the answer links to what it used", async ({ page, isMobile }) => {
  const { email } = await signUpAndLogIn(page, "E2E AI page");
  const task = uniqueName("E2E rotate the keys");
  expect((await page.request.post("/api/tasks", { data: { title: task } })).status()).toBe(201);

  // What the chat reads before a first question: no agreement yet, the full allowance, and who answers.
  const status = await page.request.get("/api/agent/status");
  expect(status.headers()["cache-control"]).toBe("no-store");
  expect(await status.json()).toMatchObject({ noticeAccepted: false, mode: "agent", allowance: { user: { used: 0, limit: 40, remaining: 40 } } });
  // On the free tier, the planner answers in the EEA, Switzerland and the UK (src/lib/ai/region.ts).
  const fromGermany = await page.request.get("/api/agent/status", { headers: { "x-vercel-ip-country": "DE" } });
  expect(await fromGermany.json()).toMatchObject({ mode: "planner", reason: "region" });

  await page.goto("/ai");
  await expect(page.getByText(/^40 of 40 left today/).filter({ visible: true })).toBeVisible();
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).not.toHaveClass(/\bai-send\b/);

  await messageBox(page).fill("What's on my plate? list_open_tasks");
  // Typed: the send button takes the accent's gradient.
  await expect(send).toHaveClass(/\bai-send\b/);
  await send.click();
  const notice = page.getByRole("region", { name: "Before your first question" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("sends your question and the items it looks up, such as task titles and dates, to Google Gemini");
  await expect(notice.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy#ai");
  expect(await agentRuns(email)).toBe(0);

  // Not now: nothing is sent, and the question goes back into the box.
  await notice.getByRole("button", { name: "Not now" }).click();
  await expect(notice).toBeHidden();
  await expect(messageBox(page)).toHaveValue("What's on my plate? list_open_tasks");
  expect(await agentRuns(email)).toBe(0);

  await send.click();
  await notice.getByRole("button", { name: "Agree and continue" }).click();
  await expect(conversation(page).getByText(`list_open_tasks found 1: ${task}`)).toBeVisible();
  await expect(conversation(page).getByText("Checked your open tasks")).toBeVisible();
  await expect(messageBox(page)).toHaveValue("");
  // A question with a lookup takes two of today's requests.
  await expect(page.getByText(/^38 of 40 left today/).filter({ visible: true })).toBeVisible();
  const { rows } = await queryDatabase<{ aiNoticeAcceptedAt: Date | null }>(`SELECT "aiNoticeAcceptedAt" FROM "User" WHERE email = $1`, [email]);
  expect(rows[0].aiNoticeAcceptedAt).not.toBeNull();
  expect(await agentRuns(email)).toBe(1);

  // The chat is listed under its first question.
  const chats = await openChats(page, isMobile);
  await expect(chats.getByRole("button", { name: "What's on my plate? list_open_tasks" })).toHaveAttribute("aria-current", "true");
  if (isMobile) await page.getByRole("button", { name: "Back to the chat" }).click();

  // The source opens the task, and the conversation is still there on the way back.
  const source = conversation(page).getByRole("list", { name: "Used to answer" }).getByRole("link", { name: task });
  await expect(source).toHaveAttribute("href", /^\/tasks\?task=/);
  await source.click();
  await expect(page).toHaveURL(/\/tasks\?task=/);
  await page.goBack();
  await expect(conversation(page).getByText(`list_open_tasks found 1: ${task}`)).toBeVisible();
});

test("a new chat starts empty, and the list switches between chats and finds them", async ({ page, isMobile }) => {
  await signUpAndLogIn(page, "E2E AI chats");
  expect((await page.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).status()).toBe(200);
  await page.goto("/ai");

  await page.getByRole("button", { name: "What analytics can you give?" }).click();
  await expect(conversation(page).getByText("You asked: What analytics can you give?")).toBeVisible();

  await shown(page.getByRole("button", { name: "New chat" })).click();
  await expect(page.getByRole("button", { name: "What's overdue?" })).toBeVisible();
  await expect(messageBox(page)).toBeFocused();
  await ask(page, "Is anything due this week for the launch website?");
  await expect(conversation(page).getByText("You asked: Is anything due this week for the launch website?")).toBeVisible();
  await expect(conversation(page).getByText("You asked: What analytics can you give?")).toHaveCount(0);

  let chats = await openChats(page, isMobile);
  await expect(chats.getByRole("listitem")).toHaveCount(2);
  // The latest first, named after its first question, cut at a word.
  const latest = chats.getByRole("listitem").first();
  await expect(latest).toHaveText("Is anything due this week for the launch…");
  // A long title ends in an ellipsis inside the list, never past its edge.
  const listBox = (await chats.boundingBox())!;
  const itemBox = (await latest.getByRole("button").boundingBox())!;
  expect(itemBox.x + itemBox.width).toBeLessThanOrEqual(listBox.x + listBox.width);
  await chats.getByRole("button", { name: "What analytics can you give?" }).click();
  await expect(conversation(page).getByText("You asked: What analytics can you give?")).toBeVisible();
  await expect(conversation(page).getByText("You asked: Is anything due this week for the launch website?")).toHaveCount(0);

  chats = await openChats(page, isMobile);
  await chats.getByRole("searchbox", { name: "Search chats" }).fill("due this");
  await expect(chats.getByRole("listitem")).toHaveCount(1);
  await chats.getByRole("searchbox", { name: "Search chats" }).fill("nothing like it");
  await expect(chats.getByText("No chats match.")).toBeVisible();
});

test("when the model is busy or today's allowance is used up, the planner answers and says why", async ({ page }) => {
  const { email } = await signUpAndLogIn(page, "E2E AI planner");
  const task = uniqueName("E2E planner task");
  expect((await page.request.post("/api/tasks", { data: { title: task } })).status()).toBe(201);
  expect((await page.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).status()).toBe(200);
  await page.goto("/ai");

  await ask(page, "[429] What should I do first?");
  await expect(conversation(page).getByText(/^The AI service is busy right now\./)).toBeVisible();
  await expect(conversation(page).getByText(new RegExp(`${task}: `))).toBeVisible();

  const filler = `e2e-ai-page-${randomUUID()}`;
  await queryDatabase(
    `INSERT INTO "AgentRun" (id, "userId", outcome, "modelRequests", "latencyMs", "createdAt")
     SELECT $1, id, 'ANSWERED', 100, 0, now() AT TIME ZONE 'utc' FROM "User" WHERE email = $2`,
    [filler, email],
  );
  try {
    await page.reload();
    await expect(page.getByText(/^0 of 40 left today/).filter({ visible: true })).toBeVisible();
    await ask(page, "list_open_tasks");
    await expect(conversation(page).getByText(/^You've used today's AI allowance of 40 requests\. It resets in about \d+ hours?\./)).toBeVisible();
    await expect(conversation(page).getByText(new RegExp(`${task}: `))).toBeVisible();
    // The planner looked nothing up through the model.
    await expect(conversation(page).getByText("Checked your open tasks")).toHaveCount(0);
  } finally {
    await queryDatabase(`DELETE FROM "AgentRun" WHERE id = $1`, [filler]);
  }
});

test("an answer that couldn't arrive can be asked again", async ({ page, context }) => {
  await signUpAndLogIn(page, "E2E AI offline");
  expect((await page.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).status()).toBe(200);
  await page.goto("/ai");
  await expect(page.getByText(/^40 of 40 left today/).filter({ visible: true })).toBeVisible();

  await context.setOffline(true);
  await ask(page, "Are you there?");
  await expect(conversation(page).getByText("Couldn't reach AI Multi. Check your connection and try again.")).toBeVisible();
  await context.setOffline(false);
  await conversation(page).getByRole("button", { name: "Try again" }).click();
  await expect(conversation(page).getByText("You asked: Are you there?")).toBeVisible();
  await expect(conversation(page).getByText("Couldn't reach AI Multi.", { exact: false })).toHaveCount(0);
  // The question shows once.
  await expect(conversation(page).getByText("You: Are you there?", { exact: true })).toHaveCount(1);
});

test("the chats list resizes from 220 to 360 px, like the sidebar, and keeps its width", async ({ page, isMobile }) => {
  test.skip(isMobile, "Phones show the list full screen.");
  await signUpAndLogIn(page, "E2E AI resize");
  await page.goto("/ai");
  const edge = page.getByRole("separator", { name: "Resize your chats" });
  const list = page.locator("#ai-chats");
  await expect(edge).toHaveAttribute("aria-valuenow", "264");
  expect(Math.round((await list.boundingBox())!.width)).toBe(264);

  await edge.focus();
  await page.keyboard.press("End");
  await expect(edge).toHaveAttribute("aria-valuenow", "360");
  await page.reload();
  await expect(edge).toHaveAttribute("aria-valuenow", "360");
  expect(Math.round((await list.boundingBox())!.width)).toBe(360);

  // It never collapses: Home and a drag far to the left stop at 220 px.
  await edge.focus();
  await page.keyboard.press("Home");
  await expect(edge).toHaveAttribute("aria-valuenow", "220");
  const box = (await edge.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 300, box.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect(edge).toHaveAttribute("aria-valuenow", "220");
  await expect(list).toBeVisible();

  // Double-click brings back 264 px.
  await edge.dblclick();
  await expect(edge).toHaveAttribute("aria-valuenow", "264");
});
