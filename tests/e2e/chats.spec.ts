import { expect, test, type APIResponse, type BrowserContext, type Page } from "@playwright/test";
import { signUpAndLogIn, uniqueName } from "./helpers";

// An owner and a teammate share a project; each one's messages are unread for the other.
test.describe.configure({ mode: "serial" });

const contexts: BrowserContext[] = [];
let owner: Page;
let teammate: Page;
let ownerEmail = "";
let projectId = "";
let projectName = "";

async function ok<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.url()} -> ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

async function postMessage(page: Page, message: string) {
  await ok(await page.request.post(`/api/projects/${projectId}/comments`, { multipart: { message } }));
}

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Workspace" });
}

/** The project's row on the Chats page; its name is its visible text, ending in "N unread messages" when there are some. */
function chatRow(page: Page) {
  return page.getByRole("list", { name: "Project chats" }).getByRole("link", { name: new RegExp(`^${projectName}`) });
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(120_000);
  const accounts: Array<{ page: Page; email: string }> = [];
  for (const label of ["E2E chat owner", "E2E chat teammate"]) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    const { email } = await signUpAndLogIn(page, label);
    accounts.push({ page, email });
  }
  owner = accounts[0].page;
  ownerEmail = accounts[0].email;
  teammate = accounts[1].page;

  projectName = uniqueName("Chats hub project");
  projectId = (await ok<{ id: string }>(await owner.request.post("/api/projects", { data: { name: projectName } }))).id;
  await ok(await owner.request.post(`/api/projects/${projectId}/invitations`, { data: { email: accounts[1].email, role: "EDITOR" } }));
  const invitations = await ok<Array<{ id: string; project: { id: string } }>>(await teammate.request.get("/api/project-invitations"));
  const invitation = invitations.find((item) => item.project.id === projectId);
  expect(invitation, "the teammate sees the invitation").toBeTruthy();
  await ok(await teammate.request.patch(`/api/project-invitations/${invitation!.id}`, { data: { action: "ACCEPT" } }));
});

test.afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
});

test("unread messages are counted, shown first and cleared when the chat is opened", async () => {
  await postMessage(owner, "Homepage copy is ready for review.");
  await postMessage(owner, "Can we lock it by Thursday?");

  await teammate.goto("/chats");
  await expect(teammate.getByRole("heading", { level: 1, name: "Chats" })).toBeVisible();
  await expect(sidebar(teammate).getByRole("link", { name: "Chats, 1 with new messages" })).toBeVisible();
  const row = chatRow(teammate);
  await expect(row).toHaveAccessibleName(/2 unread messages$/);

  // The Unread chip keeps it (no counts on the chips, #387). Under Projects the search looks for
  // projects: another name hides it, the start of its own finds it.
  await teammate.getByRole("button", { name: "Unread", exact: true }).click();
  await expect(row).toBeVisible();
  await teammate.getByRole("button", { name: "Projects", exact: true }).click();
  await teammate.getByLabel("Search projects").fill("nothing matches this");
  await expect(row).toBeHidden();
  await teammate.getByLabel("Search projects").fill(projectName.slice(0, 12));
  await expect(row).toBeVisible();

  await row.click();
  await expect(teammate).toHaveURL(new RegExp(`/chats\\?project=${projectId}$`));
  const conversation = teammate.getByRole("region", { name: "Conversation" });
  await expect(conversation.getByRole("heading", { name: projectName })).toBeVisible();
  await expect(conversation.getByRole("separator", { name: "New messages" })).toBeVisible();
  await expect(conversation.getByText("Homepage copy is ready for review.")).toBeVisible();

  // On desktop the list stays beside the open chat (#416). Opening it marked it read: the list and the
  // sidebar stop counting it, and it stays under Unread until a reload.
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAccessibleName(/unread/);
  await expect(teammate.getByRole("button", { name: "Unread", exact: true })).toBeVisible();
  await expect(sidebar(teammate).getByRole("link", { name: "Chats", exact: true })).toBeVisible();

  // A reload starts from the new read mark: no "New messages" line any more.
  await teammate.reload();
  await expect(conversation.getByText("Homepage copy is ready for review.")).toBeVisible();
  await expect(conversation.getByRole("separator", { name: "New messages" })).toHaveCount(0);
});

test("a reply is unread for the owner until they open the project chat", async () => {
  await postMessage(teammate, "Yes, Thursday works for me.");

  await owner.goto(`/projects/${projectId}`);
  const chatLink = sidebar(owner).getByRole("group", { name: `${projectName} pages` }).getByRole("link", { name: "Chat, 1 unread" });
  await expect(chatLink).toBeVisible();

  await chatLink.click();
  await expect(owner).toHaveURL(new RegExp(`/projects/${projectId}/chat$`));
  await expect(owner.getByRole("separator", { name: "New messages" })).toBeVisible();
  await expect(sidebar(owner).getByRole("group", { name: `${projectName} pages` }).getByRole("link", { name: "Chat", exact: true })).toBeVisible();

  // Posting counts as reading: the owner's own message never shows as unread.
  await postMessage(owner, "Great, see you then.");
  await owner.goto("/chats");
  await expect(chatRow(owner)).toBeVisible();
  await expect(chatRow(owner)).not.toHaveAccessibleName(/unread/);
});

