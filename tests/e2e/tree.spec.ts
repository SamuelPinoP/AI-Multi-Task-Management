import { expect, test, type Locator, type Page } from "@playwright/test";
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
  await expect(main.getByRole("button", { name: "First step", exact: true })).toBeVisible();

  await pages.getByRole("button", { name: "New Tree Page" }).click();
  await createTreePage(page, "Ideas");
  await expect(page).toHaveURL(/\/tree\/[^/]+$/);
  const ideasUrl = page.url();
  expect(ideasUrl).not.toBe(roadmapUrl);
  await expect(pages.getByRole("link", { name: "Ideas" })).toHaveAttribute("aria-current", "page");
  await expect(main.getByRole("button", { name: "First step", exact: true })).toHaveCount(0);

  // Switching pages changes the address without a reload, and Back returns to the last page.
  await pages.getByRole("link", { name: "Roadmap" }).click();
  await expect(page).toHaveURL(roadmapUrl);
  await expect(main.getByRole("button", { name: "First step", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(ideasUrl);
  await expect(pages.getByRole("link", { name: "Ideas" })).toHaveAttribute("aria-current", "page");

  // Opening the link directly shows that page and its nodes.
  await page.goto(roadmapUrl);
  await expect(pages.getByRole("link", { name: "Roadmap" })).toHaveAttribute("aria-current", "page");
  await expect(main.getByRole("button", { name: "First step", exact: true })).toBeVisible();

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

// TREE-02: drag a node by its handle. The left or right quarter of a card places it beside
// that card; the middle makes it a child.
async function dragOnto(page: Page, handle: Locator, target: Locator, fractionX: number) {
  await target.scrollIntoViewIfNeeded();
  const from = (await handle.boundingBox())!;
  const to = (await target.boundingBox())!;
  const x = to.x + to.width * fractionX;
  const y = to.y + to.height / 2;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Past the 6px a drag needs to start, then across in steps so each move is seen.
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 3 });
  await page.mouse.move(x, y, { steps: 15 });
  await page.mouse.move(x + 1, y, { steps: 2 });
  await page.mouse.up();
}

test("dragging a node moves it with everything under it, and the move is saved", async ({ page, isMobile }) => {
  test.skip(isMobile, "Both cards must be on screen side by side; the desktop run covers dragging.");
  await continueAsGuest(page);
  const post = async (url: string, data: Record<string, unknown>) => (await page.request.post(url, { data })).json();
  const tree = (await post("/api/tree-pages", { title: "Drag test" })) as { id: string; nodes: { id: string }[] };
  const rootId = tree.nodes[0].id;
  const alpha = (await post(`/api/tree-pages/${tree.id}/nodes`, { title: "Alpha", parentId: rootId })) as { id: string };
  const beta = (await post(`/api/tree-pages/${tree.id}/nodes`, { title: "Beta", parentId: rootId })) as { id: string };
  await post(`/api/tree-pages/${tree.id}/nodes`, { title: "Beta child", parentId: beta.id });

  const saved = async () => {
    const pages = (await (await page.request.get("/api/tree-pages")).json()) as {
      id: string;
      nodes: { id: string; title: string; parentId: string | null; sortOrder: number }[];
    }[];
    const nodes = pages.find((item) => item.id === tree.id)!.nodes;
    const byTitle = (title: string) => nodes.find((node) => node.title === title)!;
    return {
      parentOf: (title: string) => byTitle(title).parentId,
      rootOrder: nodes.filter((node) => node.parentId === rootId).sort((a, b) => a.sortOrder - b.sortOrder).map((node) => node.title).join(", "),
    };
  };

  await page.goto(`/tree/${tree.id}`);
  const main = page.locator("#main-content");
  const card = (title: string) => main.locator("article").filter({ has: page.getByRole("button", { name: title, exact: true }) });
  const handle = (title: string) => main.getByRole("button", { name: `Move ${title}`, exact: true });
  await expect(card("Alpha")).toBeVisible();
  await expect(main.getByRole("button", { name: "Move Drag test" })).toHaveCount(0);

  // Beta, with its child, into the middle of Alpha.
  await dragOnto(page, handle("Beta"), card("Alpha"), 0.5);
  await expect.poll(async () => (await saved()).parentOf("Beta")).toBe(alpha.id);
  expect((await saved()).parentOf("Beta child")).toBe(beta.id);

  // A node can't go inside its own subtree: nothing is sent and nothing changes.
  await dragOnto(page, handle("Alpha"), card("Beta"), 0.5);
  await expect(card("Beta")).toBeVisible();
  expect((await saved()).parentOf("Alpha")).toBe(rootId);
  expect((await saved()).parentOf("Beta")).toBe(alpha.id);

  // Beta onto Alpha's left edge: back under the root, just before Alpha.
  await dragOnto(page, handle("Beta"), card("Alpha"), 0.1);
  await expect.poll(async () => (await saved()).rootOrder).toBe("Beta, Alpha");

  // The new order survives a reload.
  await page.reload();
  await expect(card("Beta")).toBeVisible();
  const betaBox = (await card("Beta").boundingBox())!;
  const alphaBox = (await card("Alpha").boundingBox())!;
  expect(betaBox.x).toBeLessThan(alphaBox.x);
});

// TREE-03: the same moves without dragging (WCAG 2.5.7), so this runs on phones too.
test("Move to… moves a node, with everything under it, without dragging", async ({ page }) => {
  await continueAsGuest(page);
  const post = async (url: string, data: Record<string, unknown>) => (await page.request.post(url, { data })).json();
  const tree = (await post("/api/tree-pages", { title: "Menu test" })) as { id: string; nodes: { id: string }[] };
  const rootId = tree.nodes[0].id;
  const alpha = (await post(`/api/tree-pages/${tree.id}/nodes`, { title: "Alpha", parentId: rootId })) as { id: string };
  await post(`/api/tree-pages/${tree.id}/nodes`, { title: "Alpha child", parentId: alpha.id });
  const beta = (await post(`/api/tree-pages/${tree.id}/nodes`, { title: "Beta", parentId: rootId })) as { id: string };
  await post(`/api/tree-pages/${tree.id}/nodes`, { title: "Beta child", parentId: beta.id });
  const nodesNow = async () => {
    const pages = (await (await page.request.get("/api/tree-pages")).json()) as {
      id: string;
      nodes: { id: string; title: string; parentId: string | null; sortOrder: number }[];
    }[];
    return pages.find((item) => item.id === tree.id)!.nodes;
  };

  await page.goto(`/tree/${tree.id}`);
  const main = page.locator("#main-content");
  const card = (title: string) => main.locator("article").filter({ has: page.getByRole("button", { name: title, exact: true }) });
  await card("Beta").getByRole("button", { name: "Move to…" }).click();
  const dialog = page.getByRole("dialog", { name: "Move “Beta”" });
  await expect(dialog).toBeVisible();
  const under = dialog.getByRole("combobox", { name: "Put it under" });
  // Nothing inside Beta's own subtree is offered, and staying put isn't a move.
  await expect(under.locator("option", { hasText: "Beta child" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Move", exact: true })).toBeDisabled();

  await under.selectOption({ label: "   Alpha" });
  await dialog.getByRole("combobox", { name: "Position" }).selectOption({ label: "First" });
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () =>
      (await nodesNow())
        .filter((node) => node.parentId === alpha.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((node) => node.title)
        .join(", "),
    )
    .toBe("Beta, Alpha child");
  expect((await nodesNow()).find((node) => node.title === "Beta child")!.parentId).toBe(beta.id);

  // Ctrl+Z puts it back where it was: under the root, after Alpha. Undo is ready once the
  // browser has the save, which is when the toast appears.
  const moved = page.getByText("Moved “Beta”.");
  const rootOrder = async () =>
    (await nodesNow())
      .filter((node) => node.parentId === rootId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((node) => node.title)
      .join(", ");
  await expect(moved).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect.poll(rootOrder).toBe("Alpha, Beta");

  // So does the Undo in the toast that follows a move.
  await card("Beta").getByRole("button", { name: "Move to…" }).click();
  await dialog.getByRole("combobox", { name: "Position" }).selectOption({ label: "First" });
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect.poll(rootOrder).toBe("Beta, Alpha");
  await expect(moved).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(rootOrder).toBe("Alpha, Beta");
});
