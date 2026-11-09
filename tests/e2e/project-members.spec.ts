import { expect, test, type APIResponse, type BrowserContext, type Page } from "@playwright/test";
import { signUpAndLogIn, uniqueName } from "./helpers";

// #386: a project's members, owner first, each role as a badge under the name
// (design 1B), a Message button for each person, and a menu that offers only
// what the role rules allow (#385). The Invite dialog says what each role does (3B).
test.describe.configure({ mode: "serial" });

const contexts: BrowserContext[] = [];
const pages = {} as Record<"owner" | "admin" | "editor", Page>;
const names = {} as Record<"owner" | "admin" | "editor", string>;
let ownerId = "";
let projectId = "";
let projectName = "";

async function ok<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.url()} -> ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

function members(page: Page) {
  return page.getByRole("region", { name: "Members" }).filter({ visible: true });
}

function row(page: Page, name: string) {
  return members(page).getByRole("listitem").filter({ hasText: name });
}

async function openProject(page: Page) {
  await page.goto(`/projects/${projectId}`);
  await expect(members(page).getByRole("heading", { name: "Members" })).toBeVisible();
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(120_000);
  const emails = {} as Record<"owner" | "admin" | "editor", string>;
  for (const role of ["owner", "admin", "editor"] as const) {
    const context = await browser.newContext();
    contexts.push(context);
    pages[role] = await context.newPage();
    const account = await signUpAndLogIn(pages[role], `E2E members ${role}`);
    names[role] = account.name;
    emails[role] = account.email;
  }
  projectName = uniqueName("Members project");
  const project = await ok<{ id: string; userId: string }>(await pages.owner.request.post("/api/projects", { data: { name: projectName } }));
  projectId = project.id;
  ownerId = project.userId;
  for (const [role, memberRole] of [["admin", "ADMIN"], ["editor", "EDITOR"]] as const) {
    await ok(await pages.owner.request.post(`/api/projects/${projectId}/invitations`, { data: { email: emails[role], role: memberRole } }));
    const invitations = await ok<Array<{ id: string; project: { id: string } }>>(await pages[role].request.get("/api/project-invitations"));
    const invitation = invitations.find((item) => item.project.id === projectId);
    await ok(await pages[role].request.patch(`/api/project-invitations/${invitation!.id}`, { data: { action: "ACCEPT" } }));
  }
});

test.afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
});

test("everyone sees the members, owner first, with Owner and Admin under the names and a Message button", async () => {
  const page = pages.editor;
  await openProject(page);
  await expect(members(page).getByRole("listitem")).toHaveCount(3);
  await expect(members(page).getByRole("listitem").first()).toContainText(names.owner);
  await expect(row(page, names.owner)).toContainText("Owner");
  await expect(row(page, names.admin)).toContainText("Admin");
  await expect(row(page, names.editor)).toContainText("(You)");
  await expect(row(page, names.editor)).not.toContainText("Member");
  // A member manages nobody: no Invite, no menus, and nobody messages themselves.
  await expect(members(page).getByRole("button", { name: "Invite" })).toHaveCount(0);
  await expect(members(page).getByRole("button", { name: /^More for / })).toHaveCount(0);
  await expect(row(page, names.editor).getByRole("link", { name: /^Message/ })).toHaveCount(0);
  // The project page has no Assigned Notes section any more.
  await expect(page.getByRole("heading", { name: "Assigned Notes" })).toHaveCount(0);

  await row(page, names.owner).getByRole("link", { name: /^Message/ }).click();
  await expect(page).toHaveURL(new RegExp(`/chats\\?person=${ownerId}$`));
  await expect(page.getByRole("region", { name: "Conversation" }).getByRole("heading", { name: names.owner })).toBeVisible();
});

test("an admin promotes a member but can't touch the owner or an admin", async () => {
  const page = pages.admin;
  await openProject(page);
  await expect(row(page, names.owner).getByRole("button", { name: /^More for / })).toHaveCount(0);
  await expect(row(page, names.admin).getByRole("button", { name: /^More for / })).toHaveCount(0);

  await row(page, names.editor).getByRole("button", { name: `More for ${names.editor}` }).click();
  await expect(page.getByRole("menuitem", { name: "Remove from project" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Dismiss as admin" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Make admin" }).click();
  await expect(row(page, names.editor)).toContainText("Admin");
  // Now an admin, they're out of the admin's reach.
  await expect(row(page, names.editor).getByRole("button", { name: /^More for / })).toHaveCount(0);
});

test("the owner dismisses an admin, and removing someone asks first", async () => {
  const page = pages.owner;
  await openProject(page);
  await row(page, names.editor).getByRole("button", { name: `More for ${names.editor}` }).click();
  await page.getByRole("menuitem", { name: "Dismiss as admin" }).click();
  await expect(row(page, names.editor)).not.toContainText("Admin");

  await row(page, names.editor).getByRole("button", { name: `More for ${names.editor}` }).click();
  await page.getByRole("menuitem", { name: "Remove from project" }).click();
  const confirm = page.getByRole("dialog", { name: `Remove ${names.editor}?` });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(row(page, names.editor)).toHaveCount(0);
  await page.reload();
  await expect(members(page).getByRole("listitem")).toHaveCount(2);
});

test("the Invite dialog says what each role does and invites as the role picked", async () => {
  const page = pages.admin;
  await openProject(page);
  await members(page).getByRole("button", { name: "Invite" }).click();
  const dialog = page.getByRole("dialog", { name: `Invite to ${projectName}` });
  await expect(dialog.getByRole("radio", { name: /^Member/ })).toBeChecked();
  await expect(dialog).toContainText("Works on tasks, notes, events and chat.");
  await expect(dialog).toContainText("Also adds and removes members, and makes admins.");

  const email = `e2e-invite-${Date.now()}@example.test`;
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("radio", { name: /^Admin/ }).check();
  await dialog.getByRole("button", { name: "Send invite" }).click();
  await expect(dialog).toBeHidden();
  const invitations = await ok<{ invitedEmail: string; role: string }[]>(await page.request.get(`/api/projects/${projectId}/invitations`));
  expect(invitations.find((invitation) => invitation.invitedEmail === email)?.role).toBe("ADMIN");
});
