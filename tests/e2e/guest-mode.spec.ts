import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { confirmationLink, continueAsGuest, expectHome, openAccountMenu, queryDatabase, signUpAndLogIn, uniqueName } from "./helpers";

/*
 * Guest mode (#458): a guest workspace holds 5 tasks, 2 events, 3 notes and 1 project of its own,
 * can't use the AI or invite people, and shows a guest profile where an account's row sits. Past
 * a limit, and on the AI, one sign-up pop-up opens instead of the form.
 */

function post(page: Page, url: string, data: Record<string, unknown> = {}) {
  return page.request.post(url, { data });
}

async function addTasks(page: Page, count: number) {
  for (let index = 1; index <= count; index += 1) {
    expect((await post(page, "/api/tasks", { title: `Guest task ${index}` })).status(), `task ${index}`).toBe(201);
  }
}

/** The guest profile: at the bottom of the sidebar on wide screens, of the menu sheet on a phone. */
async function openGuestProfile(page: Page) {
  const profile = page.getByRole("region", { name: "Guest workspace" });
  if (!(await profile.isVisible())) await page.getByRole("button", { name: /^Open navigation/ }).click();
  await expect(profile).toBeVisible();
  return profile;
}

test("a guest sees what the workspace holds where the profile sits", async ({ page }) => {
  await continueAsGuest(page);
  const profile = await openGuestProfile(page);
  await expect(profile).toContainText("Saved on this browser");
  await expect(profile.getByText("Tasks", { exact: true })).toBeVisible();
  await expect(profile.getByText("5 left")).toBeVisible();
  await expect(profile.getByText("Events", { exact: true })).toBeVisible();
  await expect(profile.getByText("2 left")).toBeVisible();
  // Log in opens a pop-up over the page, like Sign up (#543): guest-login.spec.ts.
  await expect(profile.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  // Guests get no bell: nothing can reach them.
  await expect(page.getByRole("button", { name: /^Notifications/ })).toHaveCount(0);

  // What they make counts down.
  await addTasks(page, 2);
  await page.reload();
  const again = await openGuestProfile(page);
  await expect(again.getByText("3 left")).toBeVisible();

  await again.getByRole("button", { name: "Sign up free" }).click();
  const dialog = page.getByRole("dialog", { name: "Keep your work with a free account" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("The AI assistant");
  await expect(dialog.getByRole("link", { name: "Sign up with email" })).toHaveAttribute("href", "/signup");
  await expect(dialog.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  await expect(dialog).toContainText("You must be 18 or older.");
});

test("past the limit, New task opens the sign-up pop-up instead", async ({ page, isMobile }) => {
  await continueAsGuest(page);
  await addTasks(page, 5);
  const sixth = await post(page, "/api/tasks", { title: "One too many" });
  expect(sixth.status()).toBe(403);
  expect(await sixth.json()).toEqual({ error: "Guest workspaces hold 5 tasks. Sign up free to add more.", code: "GUEST_LIMIT", reason: "tasks" });

  await page.reload();
  // The sidebar's button on a computer, the + tab on a phone.
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "You've used your 5 guest tasks" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Sign up free for as many as you like. Everything you made here comes with you.");
  await expect(page.getByRole("dialog", { name: "New task" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);

  // N does the same, and so does Home's quick add, which asks the server.
  if (!isMobile) {
    await page.keyboard.press("n");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await page.getByPlaceholder(/^Add a task/).fill("One too many");
  await page.getByPlaceholder(/^Add a task/).press("Enter");
  await expect(dialog).toBeVisible();
});

test("a project template's tasks don't count against the guest's own", async ({ page }) => {
  await continueAsGuest(page);
  expect((await post(page, "/api/projects", { name: "Sprint", templateId: "sprint" })).status()).toBe(201);
  await addTasks(page, 5);
  expect((await post(page, "/api/tasks", { title: "One too many" })).status()).toBe(403);

  // One project of their own.
  const second = await post(page, "/api/projects", { name: "Second project" });
  expect(second.status()).toBe(403);
  expect(await second.json()).toMatchObject({ code: "GUEST_LIMIT", reason: "projects" });
});

test("guests hold 2 events and 3 notes", async ({ page }) => {
  await continueAsGuest(page);
  const event = (title: string) => post(page, "/api/events", { title, startDate: "2026-03-02", startTime: "09:00", endDate: "", endTime: "", recurrence: "NONE" });
  expect((await event("First")).status()).toBe(201);
  expect((await event("Second")).status()).toBe(201);
  const third = await event("Third");
  expect(third.status()).toBe(403);
  expect(await third.json()).toMatchObject({ code: "GUEST_LIMIT", reason: "events" });

  for (const title of ["One", "Two", "Three"]) expect((await post(page, "/api/notes", { title, content: "" })).status()).toBe(201);
  const fourth = await post(page, "/api/notes", { title: "Four", content: "" });
  expect(fourth.status()).toBe(403);
  expect(await fourth.json()).toMatchObject({ code: "GUEST_LIMIT", reason: "notes" });
});

test("guests can't invite people or link a calendar, and the AI asks them to sign up", async ({ page }) => {
  await continueAsGuest(page);
  const project = (await (await post(page, "/api/projects", { name: "Mine" })).json()) as { id: string };
  const invite = await post(page, `/api/projects/${project.id}/invitations`, { email: "someone@example.test", role: "EDITOR" });
  expect(invite.status()).toBe(403);
  expect(await invite.json()).toMatchObject({ code: "ACCOUNT_REQUIRED", reason: "people" });
  expect((await page.request.post("/api/calendar-feed")).status()).toBe(403);

  await page.goto("/ai");
  const dialog = page.getByRole("dialog", { name: "The AI needs a free account" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  // Behind it, what the AI answers; any question opens the pop-up again.
  await page.getByRole("button", { name: "What's overdue?" }).click();
  await expect(dialog).toBeVisible();
});

test("leaving a guest workspace asks first", async ({ page }) => {
  await continueAsGuest(page);
  await openAccountMenu(page);
  await page.getByRole("menuitem", { name: "Leave guest workspace" }).click();
  const confirm = page.getByRole("dialog", { name: "Leave the guest workspace?" });
  await expect(confirm).toContainText("you can't come back to it");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  // Still in the workspace (on a phone, back in the menu it was opened from).
  await expect(page.getByRole("region", { name: "Guest workspace" })).toBeVisible();
  await page.goto("/");
  await expectHome(page);

  await openAccountMenu(page);
  await page.getByRole("menuitem", { name: "Leave guest workspace" }).click();
  await page.getByRole("dialog", { name: "Leave the guest workspace?" }).getByRole("button", { name: "Leave" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("a guest can open the sign-up and log-in pages", async ({ page }) => {
  await continueAsGuest(page);
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Start your workspace" })).toBeVisible();
  await page.goto("/login");
  await expect(page.getByLabel("Email or username")).toBeVisible();
});

test("accounts have no guest limits", async ({ page }) => {
  await signUpAndLogIn(page, "No limits");
  await addTasks(page, 6);
  expect((await post(page, "/api/projects", { name: "First" })).status()).toBe(201);
  expect((await post(page, "/api/projects", { name: "Second" })).status()).toBe(201);
  await expect(page.getByRole("region", { name: "Guest workspace" })).toHaveCount(0);
});

// #459: signing up turns the guest workspace into the account, with everything made in it.
test("signing up keeps the guest's work", async ({ page }) => {
  await continueAsGuest(page);
  const title = uniqueName("Made as a guest");
  expect((await post(page, "/api/tasks", { title })).status()).toBe(201);
  const { rows: made } = await queryDatabase<{ userId: string }>(`SELECT "userId" FROM "Task" WHERE title = $1`, [title]);

  await page.goto("/signup");
  await expect(page.getByText("Everything in your guest workspace comes with you.")).toBeVisible();
  const id = randomUUID().slice(0, 8);
  const email = `e2e-former-guest-${id}@example.test`;
  const password = `e2e-${randomUUID()}`;
  await page.getByLabel("Name", { exact: true }).fill("Former guest");
  await page.getByLabel("Username").fill(`former_${id}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  await page.goto(await confirmationLink(email));
  await expectHome(page);
  const { rows: account } = await queryDatabase<{ id: string; isGuest: boolean }>(`SELECT id, "isGuest" FROM "User" WHERE email = $1`, [email]);
  expect(account).toEqual([{ id: made[0].userId, isGuest: false }]);
  await page.goto("/tasks");
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByRole("region", { name: "Guest workspace" })).toHaveCount(0);
});

test("a guest's ✦ and Ctrl J open the sign-up pop-up where they are", async ({ page, isMobile }) => {
  await continueAsGuest(page);
  if (isMobile) await page.getByRole("button", { name: /^Open navigation/ }).click();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "AI", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "The AI needs a free account" });
  await expect(dialog).toBeVisible();
  await expect(page).not.toHaveURL(/\/ai$/);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  if (!isMobile) {
    await page.keyboard.press("Control+j");
    await expect(dialog).toBeVisible();
  }
});
