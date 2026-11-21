import { expect, test } from "@playwright/test";
import { plusTab, signUpAndLogIn, uniqueName } from "./helpers";

test("quick add reads dates, #project, !priority and @person before saving", async ({ page, isMobile }) => {
  // An account: it adds a member, which guests can't (#458).
  await signUpAndLogIn(page, "Quick add");
  const projectName = uniqueName("Capstone");
  const project = (await (await page.request.post("/api/projects", { data: { name: projectName } })).json()) as { id: string };
  expect(
    (await page.request.post(`/api/projects/${project.id}/members`, { data: { name: "Dana Lee", role: "EDITOR" } })).ok(),
  ).toBe(true);
  const projectToken = `#${projectName.replace(/\s+/g, "-")}`;

  await page.goto("/tasks");
  // The add box sits under the header on a computer. On a phone it's a sheet from the + tab, which closes once it
  // adds the task (#521).
  const input = page.getByRole("textbox", { name: "Add a task", exact: true });
  const details = page.getByRole("list", { name: "Details from your text" });
  const openBox = async () => {
    if (isMobile) await plusTab(page).click();
  };
  const expectSaved = async () => {
    if (isMobile) await expect(page.getByRole("dialog", { name: "Add a task" })).toBeHidden();
    else await expect(input).toHaveValue("");
  };

  // Hints explain tokens that can't be used yet.
  await openBox();
  await input.fill("Call @Dana");
  await expect(page.getByText("Add a #project to assign @Dana")).toBeVisible();

  // The chips show what will be saved; the title keeps only the words.
  const title = uniqueName("Draft slides");
  await input.fill(`${title} tomorrow ${projectToken} !high @Dana`);
  await expect(details.getByRole("listitem")).toHaveCount(4);
  await expect(details).toContainText(projectName);
  await expect(details).toContainText("High");
  await expect(details).toContainText("Dana Lee");

  // A chip can be turned back into plain text.
  await input.fill(`${title} sat !low`);
  await expect(details.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Keep “sat” as text" }).click();
  await expect(details.getByRole("listitem")).toHaveCount(1);
  await input.press("Enter");
  await expectSaved();
  const kept = page.getByRole("region", { name: /^No due date/ });
  await expect(kept.getByRole("button", { name: `${title} sat`, exact: true })).toBeVisible();

  // Save the full example and check every field in the edit sheet.
  await openBox();
  await input.fill(`${title} tomorrow ${projectToken} !high @Dana`);
  await expect(details.getByRole("listitem")).toHaveCount(4);
  await input.press("Enter");
  await expectSaved();
  await page.getByRole("region", { name: /^Upcoming/ }).getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByLabel("Title")).toHaveValue(title);
  // "tomorrow" in the browser's calendar, which may differ from the test runner's.
  const tomorrow = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  });
  const properties = page.getByRole("complementary", { name: "Properties" });
  await expect(properties.getByRole("button", { name: `Due date: ${tomorrow}` })).toBeVisible();
  await expect(properties.getByRole("button", { name: "Priority: High" })).toBeVisible();
  await expect(properties.getByRole("button", { name: `Project: ${projectName}` })).toBeVisible();
  await expect(properties.getByRole("button", { name: "Assignee: Dana Lee" })).toBeVisible();
});
