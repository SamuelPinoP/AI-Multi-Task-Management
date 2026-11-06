import { expect, test } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

// Comments and a change history on each task (#279), on the task's page (#352).
test("comments: add, edit and delete one; the history records changes", async ({ page }) => {
  const title = uniqueName("Discussed task");
  await continueAsGuest(page);
  expect((await page.request.post("/api/tasks", { data: { title } })).ok()).toBe(true);
  await page.goto("/tasks");
  await page.getByRole("button", { name: title, exact: true }).click();
  const activity = page.getByRole("region", { name: "Activity" });
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

  // A change shows in the history at once. The picker narrows the list as you type.
  await page.getByRole("button", { name: "Priority: No priority" }).click();
  await expect(page.getByRole("option")).toHaveText(["No priority, current", "Urgent", "High", "Medium", "Low"]);
  await page.getByLabel("Change priority").fill("hi");
  await expect(page.getByRole("option")).toHaveText(["High"]);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Priority: High" })).toBeVisible();
  await expect(activity).toContainText("set the priority to High");
  await activity.getByRole("radio", { name: "Comments" }).click();
  await expect(activity).toContainText("No comments yet.");
});

test("the task page: the big Mark done, previous and next, and Escape back to the list", async ({ page }) => {
  const first = uniqueName("Page first");
  const second = uniqueName("Page second");
  await continueAsGuest(page);
  for (const title of [first, second]) expect((await page.request.post("/api/tasks", { data: { title } })).ok()).toBe(true);
  await page.goto("/tasks");
  // Newest first: second, then first.
  await page.getByRole("button", { name: second, exact: true }).click();
  await expect(page.getByLabel("Title")).toHaveValue(second);

  const markDone = page.getByRole("complementary", { name: "Properties" }).getByRole("button", { name: "Mark done" });
  await expect(markDone).toBeVisible();
  await markDone.click();
  await expect(page.getByText("Task completed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Status: Done" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Activity" })).toContainText("marked it done");

  // Previous and next follow the list's order (on screens wider than a phone).
  const next = page.getByRole("link", { name: "Next task" });
  if (await next.isVisible()) {
    await next.click();
    await expect(page.getByLabel("Title")).toHaveValue(first);
  }

  await page.locator("body").press("Escape");
  await expect(page).toHaveURL(/\/tasks$/);
});
