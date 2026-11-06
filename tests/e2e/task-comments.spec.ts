import { expect, test } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

// Comments and a change history on each task (#279).
test("comments: add, edit and delete one; the history records changes", async ({ page }) => {
  const title = uniqueName("Discussed task");
  await continueAsGuest(page);
  expect((await page.request.post("/api/tasks", { data: { title } })).ok()).toBe(true);
  await page.goto("/tasks");
  await page.getByRole("button", { name: title, exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Edit task" });
  const activity = sheet.getByRole("region", { name: "Activity" });
  await expect(activity).toContainText("created the task");

  // Add, with a link that becomes clickable.
  await activity.getByLabel("Leave a comment").fill("Usage numbers live at https://vercel.com/dashboard for now.");
  await activity.getByRole("button", { name: "Comment" }).click();
  await expect(activity.getByRole("link", { name: "https://vercel.com/dashboard" })).toBeVisible();

  // Edit: it says "edited".
  await activity.getByRole("button", { name: "Comment actions" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await activity.getByLabel("Edit comment").fill("Usage numbers are on the Vercel dashboard.");
  await activity.getByRole("button", { name: "Save" }).click();
  await expect(activity).toContainText("Usage numbers are on the Vercel dashboard.");
  await expect(activity).toContainText("edited");

  // Delete, after confirming.
  await activity.getByRole("button", { name: "Comment actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete this comment?" }).getByRole("button", { name: "Delete comment" }).click();
  await expect(page.getByText("Comment deleted")).toBeVisible();
  await expect(activity).not.toContainText("Usage numbers");

  // A saved change shows in the history.
  await sheet.getByLabel("Priority").selectOption("HIGH");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(sheet).toBeHidden();
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit task" }).getByRole("region", { name: "Activity" })).toContainText("set the priority to High");
  await page.getByRole("dialog", { name: "Edit task" }).getByRole("radio", { name: "Comments" }).click();
  await expect(page.getByRole("dialog", { name: "Edit task" }).getByRole("region", { name: "Activity" })).toContainText("No comments yet.");
});
