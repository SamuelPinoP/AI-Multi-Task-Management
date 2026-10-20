import { expect, test } from "@playwright/test";
import { continueAsGuest, openSection, uniqueName } from "./helpers";

test("projects: quick add, edit, archive, restore and delete", async ({ page }) => {
  const name = uniqueName("Card project");
  await continueAsGuest(page);
  await openSection(page, "Projects");
  await expect(page.getByRole("heading", { name: "No projects yet." })).toBeVisible();
  // The sidebar lists projects too, so look inside the page content.
  const main = page.locator("#main-content");

  await page.getByLabel("Add a project").fill(name);
  await page.getByLabel("Add a project").press("Enter");
  const card = main.getByRole("listitem").filter({ has: page.getByRole("link", { name }) });
  await expect(card).toContainText("0 open tasks");
  await expect(card).toContainText("Owner");

  // Edit in the sheet.
  await card.getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit project" });
  await sheet.getByLabel("Description").fill("Shown on the card.");
  await sheet.getByRole("radio", { name: "Violet" }).click();
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(sheet).toBeHidden();
  await expect(card).toContainText("Shown on the card.");

  // Archive hides it from Active; Restore brings it back.
  await card.getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(main.getByRole("link", { name })).toHaveCount(0);
  await page.getByRole("radio", { name: /^Archived/ }).click();
  await expect(card).toContainText("Archived");
  await card.getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Restore" }).click();
  await page.getByRole("radio", { name: /^Active/ }).click();
  await expect(main.getByRole("link", { name })).toBeVisible();

  // Delete warns that it can't be undone.
  await card.getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("dialog", { name: `Delete “${name}”?` });
  await expect(confirm).toContainText("can't be undone");
  await confirm.getByRole("button", { name: "Delete project" }).click();
  await expect(main.getByRole("link", { name })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No projects yet." })).toBeVisible();
});
