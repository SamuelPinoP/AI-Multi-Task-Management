import { expect, test, type Page } from "@playwright/test";
import { continueAsGuest } from "./helpers";

// TREE-01: each tree page has its own link, /tree/<id>.

async function createTreePage(page: Page, title: string) {
  const dialog = page.getByRole("dialog", { name: "New tree page" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Tree page name" }).fill(title);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("tree pages have their own links that survive switching, Back and reload", async ({ page }) => {
  await continueAsGuest(page);
  const main = page.locator("#main-content");
  const pages = main.getByRole("navigation", { name: "Tree pages" });

  // The old Boards link still leads here.
  await page.goto("/board?view=tree");
  await expect(page).toHaveURL(/\/tree$/);
  await expect(main.getByRole("heading", { name: "Create your first Tree View page" })).toBeVisible();

  await main.getByRole("button", { name: "Create tree page" }).click();
  await createTreePage(page, "Roadmap");
  await expect(page).toHaveURL(/\/tree\/[^/]+$/);
  const roadmapUrl = page.url();
  await expect(pages.getByRole("link", { name: "Roadmap" })).toHaveAttribute("aria-current", "page");

  await main.getByRole("button", { name: "Add child" }).click();
  await main.getByRole("textbox", { name: "Create child: title" }).fill("First step");
  await main.getByRole("button", { name: "Create", exact: true }).click();
  await expect(main.getByRole("button", { name: "First step" })).toBeVisible();

  await pages.getByRole("button", { name: "New Tree Page" }).click();
  await createTreePage(page, "Ideas");
  await expect(page).toHaveURL(/\/tree\/[^/]+$/);
  const ideasUrl = page.url();
  expect(ideasUrl).not.toBe(roadmapUrl);
  await expect(pages.getByRole("link", { name: "Ideas" })).toHaveAttribute("aria-current", "page");
  await expect(main.getByRole("button", { name: "First step" })).toHaveCount(0);

  // Switching pages changes the address without a reload, and Back returns to the last page.
  await pages.getByRole("link", { name: "Roadmap" }).click();
  await expect(page).toHaveURL(roadmapUrl);
  await expect(main.getByRole("button", { name: "First step" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(ideasUrl);
  await expect(pages.getByRole("link", { name: "Ideas" })).toHaveAttribute("aria-current", "page");

  // Opening the link directly shows that page and its nodes.
  await page.goto(roadmapUrl);
  await expect(pages.getByRole("link", { name: "Roadmap" })).toHaveAttribute("aria-current", "page");
  await expect(main.getByRole("button", { name: "First step" })).toBeVisible();

  // Deleting the open page moves to the next one in place of the deleted link.
  await main.getByRole("button", { name: "Delete tree page" }).click();
  await page.getByRole("dialog", { name: "Delete this tree page?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(ideasUrl);
  await expect(pages.getByRole("link", { name: "Roadmap" })).toHaveCount(0);
});

test("someone else's tree page is not found", async ({ page, browser }) => {
  await continueAsGuest(page);
  const tree = (await (await page.request.post("/api/tree-pages", { data: { title: "Private plans" } })).json()) as { id: string };

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await continueAsGuest(other);
  await other.goto(`/tree/${tree.id}`);
  await expect(other.getByText("This page could not be found.")).toBeVisible();
  await expect(other.getByText("Private plans")).toHaveCount(0);
  await otherContext.close();
});
