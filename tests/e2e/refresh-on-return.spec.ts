import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { signUpAndLogIn, uniqueName } from "./helpers";

async function createProject(owner: APIRequestContext) {
  const name = uniqueName("Refresh project");
  const response = await owner.post("/api/projects", { data: { name } });
  expect(response.ok()).toBe(true);
  return { ...((await response.json()) as { id: string }), name };
}

async function invite(owner: APIRequestContext, projectId: string, email: string) {
  const response = await owner.post(`/api/projects/${projectId}/invitations`, { data: { email, role: "EDITOR" } });
  expect(response.ok(), await response.text()).toBe(true);
}

/** Half a minute away (say, on the phone), then the window gets focus again. */
async function comeBack(page: Page) {
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

test("pages catch up with an invitation sent and accepted elsewhere when you come back", async ({ browser }) => {
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext();
  const inviteeContext = await browser.newContext();
  try {
    const ownerPage = await ownerContext.newPage();
    const page = await inviteeContext.newPage();
    await signUpAndLogIn(ownerPage, "E2E owner");
    const invitee = await signUpAndLogIn(page, "E2E invitee");
    const project = await createProject(ownerContext.request);

    // The invitee has Projects open while the owner invites them.
    await page.clock.install();
    await page.goto("/projects");
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    await invite(ownerContext.request, project.id, invitee.email);
    const invitations = page.getByRole("region", { name: "You're invited to a project" });
    await expect(invitations).toHaveCount(0);
    await comeBack(page);
    await expect(invitations.getByText(project.name)).toBeVisible();

    // The owner has the project open while the invitee accepts on another device.
    await ownerPage.clock.install();
    await ownerPage.goto(`/projects/${project.id}`);
    // The innermost section with that heading: the team section around it shows members too.
    const pending = ownerPage.locator("section", { has: ownerPage.getByRole("heading", { name: "Pending invitations" }) }).last();
    await expect(pending.getByText(invitee.email)).toBeVisible();
    const list = (await (await inviteeContext.request.get("/api/project-invitations")).json()) as { id: string; project: { id: string } }[];
    const invitation = list.find((item) => item.project.id === project.id);
    expect(invitation).toBeTruthy();
    const accepted = await inviteeContext.request.patch(`/api/project-invitations/${invitation!.id}`, { data: { action: "ACCEPT" } });
    expect(accepted.ok()).toBe(true);

    await expect(pending.getByText(invitee.email)).toBeVisible();
    await comeBack(ownerPage);
    await expect(pending.getByText("No pending invitations.")).toBeVisible();
    const collaborators = ownerPage.locator("section", { has: ownerPage.getByRole("heading", { name: "Accepted collaborators" }) }).last();
    await expect(collaborators.getByText(invitee.email)).toBeVisible();
  } finally {
    await Promise.all([ownerContext.close(), inviteeContext.close()]);
  }
});

test("an open chat stops checking after ten idle minutes and catches up when you're back", async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndLogIn(page, "E2E chatter");
  const project = await createProject(page.request);
  const checks: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().includes(`/api/projects/${project.id}/comments`)) checks.push(request.url());
  });

  await page.clock.install();
  await page.goto(`/chats?project=${project.id}`);
  // The sidebar previews the latest message too.
  const conversation = page.getByRole("region", { name: "Conversation" });
  await expect(conversation.getByRole("heading", { name: project.name })).toBeVisible();

  // In use: it checks every 7 seconds.
  const before = checks.length;
  await page.clock.fastForward(7_000);
  await expect.poll(() => checks.length).toBeGreaterThan(before);

  // Ten minutes without a click, key or scroll: no more checks.
  await page.clock.fastForward(10 * 60_000);
  const idle = checks.length;
  const message = uniqueName("Sent while you were away");
  expect((await page.request.post(`/api/projects/${project.id}/comments`, { data: { message } })).ok()).toBe(true);
  for (let tick = 0; tick < 3; tick += 1) await page.clock.fastForward(7_000);
  expect(checks.length).toBe(idle);
  await expect(conversation.getByText(message)).toHaveCount(0);

  // Back at the computer: it checks at once.
  await page.mouse.move(40, 40);
  await page.mouse.move(80, 80);
  await expect(conversation.getByText(message)).toBeVisible();
  expect(checks.length).toBeGreaterThan(idle);
});
