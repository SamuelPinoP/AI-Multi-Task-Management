import { expect, test } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

test("notes: a link opens the editor; project changes save; delete moves to Trash", async ({ page }) => {
  const title = uniqueName("Linked note");
  await continueAsGuest(page);
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("Notes project") } })).json()) as {
    id: string;
    name: string;
  };
  const note = (await (
    await page.request.post("/api/notes", { data: { title, content: "Opened from a link.", projectId: project.id } })
  ).json()) as { id: string };

  await page.goto(`/notes?openNote=${note.id}&focus=title`);
  const editor = page.getByRole("dialog");
  await expect(editor.getByLabel("Title")).toHaveValue(title);
  await expect(editor.getByLabel("Title")).toBeFocused();

  await editor.getByLabel("Project").selectOption("");
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(editor).toBeHidden();
  await expect(page).toHaveURL(/\/notes$/);

  await page.reload();
  // The card is the list item; its title button covers the whole card.
  const card = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: title }) });
  await expect(card).toContainText("Opened from a link.");
  await expect(card).not.toContainText(project.name);

  await card.click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete note" }).click();
  await page.getByRole("dialog", { name: "Delete this note?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: title })).toHaveCount(0);

  await page.goto("/trash");
  await expect(page.getByText(title)).toBeVisible();
});
