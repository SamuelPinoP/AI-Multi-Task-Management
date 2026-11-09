import { expect, test, type APIResponse, type BrowserContext, type Page } from "@playwright/test";
import { signUpAndLogIn, uniqueName } from "./helpers";

// #387: people who share a project write to each other one to one, and find
// each other through the Chats page's search. An outsider can't reach them.
test.describe.configure({ mode: "serial" });

const contexts: BrowserContext[] = [];
let owner: Page;
let teammate: Page;
let outsider: Page;
let ownerName = "";
let teammateName = "";
let outsiderEmail = "";
let ownerId = "";
let teammateId = "";
let projectId = "";
let projectName = "";

async function ok<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.url()} -> ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Workspace" });
}

function conversation(page: Page) {
  return page.getByRole("region", { name: "Conversation" });
}

async function send(page: Page, text: string) {
  const box = conversation(page).getByLabel("Message", { exact: true });
  await box.fill(text);
  await conversation(page).getByRole("button", { name: "Send message" }).click();
  await expect(conversation(page).getByText(text)).toBeVisible();
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(120_000);
  const accounts: { page: Page; name: string; email: string }[] = [];
  for (const label of ["E2E DM owner", "E2E DM teammate", "E2E DM outsider"]) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    const { name, email } = await signUpAndLogIn(page, label);
    accounts.push({ page, name, email });
  }
  [owner, teammate, outsider] = accounts.map((account) => account.page);
  ownerName = accounts[0].name;
  teammateName = accounts[1].name;
  outsiderEmail = accounts[2].email;

  projectName = uniqueName("DM project");
  projectId = (await ok<{ id: string }>(await owner.request.post("/api/projects", { data: { name: projectName } }))).id;
  await ok(await owner.request.post(`/api/projects/${projectId}/invitations`, { data: { email: accounts[1].email, role: "EDITOR" } }));
  const invitations = await ok<Array<{ id: string; project: { id: string } }>>(await teammate.request.get("/api/project-invitations"));
  const invitation = invitations.find((item) => item.project.id === projectId);
  await ok(await teammate.request.patch(`/api/project-invitations/${invitation!.id}`, { data: { action: "ACCEPT" } }));

  const details = await ok<{ userId: string; members: { user: { id: string; email: string } | null }[] }>(
    await owner.request.get(`/api/projects/${projectId}`),
  );
  ownerId = details.userId;
  teammateId = details.members.find((member) => member.user?.email === accounts[1].email)!.user!.id;
});

test.afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
});

