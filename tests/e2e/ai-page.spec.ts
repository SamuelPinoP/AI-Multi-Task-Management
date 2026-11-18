import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { AI_NOTICE_VERSION } from "../../src/lib/ai/notice";
import { continueAsGuest, queryDatabase, signUpAndLogIn, uniqueName } from "./helpers";

// The AI page (#308) and its stored chats (#452), end to end against the real endpoint and database.
// The server runs with AI_PROVIDER="fake" (src/lib/ai/providers/fake.ts): a message naming a tool
// calls it, "[429]" fails like a rate limit, "[history]" lists the earlier messages it was given, and
// anything else is answered "You asked: …". It runs on phones too.

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
  // The sign-up pop-up opens as if the AI had been clicked (#458); behind it, what the AI answers.
  await expect(page.getByRole("dialog", { name: "The AI needs a free account" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Ask AI Multi about your work")).toBeVisible();
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

test("chats are kept after a reload: the list groups them by day, and an opened chat carries on where it was (#452)", async ({ page, isMobile }) => {
  const { email } = await signUpAndLogIn(page, "E2E AI history");
  expect((await page.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).status()).toBe(200);
  // A chat from three days ago whose answer came from the planner, made directly in the database.
  const old = `e2e-ai-history-${randomUUID()}`;
  await queryDatabase(
    `WITH chat AS (
       INSERT INTO "AgentChat" (id, "userId", title, "createdAt", "updatedAt", "openedAt")
       SELECT $1, id, 'Plan for the offsite', t, t, t FROM "User", (SELECT (now() AT TIME ZONE 'utc') - interval '3 days' AS t) AS at WHERE email = $2
       RETURNING id, "createdAt"
     )
     INSERT INTO "AgentChatMessage" (id, "chatId", role, content, "createdAt")
     SELECT $1 || '-q', id, 'USER'::"AgentChatRole", 'Plan for the offsite', "createdAt" FROM chat
     UNION ALL SELECT $1 || '-a', id, 'PLANNER'::"AgentChatRole", '- Book the venue: Due Friday', "createdAt" + interval '1 second' FROM chat`,
    [old, email],
  );

  await page.goto("/ai");
  await ask(page, "Remember the launch checklist");
  await expect(conversation(page).getByText("You asked: Remember the launch checklist")).toBeVisible();

  await page.reload();
  let chats = await openChats(page, isMobile);
  await expect(chats.getByRole("list", { name: "Today" }).getByRole("listitem")).toHaveText(["Remember the launch checklist"]);
  await expect(chats.getByRole("list", { name: "Previous 7 days" }).getByRole("listitem")).toHaveText(["Plan for the offsite"]);
  await expect(chats.getByText("Your last 20 chats are kept.")).toBeVisible();

  // The planner's stored answer says who gave it.
  await chats.getByRole("button", { name: "Plan for the offsite" }).click();
  await expect(conversation(page).getByRole("listitem").filter({ hasText: "Book the venue: Due Friday" })).toBeVisible();
  await expect(conversation(page).getByText("Your planner answered this one instead of the AI.")).toBeVisible();

  // Opening a stored chat and asking again continues it, with the earlier messages from the server.
  chats = await openChats(page, isMobile);
  await chats.getByRole("button", { name: "Remember the launch checklist" }).click();
  await expect(conversation(page).getByText("You asked: Remember the launch checklist")).toBeVisible();
  await ask(page, "[history] What came before?");
  await expect(
    conversation(page).getByText("Earlier messages: user: Remember the launch checklist | assistant: You asked: Remember the launch checklist"),
  ).toBeVisible();
  // Still one chat, now the newest.
  chats = await openChats(page, isMobile);
  await expect(chats.getByRole("list", { name: "Today" }).getByRole("listitem")).toHaveText(["Remember the launch checklist"]);
});

test("a chat is renamed and deleted from its ⋯ menu, and every chat with Delete all chats (#452)", async ({ page, isMobile }) => {
  await signUpAndLogIn(page, "E2E AI tidy");
  expect((await page.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).status()).toBe(200);
  await page.goto("/ai");
  await expect(page.getByRole("button", { name: "Chat options" })).toHaveCount(0);
  await ask(page, "First question");
  await expect(conversation(page).getByText("You asked: First question")).toBeVisible();

  // Rename: the header and the list take the new name, and it's kept.
  await page.getByRole("button", { name: "Chat options" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename chat" });
  await expect(rename.getByRole("textbox", { name: "Chat name" })).toHaveValue("First question");
  await rename.getByRole("textbox", { name: "Chat name" }).fill("Launch week");
  await rename.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Chat renamed")).toBeVisible();
  await expect(rename).toBeHidden();
  await expect(page.getByRole("region", { name: "Conversation" }).getByText("Launch week", { exact: true }).filter({ visible: true })).toBeVisible();
  await page.reload();
  let chats = await openChats(page, isMobile);
  await expect(chats.getByRole("button", { name: "Launch week" })).toBeVisible();

  // Delete one: it leaves the list, and a new chat opens.
  await chats.getByRole("button", { name: "Launch week" }).click();
  await expect(conversation(page).getByText("You asked: First question")).toBeVisible();
  await page.getByRole("button", { name: "Chat options" }).click();
  await page.getByRole("menuitem", { name: "Delete chat" }).click();
  const confirmOne = page.getByRole("dialog", { name: "Delete this chat?" });
  await expect(confirmOne).toContainText("“Launch week” and its messages will be deleted for good.");
  await confirmOne.getByRole("button", { name: "Delete chat" }).click();
  await expect(page.getByText("Chat deleted")).toBeVisible();
  await expect(page.getByRole("button", { name: "What's overdue?" })).toBeVisible();
  chats = await openChats(page, isMobile);
  await expect(chats.getByText("Your chats will show here.")).toBeVisible();
  await expect(chats.getByRole("button", { name: "Delete all chats" })).toHaveCount(0);
  if (isMobile) await page.getByRole("button", { name: "Back to the chat" }).click();

  // Delete all, after two more.
  await ask(page, "Second question");
  await expect(conversation(page).getByText("You asked: Second question")).toBeVisible();
  await shown(page.getByRole("button", { name: "New chat" })).click();
  await ask(page, "Third question");
  await expect(conversation(page).getByText("You asked: Third question")).toBeVisible();
  chats = await openChats(page, isMobile);
  await chats.getByRole("button", { name: "Delete all chats" }).click();
  const confirmAll = page.getByRole("dialog", { name: "Delete all chats?" });
  await expect(confirmAll).toContainText("Every chat in your list will be deleted for good.");
  await confirmAll.getByRole("button", { name: "Delete all chats" }).click();
  await expect(page.getByText("All chats deleted")).toBeVisible();
  await page.reload();
  chats = await openChats(page, isMobile);
  await expect(chats.getByText("Your chats will show here.")).toBeVisible();
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
