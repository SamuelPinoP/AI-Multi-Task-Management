import { expect, test, type APIResponse, type BrowserContext, type Page } from "@playwright/test";
import { queryDatabase, signUpAndLogIn, uniqueName } from "./helpers";

// #393 (design 5B): "Already in Multi" adds someone you already share a project
// with at once, or invites anyone by their exact @username without showing
// their email; "New to Multi" invites by email. An invitation ends on a short
// confirmation. Nobody can find people outside their projects by name.
test.describe.configure({ mode: "serial" });

type Account = { page: Page; id: string; name: string; email: string; username: string };
const contexts: BrowserContext[] = [];
const people = {} as Record<"owner" | "teammate" | "stranger" | "editor", Account>;
let projectId = "";

async function ok<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.url()} -> ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

async function join(owner: Account, invitee: Account, project: string) {
  await ok(await owner.page.request.post(`/api/projects/${project}/invitations`, { data: { email: invitee.email, role: "EDITOR" } }));
  const invitations = await ok<Array<{ id: string; project: { id: string } }>>(await invitee.page.request.get("/api/project-invitations"));
  const invitation = invitations.find((item) => item.project.id === project);
  await ok(await invitee.page.request.patch(`/api/project-invitations/${invitation!.id}`, { data: { action: "ACCEPT" } }));
}

function members(page: Page) {
  return page.getByRole("region", { name: "Members" }).filter({ visible: true });
}

async function openAddPeople(page: Page) {
  await page.goto(`/projects/${projectId}`);
  await members(page).getByRole("button", { name: "Add people" }).click();
  return page.getByRole("dialog", { name: "Add people" });
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(150_000);
  for (const key of ["owner", "teammate", "stranger", "editor"] as const) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    const account = await signUpAndLogIn(page, `E2E add ${key}`);
    people[key] = { page, id: "", ...account };
  }
  // The owner and the teammate already share another project; the stranger shares none.
  const other = await ok<{ id: string; userId: string }>(await people.owner.page.request.post("/api/projects", { data: { name: uniqueName("Other project") } }));
  await join(people.owner, people.teammate, other.id);
  projectId = (await ok<{ id: string }>(await people.owner.page.request.post("/api/projects", { data: { name: uniqueName("Add people project") } }))).id;
  await join(people.owner, people.editor, projectId);

  const details = await ok<{ userId: string; members: { user: { id: string; email: string } | null }[] }>(
    await people.owner.page.request.get(`/api/projects/${other.id}`),
  );
  people.owner.id = details.userId;
  people.teammate.id = details.members.find((member) => member.user?.email === people.teammate.email)!.user!.id;
});

test.afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
});

test("someone you already share a project with joins at once from Already in Multi", async () => {
  const dialog = await openAddPeople(people.owner.page);
  await expect(dialog.getByRole("button", { name: "Already in Multi" })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByLabel("Search your teammates or an @username").fill(people.teammate.name.split(" ").slice(-1)[0]);
  const results = dialog.getByRole("list", { name: "People to add" });
  await expect(results).toContainText(people.teammate.name);
  await expect(results).toContainText("In Other project");
  await results.getByRole("button", { name: `Add ${people.teammate.name}` }).click();
  await expect(results.getByRole("button", { name: `Added ${people.teammate.name}` })).toBeDisabled();
  await people.owner.page.keyboard.press("Escape");

  await expect(members(people.owner.page).getByRole("listitem").filter({ hasText: people.teammate.name })).toBeVisible();
  const projects = await ok<{ id: string }[]>(await people.teammate.page.request.get("/api/projects"));
  expect(projects.some((project) => project.id === projectId)).toBe(true);
});

test("anyone else is invited by exact @username, and their email stays hidden", async () => {
  const dialog = await openAddPeople(people.owner.page);
  const search = dialog.getByLabel("Search your teammates or an @username");
  // A name finds only people from your projects: the stranger stays out of reach.
  await search.fill(people.stranger.name);
  await expect(dialog).toContainText("Nobody in your projects matches.");

  await search.fill(`@${people.stranger.username}`);
  const results = dialog.getByRole("list", { name: "People to add" });
  await expect(results).toContainText(`@${people.stranger.username}`);
  await results.getByRole("button", { name: `Invite ${people.stranger.name}` }).click();
  const confirmation = people.owner.page.getByRole("dialog", { name: "Invite sent" });
  await expect(confirmation).toContainText(`Once @${people.stranger.username} accepts, they're in.`);
  await confirmation.getByRole("button", { name: "Done" }).click();
  await expect(confirmation).toBeHidden();

  const invitations = await ok<{ invitedEmail: string | null; invitedUsername: string | null }[]>(
    await people.owner.page.request.get(`/api/projects/${projectId}/invitations`),
  );
  const invitation = invitations.find((item) => item.invitedUsername === people.stranger.username);
  expect(invitation?.invitedEmail).toBeNull();
  const received = await ok<Array<{ project: { id: string } }>>(await people.stranger.page.request.get("/api/project-invitations"));
  expect(received.some((item) => item.project.id === projectId)).toBe(true);
});

test("New to Multi invites by email and confirms there's nothing else to do", async () => {
  const dialog = await openAddPeople(people.owner.page);
  await dialog.getByRole("button", { name: "New to Multi" }).click();
  const email = `e2e-new-${Date.now()}@example.test`;
  await dialog.getByLabel("Their email").fill(email);
  await dialog.getByRole("button", { name: "Send invite" }).click();
  const confirmation = people.owner.page.getByRole("dialog", { name: "Invite sent" });
  await expect(confirmation).toContainText(`Once ${email} accepts, they're in.`);
  await confirmation.getByRole("button", { name: "Done" }).click();
  await expect(people.owner.page.getByRole("dialog")).toHaveCount(0);
});

test("only the owner and admins add people, and only people they already share a project with", async () => {
  const editor = people.editor.page.request;
  expect((await editor.post(`/api/projects/${projectId}/members`, { data: { userId: people.owner.id, role: "EDITOR" } })).status()).toBe(403);
  expect((await editor.get(`/api/projects/${projectId}/people?username=${people.stranger.username}`)).status()).toBe(404);
  await people.editor.page.goto(`/projects/${projectId}`);
  await expect(members(people.editor.page).getByRole("button", { name: "Add people" })).toHaveCount(0);

  // The stranger shares no project with the owner: invite them, don't add them.
  const strangerId = (
    await ok<{ person: { id: string } | null }>(await people.owner.page.request.get(`/api/projects/${projectId}/people?username=@${people.stranger.username}`))
  ).person!.id;
  expect((await people.owner.page.request.post(`/api/projects/${projectId}/members`, { data: { userId: strangerId, role: "EDITOR" } })).status()).toBe(403);
  // Someone already in the project can't be added twice.
  expect((await people.owner.page.request.post(`/api/projects/${projectId}/members`, { data: { userId: people.teammate.id, role: "EDITOR" } })).status()).toBe(409);

  // Someone with no name shows as their username, never as the start of their email.
  await queryDatabase(`UPDATE "User" SET name = NULL WHERE id = $1`, [strangerId]);
  const lookup = await people.owner.page.request.get(`/api/projects/${projectId}/people?username=${people.stranger.username}`);
  const nameless = await ok<{ person: { name: string } | null }>(lookup);
  expect(nameless.person?.name).toBe(`@${people.stranger.username}`);
  expect(JSON.stringify(nameless)).not.toContain(people.stranger.email.split("@")[0]);
});