test("searching Chats finds a teammate you've never written to, and a message starts the chat", async () => {
  await owner.goto("/chats");
  await expect(owner.getByRole("heading", { level: 1, name: "Chats" })).toBeVisible();
  // Projects come first; there are no direct messages yet, and no counts in the header or the chips.
  const list = owner.getByRole("region", { name: "Chats" });
  await expect(list.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await expect(list.getByRole("heading", { name: "Direct messages", exact: true })).toHaveCount(0);
  await expect(owner.getByRole("button", { name: "Unread", exact: true })).toBeVisible();

  await owner.getByLabel("Search people").fill(teammateName.split(" ").slice(-2).join(" "));
  const people = owner.getByRole("list", { name: "People" });
  const result = people.getByRole("link", { name: new RegExp(`^${teammateName}`) });
  await expect(result).toContainText(`In ${projectName}`);
  await expect(owner.getByRole("list", { name: "Project chats" })).toHaveCount(0);
  await result.click();

  await expect(owner).toHaveURL(new RegExp(`/chats\\?person=${teammateId}$`));
  await expect(conversation(owner).getByRole("heading", { name: teammateName })).toBeVisible();
  await expect(conversation(owner).getByText(`In ${projectName}`)).toBeVisible();
  // Text only: no attach button.
  await expect(conversation(owner).getByRole("button", { name: "Attach files" })).toHaveCount(0);
  await send(owner, "Can you look at the outline tonight?");
});

test("the message is unread for the teammate until they open the chat, then they reply", async () => {
  await teammate.goto("/chats");
  await expect(sidebar(teammate).getByRole("link", { name: "Chats, 1 with new messages" })).toBeVisible();
  const row = teammate.getByRole("list", { name: "Direct messages" }).getByRole("link", { name: new RegExp(`^${ownerName}`) });
  await expect(row).toHaveAccessibleName(/1 unread message$/);
  await expect(row).toContainText("Can you look at the outline tonight?");

  // The People chip keeps only direct messages; Projects only project chats, and then the search looks for projects.
  await teammate.getByRole("button", { name: "People", exact: true }).click();
  await expect(teammate.getByRole("list", { name: "Project chats" })).toHaveCount(0);
  await expect(row).toBeVisible();
  await teammate.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(row).toBeHidden();
  await teammate.getByLabel("Search projects").fill(projectName);
  await expect(teammate.getByRole("list", { name: "Project chats" }).getByRole("link", { name: new RegExp(`^${projectName}`) })).toBeVisible();
  await teammate.getByLabel("Search projects").fill("");
  await teammate.getByRole("button", { name: "All", exact: true }).click();

  await row.click();
  await expect(conversation(teammate).getByRole("heading", { name: ownerName })).toBeVisible();
  await expect(conversation(teammate).getByRole("separator", { name: "New messages" })).toBeVisible();
  await send(teammate, "Yes, after dinner.");
  await expect(sidebar(teammate).getByRole("link", { name: "Chats", exact: true })).toBeVisible();

  // The owner's open chat picks the reply up on its next refresh.
  await owner.goto(`/chats?person=${teammateId}`);
  await expect(conversation(owner).getByText("Yes, after dinner.")).toBeVisible();
});

test("only the two people in a chat can reach it, and only while they share a project to send", async () => {
  const api = (page: Page, person: string) => `/api/direct-chats/${person}/comments`;
  // Outsiders don't learn that the chat or the person exists.
  expect((await outsider.request.get(api(outsider, ownerId))).status()).toBe(404);
  expect((await outsider.request.post(api(outsider, ownerId), { data: { message: "Hi" } })).status()).toBe(404);
  expect((await owner.request.get(api(owner, ownerId))).status()).toBe(404);
  // Text only, and never empty.
  expect((await owner.request.post(api(owner, teammateId), { multipart: { message: "With a file" } })).status()).toBe(415);
  expect((await owner.request.post(api(owner, teammateId), { data: { message: "   " } })).status()).toBe(400);

  // Only the author edits a message.
  const thread = await ok<{ comments: { id: string; author: { name: string | null } }[] }>(await owner.request.get(api(owner, teammateId)));
  const ownerMessage = thread.comments.find((comment) => comment.author.name === ownerName)!;
  expect((await teammate.request.patch(`${api(teammate, ownerId)}/${ownerMessage.id}`, { data: { message: "Changed" } })).status()).toBe(403);
  expect((await owner.request.patch(`${api(owner, teammateId)}/${ownerMessage.id}`, { data: { message: "Can you look at the outline tomorrow?" } })).status()).toBe(200);

  // Removed from the project, the teammate can still read the chat but no longer send in it.
  const details = await ok<{ members: { id: string; user: { id: string } | null }[] }>(await owner.request.get(`/api/projects/${projectId}`));
  const memberId = details.members.find((member) => member.user?.id === teammateId)!.id;
  await ok(await owner.request.delete(`/api/projects/${projectId}/members/${memberId}`));
  expect((await teammate.request.get(api(teammate, ownerId))).status()).toBe(200);
  expect((await teammate.request.post(api(teammate, ownerId), { data: { message: "Still there?" } })).status()).toBe(403);

  await teammate.goto(`/chats?person=${ownerId}`);
  await expect(conversation(teammate).getByText("No projects in common any more")).toBeVisible();
  await expect(conversation(teammate).getByText("You no longer share a project, so you can't send new messages here.")).toBeVisible();
  await expect(conversation(teammate).getByText("Can you look at the outline tomorrow?")).toBeVisible();
});

test("Mark all read clears direct chats too", async () => {
  // The teammate is out of the project, so the owner writes to someone new: the outsider joins first.
  await ok(await owner.request.post(`/api/projects/${projectId}/invitations`, { data: { email: outsiderEmail, role: "EDITOR" } }));
  const invitations = await ok<Array<{ id: string; project: { id: string } }>>(await outsider.request.get("/api/project-invitations"));
  await ok(await outsider.request.patch(`/api/project-invitations/${invitations.find((item) => item.project.id === projectId)!.id}`, { data: { action: "ACCEPT" } }));
  await ok(await outsider.request.post(`/api/direct-chats/${ownerId}/comments`, { data: { message: "Thanks for adding me!" } }));

  await owner.goto("/chats");
  await expect(sidebar(owner).getByRole("link", { name: "Chats, 1 with new messages" })).toBeVisible();
  await owner.getByRole("button", { name: "Mark all read" }).click();
  await expect(owner.getByText("All chats marked as read")).toBeVisible();
  await expect(owner.getByRole("list", { name: "Direct messages" }).getByRole("link", { name: /unread/ })).toHaveCount(0);
  await expect(sidebar(owner).getByRole("link", { name: "Chats", exact: true })).toBeVisible();
});
