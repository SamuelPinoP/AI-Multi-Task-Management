import { devices, expect, test, type Page } from "@playwright/test";
import { signUpAndLogIn, uniqueName } from "./helpers";

// #303: in a chat, Enter sends and Shift+Enter starts a new line, except on touch screens.

/** Creates a project, opens its chat and returns the project's id and the message box. */
async function openNewChat(page: Page) {
  const response = await page.request.post("/api/projects", { data: { name: uniqueName("E2E chat keys") } });
  expect(response.ok()).toBe(true);
  const { id } = (await response.json()) as { id: string };
  await page.goto(`/projects/${id}/chat`);
  const messageBox = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(messageBox).toBeVisible();
  return { projectId: id, messageBox };
}

/** Waits for the next message sent (POST) or edited (PATCH) in the project's chat, and returns what was saved. */
async function nextSaved(page: Page, projectId: string, method: "POST" | "PATCH") {
  const response = await page.waitForResponse(
    (res) => res.request().method() === method && res.url().includes(`/api/projects/${projectId}/comments`),
  );
  expect(response.ok()).toBe(true);
  return (await response.json()) as { message: string };
}

test("Enter sends a message, Shift+Enter starts a new line, and the same keys edit it", async ({ page }) => {
  await signUpAndLogIn(page, "E2E chat keys");
  const { projectId, messageBox } = await openNewChat(page);

  await messageBox.pressSequentially("Kickoff notes");
  await messageBox.press("Shift+Enter");
  await messageBox.pressSequentially("Launch on Friday");
  await expect(messageBox).toHaveValue("Kickoff notes\nLaunch on Friday");

  const sent = nextSaved(page, projectId, "POST");
  await messageBox.press("Enter");
  expect((await sent).message).toBe("Kickoff notes\nLaunch on Friday");
  await expect(messageBox).toHaveValue("");
  const message = page.locator("article").filter({ hasText: "Kickoff notes" });
  await expect(message).toContainText("Launch on Friday");

  // In an empty box, Enter neither sends nor complains, and adds no blank line.
  await messageBox.press("Enter");
  await expect(messageBox).toHaveValue("");
  await expect(page.getByText("Add a message or attach at least one file.")).toBeHidden();

  // Editing: Shift+Enter adds a line, Enter saves.
  await message.getByRole("button", { name: "Edit", exact: true }).click();
  const editBox = page.getByRole("textbox", { name: "Edit message" });
  await editBox.fill("Kickoff notes, revised");
  await editBox.press("Shift+Enter");
  await editBox.pressSequentially("Launch on Monday");
  const edited = nextSaved(page, projectId, "PATCH");
  await editBox.press("Enter");
  expect((await edited).message).toBe("Kickoff notes, revised\nLaunch on Monday");
  await expect(editBox).toBeHidden();
  await expect(message).toContainText("Launch on Monday");

  // Escape throws an edit away.
  await message.getByRole("button", { name: "Edit", exact: true }).click();
  await editBox.fill("A change to throw away");
  await editBox.press("Escape");
  await expect(editBox).toBeHidden();
  await expect(message).toContainText("Launch on Monday");
  await expect(message).not.toContainText("A change to throw away");
});

test("on a touch screen, Enter starts a new line and the Send button sends", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL });
  try {
    const page = await context.newPage();
    await signUpAndLogIn(page, "E2E chat keys on a phone");
    const { projectId, messageBox } = await openNewChat(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "the phone reports a touch screen").toBe(true);

    await messageBox.pressSequentially("Photos from the site visit");
    await messageBox.press("Enter");
    await messageBox.pressSequentially("More tomorrow");
    await expect(messageBox).toHaveValue("Photos from the site visit\nMore tomorrow");

    const sent = nextSaved(page, projectId, "POST");
    await page.getByRole("button", { name: "Send message" }).click();
    expect((await sent).message).toBe("Photos from the site visit\nMore tomorrow");
    await expect(messageBox).toHaveValue("");
  } finally {
    await context.close();
  }
});
