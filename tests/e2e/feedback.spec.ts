import { expect, test } from "@playwright/test";
import { continueAsGuest, openAccountMenu, signUpAndLogIn } from "./helpers";

// Send feedback (#430), design A: in the profile menu, right under Account settings. The e2e server lists
// an admin in ADMIN_EMAILS and sends no email, so a sent message ends at the toast.

test("someone sends feedback from the profile menu", async ({ page }) => {
  await signUpAndLogIn(page, "Feedback sender");

  await openAccountMenu(page);
  const names = (await page.getByRole("menuitem").allInnerTexts()).map((name) => name.trim());
  expect(names.indexOf("Send feedback")).toBe(names.indexOf("Account settings") + 1);
  await page.getByRole("menuitem", { name: "Send feedback" }).click();

  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Samuel reads every message.");
  const send = dialog.getByRole("button", { name: "Send feedback" });
  // Nothing to send yet, and spaces don't count.
  await expect(send).toBeDisabled();
  await dialog.getByLabel("Your feedback").fill("   ");
  await expect(send).toBeDisabled();

  await dialog.getByLabel("Your feedback").fill("The calendar is great.\nCould tasks have colors?");
  await dialog.getByLabel("Samuel can email me about this").check();
  await send.click();
  await expect(page.getByText("Thanks! Your feedback was sent.")).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // Opened again, it starts empty.
  await openAccountMenu(page);
  await page.getByRole("menuitem", { name: "Send feedback" }).click();
  await expect(page.getByRole("dialog", { name: "Send feedback" }).getByLabel("Your feedback")).toHaveValue("");
  await expect(page.getByRole("dialog", { name: "Send feedback" }).getByLabel("Samuel can email me about this")).not.toBeChecked();
  await page.getByRole("dialog", { name: "Send feedback" }).getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Send feedback" })).toHaveCount(0);
});

test("a guest has no Send feedback, and the address refuses them", async ({ page }) => {
  await continueAsGuest(page);
  await openAccountMenu(page);
  await expect(page.getByRole("menuitem", { name: "Log out" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Send feedback" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  const response = await page.request.post("/api/feedback", { data: { message: "Hello" } });
  expect(response.status()).toBe(403);
});

test("the feedback address checks who sends, what, and how often", async ({ page, request }) => {
  // Signed out.
  expect((await request.post("/api/feedback", { data: { message: "Hello" } })).status()).toBe(401);

  await signUpAndLogIn(page, "Feedback limits");
  const post = (data: unknown) => page.request.post("/api/feedback", { data });

  const empty = await post({ message: "  " });
  expect(empty.status()).toBe(400);
  expect(await empty.json()).toEqual({ error: "Write your feedback first." });
  const long = await post({ message: "x".repeat(2001) });
  expect(long.status()).toBe(400);
  expect(await long.json()).toEqual({ error: "Keep it under 2,000 characters." });

  // Five an hour per person; the refused ones above don't count.
  for (let sent = 1; sent <= 5; sent += 1) {
    expect((await post({ message: `Note ${sent}`, mayReply: sent % 2 === 0 })).status(), `message ${sent}`).toBe(201);
  }
  const sixth = await post({ message: "One more" });
  expect(sixth.status()).toBe(429);
  expect((await sixth.json()).error).toMatch(/^Too many messages\. Try again in \d+ minutes?\.$/);
});
