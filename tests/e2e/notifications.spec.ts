import AxeBuilder from "@axe-core/playwright";
import { expect, request as playwrightRequest, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { continueAsGuest, signUpAndLogIn, uniqueName } from "./helpers";

// SMART-08: the inbox behind the bell (assignments, mentions, due-soon
// reminders) and the browser-push switch.

type Inbox = { notifications: { id: string; type: string; title: string; body: string | null; url: string | null; readAt: string | null }[]; unread: number };

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.url()} -> ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

/** Notifications are added after the response, so wait for them. */
async function inboxWith(client: APIRequestContext, type: string, count = 1) {
  let inbox: Inbox = { notifications: [], unread: 0 };
  await expect
    .poll(async () => {
      inbox = await json<Inbox>(await client.get("/api/notifications"));
      return inbox.notifications.filter((item) => item.type === type).length;
    })
    .toBe(count);
  return inbox;
}

function dateInputValue(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("assignments and @mentions reach the teammate's inbox", async ({ browser }) => {
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext();
  const teammateContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const page = await teammateContext.newPage();
  const owner = ownerContext.request;
  const teammate = teammateContext.request;

  try {
    const ownerAccount = await signUpAndLogIn(ownerPage, "E2E boss");
    const { email } = await signUpAndLogIn(page, "E2E helper");
    const projectName = uniqueName("Inbox project");
    const project = await json<{ id: string }>(await owner.post("/api/projects", { data: { name: projectName } }));
    await json(await owner.post(`/api/projects/${project.id}/invitations`, { data: { email, role: "EDITOR" } }));
    const invitation = (await json<{ id: string; project: { id: string } }[]>(await teammate.get("/api/project-invitations"))).find(
      (item) => item.project.id === project.id,
    );
    await json(await teammate.patch(`/api/project-invitations/${invitation!.id}`, { data: { action: "ACCEPT" } }));
    const details = await json<{ members: { id: string; user: { email: string } | null }[] }>(await owner.get(`/api/projects/${project.id}`));
    const member = details.members.find((item) => item.user?.email === email)!;

    // Assigning a task tells the assignee.
    const taskTitle = uniqueName("Review the budget");
    const task = await json<{ id: string }>(
      await owner.post("/api/tasks", { data: { title: taskTitle, projectId: project.id, assigneeId: member.id } }),
    );
    const afterAssign = await inboxWith(teammate, "TASK_ASSIGNED");
    expect(afterAssign.notifications[0]).toMatchObject({
      title: `${ownerAccount.name} assigned you a task`,
      body: `“${taskTitle}” in ${projectName}`,
      url: `/tasks?task=${task.id}`,
      readAt: null,
    });
    // Saving the task again without changing the assignee adds nothing.
    await json(
      await owner.patch(`/api/tasks/${task.id}`, {
        data: { title: `${taskTitle} (v2)`, status: "TODO", priority: "HIGH", recurrence: "NONE", projectId: project.id, assigneeId: member.id },
      }),
    );

    // "@" plus their email name mentions them in the chat; a message without it doesn't.
    const handle = email.split("@")[0];
    await json(await owner.post(`/api/projects/${project.id}/comments`, { data: { message: `@${handle} can you check the numbers?` } }));
    await json(await owner.post(`/api/projects/${project.id}/comments`, { data: { message: "No mention here." } }));
    const inbox = await inboxWith(teammate, "MENTION");
    expect(inbox.notifications.filter((item) => item.type === "TASK_ASSIGNED")).toHaveLength(1);
    expect(inbox.notifications.find((item) => item.type === "MENTION")).toMatchObject({
      title: `${ownerAccount.name} mentioned you in ${projectName}`,
      body: `@${handle} can you check the numbers?`,
      url: `/chats?project=${project.id}`,
    });
    // The author never notifies themself.
    expect((await json<Inbox>(await owner.get("/api/notifications"))).notifications).toEqual([]);

    // The bell shows them; opening one marks it read.
    await page.goto("/");
    const bell = page.getByRole("button", { name: "Notifications, 2 new" });
    await bell.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByText(`${ownerAccount.name} mentioned you in ${projectName}`)).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[role="menu"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
    // Push isn't set up in tests, so there's no switch for it.
    await expect(menu.getByText(/browser notifications/)).toHaveCount(0);

    await menu.getByRole("menuitem", { name: new RegExp(`${ownerAccount.name} assigned you a task`) }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks\\?task=${task.id}`));
    // The link opens that task's sheet; close it to get back to the bell.
    const sheet = page.getByRole("dialog", { name: "Edit task" });
    await expect(sheet).toBeVisible();
    await expect.poll(async () => (await json<Inbox>(await teammate.get("/api/notifications"))).unread).toBe(1);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    await page.getByRole("button", { name: "Notifications, 1 new" }).click();
    await page.getByRole("menuitem", { name: "Mark all as read" }).click();
    await expect(page.getByRole("menuitem", { name: "Mark all as read" })).toHaveCount(0);
    // The open menu hides the rest of the page from assistive tech; close it to read the bell again.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
    expect((await json<Inbox>(await teammate.get("/api/notifications"))).unread).toBe(0);
  } finally {
    await ownerContext.close();
    await teammateContext.close();
  }
});

test("the daily reminders flag tasks due today and tomorrow, once", async ({ page }) => {
  await continueAsGuest(page);
  const today = uniqueName("Pay the invoice");
  const tomorrow = uniqueName("Book the room");
  const later = uniqueName("Plan the offsite");
  for (const [title, days] of [[today, 0], [tomorrow, 1], [later, 3]] as const) {
    await json(await page.request.post("/api/tasks", { data: { title, dueDate: dateInputValue(days) } }));
  }

  // Vercel Cron calls this daily; repeats add nothing.
  for (let run = 0; run < 2; run += 1) {
    const response = await page.request.get("/api/cron/reminders");
    expect(response.ok(), await response.text()).toBe(true);
  }
  const titles = (await json<Inbox>(await page.request.get("/api/notifications"))).notifications.map((item) => item.title);
  expect(titles.filter((title) => title === `Due today: ${today}`)).toHaveLength(1);
  expect(titles.filter((title) => title === `Due tomorrow: ${tomorrow}`)).toHaveLength(1);
  expect(titles.some((title) => title.includes(later))).toBe(false);
});

test("push stays off until the server has VAPID keys; the inbox needs a session", async ({ page, baseURL }) => {
  await continueAsGuest(page);
  expect(await json<{ publicKey: string | null }>(await page.request.get("/api/push"))).toEqual({ publicKey: null });
  const subscription = { endpoint: "https://push.example/abc", keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2", auth: "tBHItJI5svbpez7KI4CCXg" } };
  expect((await page.request.post("/api/push", { data: subscription })).status()).toBe(503);
  expect((await page.request.delete("/api/push", { data: {} })).status()).toBe(400);

  const anonymous = await playwrightRequest.newContext({ baseURL });
  for (const [label, call] of [
    ["GET notifications", () => anonymous.get("/api/notifications")],
    ["POST read", () => anonymous.post("/api/notifications/read", { data: {} })],
    ["GET push", () => anonymous.get("/api/push")],
    ["POST push", () => anonymous.post("/api/push", { data: subscription })],
  ] as const) {
    expect.soft((await call()).status(), label).toBe(401);
  }
  await anonymous.dispose();
});
