import { expect, test, type APIResponse, type BrowserContext, type Page } from "@playwright/test";
import { signUpAndLogIn, uniqueName } from "./helpers";

// #409: search inside a chat (newest match first, the chat shown at each one) and the
// button that brings a reader who scrolled up back to the latest message.
test.describe.configure({ mode: "serial" });

const OLDEST = "Kickoff notes: the launch date is set, the launch party comes later.";
const CAFE = "Meet at the Café at noon.";
const MIDDLE = "Heads up: legal wants the terms live before the LAUNCH.";
const NEWEST = "Then we're go for launch on Friday.";
const LAST = "Booking the room for Friday.";

const contexts: BrowserContext[] = [];
let owner: Page;
let teammate: Page;
let ownerName = "";
let teammateName = "";
let teammateId = "";
let projectId = "";
let projectName = "";

async function ok<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.url()} -> ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

async function postMessage(page: Page, message: string) {
  await ok(await page.request.post(`/api/projects/${projectId}/comments`, { multipart: { message } }));
}

function conversation(page: Page) {
  return page.getByRole("region", { name: "Conversation" });
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(180_000);
  const accounts: { page: Page; name: string; email: string }[] = [];
  for (const label of ["E2E search owner", "E2E search teammate"]) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    const { name, email } = await signUpAndLogIn(page, label);
    accounts.push({ page, name, email });
  }
  [owner, teammate] = accounts.map((account) => account.page);
  [ownerName, teammateName] = accounts.map((account) => account.name);

  projectName = uniqueName("Search project");
  projectId = (await ok<{ id: string }>(await owner.request.post("/api/projects", { data: { name: projectName } }))).id;
  await ok(await owner.request.post(`/api/projects/${projectId}/invitations`, { data: { email: accounts[1].email, role: "EDITOR" } }));
  const invitations = await ok<Array<{ id: string; project: { id: string } }>>(await teammate.request.get("/api/project-invitations"));
  await ok(await teammate.request.patch(`/api/project-invitations/${invitations.find((item) => item.project.id === projectId)!.id}`, { data: { action: "ACCEPT" } }));
  const details = await ok<{ members: { user: { id: string; email: string } | null }[] }>(await owner.request.get(`/api/projects/${projectId}`));
  teammateId = details.members.find((member) => member.user?.email === accounts[1].email)!.user!.id;

  // Enough messages between the matches that the chat scrolls.
  const filler = (from: number) => Array.from({ length: 8 }, (_, index) => `Update ${from + index}: nothing new.`);
  const script: Array<[Page, string]> = [
    [teammate, OLDEST],
    ...filler(1).map((text): [Page, string] => [owner, text]),
    [owner, CAFE],
    ...filler(9).map((text): [Page, string] => [teammate, text]),
    [teammate, MIDDLE],
    ...filler(17).map((text): [Page, string] => [owner, text]),
    [owner, NEWEST],
    [teammate, LAST],
  ];
  for (const [page, text] of script) await postMessage(page, text);
});

test.afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
});