test("a message that arrives while the chat is open counts as read", async () => {
  test.setTimeout(60_000);
  await teammate.goto(`/chats?project=${projectId}`);
  const conversation = teammate.getByRole("region", { name: "Conversation" });
  await expect(conversation.getByRole("heading", { name: projectName })).toBeVisible();

  const message = uniqueName("Arrives while open");
  await postMessage(owner, message);
  // The open chat picks it up on its next refresh (every few seconds while visible).
  await expect(conversation.getByText(message)).toBeVisible({ timeout: 20_000 });

  await teammate.goto("/chats");
  await expect(chatRow(teammate)).toBeVisible();
  await expect(chatRow(teammate)).not.toHaveAccessibleName(/unread/);
});

test("on desktop the list stays beside the open chat, resizes from its edge, shrinks to photos and is remembered", async () => {
  // A second chat with a message the owner hasn't read, so the column of photos has a count to show.
  const otherName = uniqueName("Chats hub other project");
  const otherId = (await ok<{ id: string }>(await teammate.request.post("/api/projects", { data: { name: otherName } }))).id;
  await ok(await teammate.request.post(`/api/projects/${otherId}/invitations`, { data: { email: ownerEmail, role: "EDITOR" } }));
  const invitations = await ok<Array<{ id: string; project: { id: string } }>>(await owner.request.get("/api/project-invitations"));
  await ok(await owner.request.patch(`/api/project-invitations/${invitations.find((item) => item.project.id === otherId)!.id}`, { data: { action: "ACCEPT" } }));
  await ok(await teammate.request.post(`/api/projects/${otherId}/comments`, { multipart: { message: "Draft is in the other project." } }));

  await owner.goto(`/chats?project=${projectId}`);
  const conversation = owner.getByRole("region", { name: "Conversation" });
  const list = owner.getByRole("list", { name: "Project chats" });
  const edge = owner.getByRole("separator", { name: "Resize chat list" });
  const listBox = async () => (await owner.locator("#chat-list").boundingBox())!;
  const width = async () => Math.round((await listBox()).width);
  await expect(conversation.getByRole("heading", { name: projectName })).toBeVisible();

  // No show/hide button any more (#416): the list sits beside the chat, 310 px wide, with one "Chats" heading.
  await expect(conversation.getByRole("button", { name: /^Chats/ })).toHaveCount(0);
  await expect(list.getByRole("link", { name: new RegExp(`^${otherName}.*1 unread message$`) })).toBeVisible();
  await expect.poll(width).toBe(310);
  await expect(owner.getByRole("heading", { level: 1, name: "Chats" })).toHaveCount(1);

  // Dragging the edge widens it; past 240 px it snaps to a column of photos that keeps the unread count.
  const box = (await edge.boundingBox())!;
  const left = (await listBox()).x;
  const y = box.y + box.height / 2;
  await owner.mouse.move(box.x + box.width / 2, y);
  await owner.mouse.down();
  await owner.mouse.move(left + 400, y, { steps: 5 });
  await expect.poll(width).toBe(400);
  await owner.mouse.move(left + 60, y, { steps: 5 });
  await owner.mouse.up();
  await expect.poll(width).toBe(72);
  await expect(list.getByRole("link", { name: `${otherName}, 1 unread message` })).toBeVisible();
  await expect(list.getByRole("link", { name: projectName, exact: true })).toHaveAttribute("aria-current", "true");
  await expect(owner.getByRole("heading", { level: 1, name: "Chats" })).toHaveCount(1);

  // The column survives a reload; its magnifier opens the whole list again, at its width from before
  // the drag, with the cursor in the search.
  await owner.reload();
  await expect(conversation.getByRole("heading", { name: projectName })).toBeVisible();
  await expect.poll(width).toBe(72);
  await owner.getByRole("button", { name: "Search chats" }).click();
  await expect.poll(width).toBe(310);
  await expect(owner.getByLabel("Search people")).toBeFocused();

  // The keyboard works the edge too, and a double-click goes back to 310 px.
  await edge.focus();
  await owner.keyboard.press("ArrowLeft");
  await expect.poll(width).toBe(294);
  await edge.dblclick();
  await expect.poll(width).toBe(310);

  // With no chat open, the list is the page.
  await owner.goto("/chats");
  await expect(list).toBeVisible();
});

test("Mark all read clears every chat", async () => {
  await postMessage(owner, "One more thing: the footer links.");

  await teammate.goto("/chats");
  // The teammate read everything before this in the test above.
  await expect(chatRow(teammate)).toHaveAccessibleName(/1 unread message$/);
  await teammate.getByRole("button", { name: "Mark all read" }).click();
  await expect(teammate.getByText("All chats marked as read")).toBeVisible();
  await expect(chatRow(teammate)).not.toHaveAccessibleName(/unread/);
  await expect(teammate.getByRole("button", { name: "Mark all read" })).toBeDisabled();
  await expect(sidebar(teammate).getByRole("link", { name: "Chats", exact: true })).toBeVisible();
});
