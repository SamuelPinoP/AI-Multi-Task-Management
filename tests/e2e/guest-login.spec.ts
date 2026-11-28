import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { accountMenuButton, continueAsGuest, expectHome, signUpAndLogIn } from "./helpers";

/*
 * The guest's log-in pop-up (#543): in a guest workspace, Log in opens over the page, like Sign up,
 * instead of leaving for /login. It's the /login page's form, says what went wrong without leaving
 * the page, and a login that works lands on the same page of the account. The /login page itself
 * is covered by username-login.spec.ts, rate-limits.spec.ts and the others.
 */

/** An account made in a browser of its own, so the test's page stays a guest. */
async function makeAccount(browser: Browser, baseURL: string | undefined, label: string, options: { confirmEmail?: boolean } = {}) {
  const context = await browser.newContext({ baseURL });
  try {
    return await signUpAndLogIn(await context.newPage(), label, options);
  } finally {
    await context.close();
  }
}

/**
 * Waits until the pop-up has settled: focus inside and its opening animation done. Radix starts
 * listening for clicks outside a moment after it shows, so a click straight away can go unheard.
 */
async function settled(dialog: Locator) {
  await expect(dialog.getByRole("button", { name: "Continue with Google" })).toBeFocused();
  await dialog.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
}

/** The guest profile's Log in: in the sidebar on a computer, in the menu sheet on a phone. */
async function openLogIn(page: Page) {
  const profile = page.getByRole("region", { name: "Guest workspace" });
  if (!(await profile.isVisible())) await page.getByRole("button", { name: /^Open navigation/ }).click();
  await profile.getByRole("button", { name: "Log in", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Log in to AI Multi" });
  await expect(dialog).toBeVisible();
  await settled(dialog);
  return dialog;
}

async function logIn(page: Page, login: string, password: string) {
  const dialog = page.getByRole("dialog", { name: "Log in to AI Multi" });
  await dialog.getByLabel("Email or username").fill(login);
  await dialog.getByLabel("Password").fill(password);
  await dialog.getByRole("button", { name: "Log in", exact: true }).click();
}

test("Log in opens over the page, and logging in lands on the same page of the account", async ({ page, browser, baseURL }) => {
  const account = await makeAccount(browser, baseURL, "Pop-up login");
  await continueAsGuest(page);
  await page.goto("/notes");
  const dialog = await openLogIn(page);
  await expect(page).toHaveURL(/\/notes$/);

  // The /login page's form, marked up the way password managers look for a login (#351).
  const form = dialog.locator("form[action='/api/auth/login']");
  await expect(form).toHaveAttribute("method", "post");
  await expect(form.getByLabel("Email or username")).toHaveAttribute("autocomplete", "username");
  await expect(form.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
  await expect(dialog.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");
  await expect(dialog.getByRole("button", { name: "Sign up free" })).toBeVisible();
  // Continue with Google can make an account (#356).
  await expect(dialog).toContainText("By continuing, you agree to the Terms of Service and the Privacy Policy.");

  await logIn(page, account.email, account.password);
  await expect(page.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible();
  await expect(page).toHaveURL(/\/notes$/);
  await expect(accountMenuButton(page)).toHaveAccessibleName(`${account.name} Settings and theme`);
  await expect(page.getByRole("region", { name: "Guest workspace" })).toHaveCount(0);
});

test("a wrong password and too many attempts show in the pop-up and keep what was typed", async ({ page, browser, baseURL }) => {
  const account = await makeAccount(browser, baseURL, "Pop-up wrong password");
  await continueAsGuest(page);
  await page.goto("/tasks");
  const dialog = await openLogIn(page);
  const login = dialog.getByLabel("Email or username");
  const password = dialog.getByLabel("Password");

  // Five wrong passwords lock the account for a while (rate-limits.spec.ts); each keeps the username
  // and clears the password, ready to be typed again.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await logIn(page, account.username, "wrong-password");
    await expect(password, `attempt ${attempt}`).toHaveValue("");
    await expect(dialog.getByText("Incorrect email, username or password.")).toBeVisible();
    await expect(login).toHaveValue(account.username);
    await expect(password).toBeFocused();
  }
  await expect(page).toHaveURL(/\/tasks$/);

  await logIn(page, account.username, account.password);
  await expect(dialog.getByRole("alert")).toHaveText(/^Too many sign-in attempts\. Try again in \d+ minutes?\.$/);
  await expect(login).toHaveValue(account.username);

  // Closing it leaves the guest workspace as it was.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  await openLogIn(page);
});

test("an unconfirmed email says so in the pop-up, and the guest workspace stays until Get a new link", async ({ page, browser, baseURL }) => {
  const account = await makeAccount(browser, baseURL, "Pop-up unconfirmed", { confirmEmail: false });
  await continueAsGuest(page);
  await page.goto("/events");
  const dialog = await openLogIn(page);
  await logIn(page, account.email, account.password);
  await expect(dialog.getByRole("alert")).toContainText("Your email isn't confirmed yet. Open the link we sent you.");
  await expect(dialog.getByLabel("Email or username")).toHaveValue(account.email);

  // Still a guest behind it: closed, the workspace and its profile are as they were.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const reopened = await openLogIn(page);
  await page.keyboard.press("Escape");
  await expect(reopened).toHaveCount(0);
  await expect(page).toHaveURL(/\/events$/);

  // Get a new link goes on to "Check your email" (#350), which comes back here once it's confirmed.
  await openLogIn(page);
  await logIn(page, account.username, account.password);
  await dialog.getByRole("button", { name: "Get a new link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page).toHaveURL(/\/verify-email\?next=%2Fevents$/);
});

test("New here? Sign up free switches to the sign-up pop-up and back, and × or a click outside closes it", async ({ page }) => {
  await continueAsGuest(page);
  await page.goto("/notes");
  const dialog = await openLogIn(page);
  await dialog.getByRole("button", { name: "Sign up free" }).click();
  const signup = page.getByRole("dialog", { name: "Keep your work with a free account" });
  await expect(signup).toBeVisible();
  await expect(signup.getByRole("link", { name: "Sign up with email" })).toHaveAttribute("href", "/signup?next=%2Fnotes");

  // The sign-up pop-up's Log in comes back, in the same pop-up.
  await signup.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);

  await openLogIn(page);
  await page.mouse.click(4, 4);
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible();
});

test("Log in works from the keyboard alone, and Esc goes back to where it opened", async ({ page, browser, baseURL, isMobile }) => {
  test.skip(isMobile, "A phone has no keyboard to tab with.");
  const account = await makeAccount(browser, baseURL, "Pop-up keyboard");
  await continueAsGuest(page);
  const open = page.getByRole("region", { name: "Guest workspace" }).getByRole("button", { name: "Log in", exact: true });
  await open.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Log in to AI Multi" });
  await expect(dialog.getByRole("button", { name: "Continue with Google" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "Continue with Google" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Email or username")).toBeFocused();
  await page.keyboard.type(account.username);
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Password")).toBeFocused();
  await page.keyboard.type(account.password);
  await page.keyboard.press("Enter");
  await expectHome(page);
  await expect(accountMenuButton(page)).toHaveAccessibleName(`${account.name} Settings and theme`);
});

test("logging in from a guest's own project lands on Projects, and from the AI's pop-up on the AI", async ({ page, browser, baseURL }) => {
  const account = await makeAccount(browser, baseURL, "Pop-up landing");
  // The sample workspace's projects are the guest's: the account can't open them.
  await page.goto("/");
  await expectHome(page);
  await page.goto("/projects");
  await page.locator("#main-content").getByRole("link", { name: "Launch website", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await openLogIn(page);
  await logIn(page, account.email, account.password);
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();

  // The AI asks a guest to sign up (#458); logging in from there opens the AI.
  const other = await browser.newContext({ baseURL });
  const guest = await other.newPage();
  await continueAsGuest(guest);
  await guest.goto("/ai");
  const signup = guest.getByRole("dialog", { name: "The AI needs a free account" });
  await signup.getByRole("button", { name: "Log in", exact: true }).click();
  await logIn(guest, account.username, account.password);
  await expect(guest).toHaveURL(/\/ai$/);
  await expect(guest.getByRole("textbox", { name: "Message the AI" })).toBeVisible();
  await other.close();
});

test("the login route answers the pop-up in JSON, and only from this site", async ({ page, browser, baseURL, isMobile }) => {
  test.skip(isMobile, "The answers don't depend on the screen.");
  const account = await makeAccount(browser, baseURL, "Pop-up JSON");
  const unconfirmed = await makeAccount(browser, baseURL, "Pop-up JSON unconfirmed", { confirmEmail: false });
  const fromPopup = { accept: "application/json", "sec-fetch-site": "same-origin" };
  const post = (form: Record<string, string>, headers: Record<string, string> = fromPopup) =>
    page.request.post("/api/auth/login", { form, headers, maxRedirects: 0 });
  const sessionCookie = (response: Awaited<ReturnType<typeof post>>) =>
    response.headersArray().some(({ name, value }) => name.toLowerCase() === "set-cookie" && value.startsWith("ai_multi_task_session="));

  const wrong = await post({ login: account.username, password: "wrong-password", next: "/tasks" });
  expect(wrong.status()).toBe(401);
  expect(await wrong.json()).toEqual({ error: "invalid" });

  const missing = await post({ login: " ", password: "anything", next: "/tasks" });
  expect(missing.status()).toBe(400);
  expect(await missing.json()).toEqual({ error: "missing" });

  // The right password for an unconfirmed email: no session, so a guest's stays.
  const notYet = await post({ login: unconfirmed.email, password: unconfirmed.password, next: "/tasks" });
  expect(notYet.status()).toBe(403);
  expect(await notYet.json()).toEqual({ error: "unconfirmed" });
  expect(sessionCookie(notYet)).toBe(false);

  // Another site's script gets nothing, not even a check of the password.
  const crossSite = await post({ login: account.email, password: account.password, next: "/" }, { accept: "application/json", "sec-fetch-site": "cross-site" });
  expect(crossSite.status()).toBe(403);
  expect(await crossSite.json()).toEqual({ error: "cross-site" });
  expect(sessionCookie(crossSite)).toBe(false);

  const right = await post({ login: account.email, password: account.password, next: "/tasks" });
  expect(right.status()).toBe(200);
  expect(await right.json()).toEqual({ next: "/tasks" });
  expect(sessionCookie(right)).toBe(true);

  // The /login page's plain form post still answers with a redirect.
  const plain = await post({ login: account.email, password: account.password, next: "/tasks" }, {});
  expect(plain.status()).toBe(303);
  expect(new URL(plain.headers().location).pathname).toBe("/tasks");
});