test("search finds every match, newest first, and shows the chat at the one picked", async ({ isMobile }) => {
  // On desktop the Chats list sits beside the open chat (#416), so the chat is wide enough for the results
  // beside it (52 rem) on a wide screen: 1440 - 224 (sidebar) - 310 (list) = 906 px.
  if (!isMobile) await owner.setViewportSize({ width: 1440, height: 900 });
  await owner.goto(`/chats?project=${projectId}`);
  const chat = conversation(owner);
  await expect(chat.getByRole("heading", { name: projectName })).toBeVisible();
  const button = chat.getByRole("button", { name: "Search in this chat" });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const field = owner.getByRole("combobox", { name: "Search in this chat" });
  await expect(field).toBeFocused();

  await field.fill("launch");
  await expect(owner.getByRole("status").filter({ hasText: "newest first" })).toHaveText("3 messages · newest first");
  const options = owner.getByRole("listbox", { name: "Messages found" }).getByRole("option");
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toContainText(NEWEST);
  await expect(options.nth(0)).toContainText(ownerName);
  await expect(options.nth(0)).toContainText("You");
  await expect(options.nth(1)).toContainText(MIDDLE);
  await expect(options.nth(1)).toContainText(teammateName);
  await expect(options.nth(2)).toContainText(OLDEST);
  // The newest match, the one closest to the bottom, comes first.
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  const picked = chat.locator("article[aria-current='true']");

  if (isMobile) {
    // On a phone the results take the chat's place; picking one shows the chat at its message.
    await options.nth(1).click();
    await expect(picked).toContainText(MIDDLE);
    await expect(picked).toBeInViewport({ ratio: 1 });
    await expect(picked.locator("mark")).toHaveText(["LAUNCH"]);
    await chat.getByRole("button", { name: "Back to 3 results" }).click();
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  } else {
    // On a wide screen the chat stays beside the results, at the picked message, outlined and marked.
    await expect(picked).toContainText(NEWEST);
    await expect(picked).toBeInViewport({ ratio: 1 });
    // Every match in the chat is marked.
    await expect(chat.locator("article mark")).toHaveCount(4);
    // ↓ or Enter go to the next older match, ↑ or Shift+Enter to the newer one.
    await field.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(picked).toContainText(MIDDLE);
    await expect(picked).toBeInViewport({ ratio: 1 });
    await field.press("Enter");
    await expect(picked).toContainText(OLDEST);
    await expect(picked.locator("mark")).toHaveText(["launch", "launch"]);
    await field.press("Shift+Enter");
    await field.press("ArrowUp");
    await expect(picked).toContainText(NEWEST);
    // Clicking a result takes the chat to its message.
    await options.nth(2).click();
    await expect(picked).toContainText(OLDEST);
    await expect(picked).toBeInViewport({ ratio: 1 });
  }

  // Case and accents don't matter.
  await field.fill("CAFE");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText(CAFE);
  await field.fill("zebra");
  await expect(owner.getByText("No messages match “zebra”.")).toBeVisible();
  await expect(options).toHaveCount(0);

  // Esc closes search and takes the marks away.
  await field.fill("launch");
  await expect(options).toHaveCount(3);
  await field.press("Escape");
  await expect(field).toBeHidden();
  await expect(chat.locator("mark")).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(button).toBeFocused();
});

test("Ctrl+F opens search in an open chat", async ({ isMobile }) => {
  test.skip(isMobile, "phones have no keyboard shortcuts");
  await owner.goto(`/chats?project=${projectId}`);
  await expect(conversation(owner).getByRole("heading", { name: projectName })).toBeVisible();
  const field = owner.getByRole("combobox", { name: "Search in this chat" });
  // Pressed again until the page has hydrated and listens.
  await expect(async () => {
    await owner.keyboard.press("Control+f");
    await expect(field).toBeFocused({ timeout: 1_000 });
  }).toPass();
});

test("scrolled up, a button brings the reader back to the latest message and counts what's new", async () => {
  await owner.goto(`/chats?project=${projectId}`);
  const chat = conversation(owner);
  await expect(chat.getByText(LAST)).toBeVisible();
  const jump = chat.getByRole("button", { name: /^Jump to the latest message/ });
  await expect(jump).toHaveCount(0);

  await chat.getByText(OLDEST).scrollIntoViewIfNeeded();
  await expect(jump).toBeVisible();
  // A teammate writes meanwhile; the open chat checks every 7 seconds.
  const fresh = "Fresh news while you were reading.";
  await postMessage(teammate, fresh);
  await expect(chat.getByRole("button", { name: "Jump to the latest message, 1 new" })).toBeVisible({ timeout: 20_000 });

  await jump.click();
  await expect(chat.getByText(fresh)).toBeInViewport();
  await expect(jump).toHaveCount(0);
});

test("direct chats and the project's own chat page have search too", async () => {
  await owner.goto(`/chats?person=${teammateId}`);
  const chat = conversation(owner);
  await expect(chat.getByRole("heading", { name: teammateName })).toBeVisible();
  await expect(chat.getByRole("button", { name: "Search in this chat" })).toBeVisible();
  // Direct chats have nothing to put in ⋯ (#408).
  await expect(chat.getByRole("button", { name: "More", exact: true })).toHaveCount(0);

  await owner.goto(`/projects/${projectId}/chat`);
  await expect(owner.getByRole("heading", { level: 1, name: projectName })).toBeVisible();
  await owner.getByRole("button", { name: "Search in this chat" }).click();
  await owner.getByRole("combobox", { name: "Search in this chat" }).fill("café");
  await expect(owner.getByRole("option")).toHaveCount(1);
  await expect(owner.getByRole("option")).toContainText(CAFE);
});
