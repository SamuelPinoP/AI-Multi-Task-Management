import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest, signUpAndLogIn, uniqueName } from "./helpers";

// Each page's name shows once on phones and tablets (#420, design 3A): the page keeps its own title, and
// the bar above it takes the name only once that title has scrolled under it. Pages whose header never
// scrolls away, the chats, make that header their only bar. Computers have no bar at all (#410).

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The bar's copy of the page's name, its first div: the menu button, the profile and the button at the right are buttons. */
function barName(page: Page) {
  return page.getByRole("banner").locator("div").first();
}

test("the bar names the page only once the page's own title has scrolled under it", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Computers have no bar above the page (#410).");
  await continueAsGuest(page);
  // A daily event fills the agenda, so the Calendar scrolls.
  const created = await page.request.post("/api/events", {
    data: { title: uniqueName("Standup"), startDate: dateInputValue(0), startTime: "09:00", endDate: "", endTime: "09:15", recurrence: "DAILY" },
  });
  expect(created.ok()).toBe(true);
  await page.goto("/events");

  const heading = page.getByRole("heading", { level: 1, name: "Calendar" }).filter({ visible: true });
  const name = barName(page);
  const main = page.locator("#main-content");
  await expect(heading).toBeInViewport();
  await expect(name).toHaveText("Calendar");

  // The page's title is on screen: the bar shows the menu button and the profile, and screen readers hear the name once.
  await expect(name).toHaveCSS("opacity", "0");
  await expect(name).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByRole("banner").getByRole("button", { name: /^Open navigation/ })).toBeVisible();

  // With the title scrolled under the bar, its name moves into the bar.
  await main.evaluate((element) => element.scrollTo(0, 400));
  await expect(heading).not.toBeInViewport();
  await expect(name).toHaveCSS("opacity", "1");
  await expect(name).not.toHaveAttribute("aria-hidden", "true");

  // Back at the top, it leaves the bar again.
  await main.evaluate((element) => element.scrollTo(0, 0));
  await expect(heading).toBeInViewport();
  await expect(name).toHaveCSS("opacity", "0");
});

test("a page without a title of its own keeps its name in the bar", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Computers have no bar above the page (#410).");
  await continueAsGuest(page);
  // Tree view's own headings are h2s, so the bar names the page.
  await page.goto("/tree");
  await expect(page.getByRole("heading", { name: "Create your first Tree View page" })).toBeVisible();
  await expect(barName(page)).toHaveText("Tree view");
  await expect(barName(page)).toHaveCSS("opacity", "1");
  await expect(barName(page)).not.toHaveAttribute("aria-hidden", "true");

  // Boards has a big title of its own, "All Tasks", so there the bar keeps quiet until it scrolls away.
  await page.goto("/board");
  await expect(page.getByRole("heading", { level: 1, name: "All Tasks" }).filter({ visible: true })).toBeVisible();
  await expect(barName(page)).toHaveText("Boards");
  await expect(barName(page)).toHaveCSS("opacity", "0");
});

test("chat pages make their own header the only bar on phones, and computers keep theirs", async ({ page, isMobile }) => {
  await continueAsGuest(page);
  const name = uniqueName("One bar project");
  const project = (await (await page.request.post("/api/projects", { data: { name } })).json()) as { id: string };

  // A project's chat: back, the photo, the name and search, with the name shown once.
  await page.goto(`/projects/${project.id}/chat`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Project" })).toBeVisible();
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.locator("#main-content").getByText(name, { exact: true }).filter({ visible: true })).toHaveCount(1);
  if (isMobile) await expect(page.getByText(name, { exact: true }).filter({ visible: true })).toHaveCount(1);

  // The Chats list: on a phone its own header holds the menu button, which opens the menu.
  await page.goto("/chats");
  const listMenuButton = page.locator("#chat-list").getByRole("button", { name: /^Open navigation/ });
  if (isMobile) {
    await expect(page.getByRole("banner")).toHaveCount(0);
    await listMenuButton.click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);
  } else {
    await expect(listMenuButton).toBeHidden();
  }

  // An open chat on a phone: its header, with back to the list, is the only bar.
  await page.goto(`/chats?project=${project.id}`);
  const conversation = page.getByRole("region", { name: "Conversation" });
  await expect(conversation.getByRole("heading", { name })).toBeVisible();
  if (isMobile) {
    await expect(conversation.getByRole("link", { name: "All chats" })).toBeVisible();
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect(page.getByText(name, { exact: true }).filter({ visible: true })).toHaveCount(1);
  }
});

// #461, design A: the profile sits beside the menu button and folds into its picture once the page's
// name moves into the bar. A guest sees what's left and Sign up free; an account, its name and search.
test("a guest's profile sits beside the menu button and folds when the page name moves in", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Computers have no bar above the page (#410).");
  await continueAsGuest(page);
  const created = await page.request.post("/api/events", {
    data: { title: uniqueName("Standup"), startDate: dateInputValue(0), startTime: "09:00", endDate: "", endTime: "09:15", recurrence: "DAILY" },
  });
  expect(created.ok()).toBe(true);
  await page.goto("/events");
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" }).filter({ visible: true })).toBeInViewport();

  const bar = page.getByRole("banner");
  const profile = bar.getByRole("button", { name: "Guest 5 tasks left" });
  await expect(profile).toBeVisible();
  await expect(bar.getByRole("button", { name: "Sign up free" })).toBeVisible();
  // The menu button comes first, then the profile.
  const menu = (await bar.getByRole("button", { name: /^Open navigation/ }).boundingBox())!;
  const open = (await profile.boundingBox())!;
  expect(open.x).toBeGreaterThanOrEqual(menu.x + menu.width);

  // Its card opens below it.
  await profile.click();
  await expect(page.getByRole("region", { name: "Guest workspace" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Guest workspace" })).toHaveCount(0);

  // Scrolled, the page's name moves in and the profile folds to its avatar; it keeps its name.
  await page.locator("#main-content").evaluate((element) => element.scrollTo(0, 400));
  await expect(barName(page)).toHaveCSS("opacity", "1");
  await expect.poll(async () => (await profile.boundingBox())!.width).toBeLessThan(open.width - 40);
  await expect(profile).toHaveAccessibleName("Guest 5 tasks left");
});

test("an account's picture and name open the profile menu, and search sits at the right", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Computers have no bar above the page (#410).");
  const { name } = await signUpAndLogIn(page, "Top bar");
  const bar = page.getByRole("banner");
  await bar.getByRole("button", { name: `${name} Settings and theme` }).click();
  await expect(page.getByRole("menuitem", { name: "Account settings" })).toBeVisible();
  await page.keyboard.press("Escape");

  await bar.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByPlaceholder("Search or run a command...")).toBeVisible();
});
