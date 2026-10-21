import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

/** Selects `text` in the note editor the way a person would (the selection fires keyup too). */
async function selectInEditor(editor: Locator, text: string) {
  await editor.evaluate((element, wanted) => {
    const area = element as HTMLTextAreaElement;
    const start = area.value.indexOf(wanted);
    area.focus();
    area.setSelectionRange(start, start + wanted.length);
  }, text);
  await editor.press("Shift+ArrowRight");
  await editor.press("Shift+ArrowLeft");
}

test("linked notes: [[links]], backlinks, tasks from a selection and meeting notes (SMART-05)", async ({ page }) => {
  await continueAsGuest(page);
  const plan = uniqueName("Launch plan");
  const budget = uniqueName("Budget");
  const missing = uniqueName("Venue ideas");
  const action = uniqueName("Call the caterer");
  const post = async (url: string, data: Record<string, unknown>) => {
    const response = await page.request.post(url, { data });
    expect(response.ok(), url).toBe(true);
    return (await response.json()) as { id: string };
  };
  const planNote = await post("/api/notes", { title: plan, content: `Agenda\n${action}\nSee [[${budget}]] and [[${missing}]].` });
  await post("/api/notes", { title: budget, content: "Numbers" });

  // [[Links]] resolve to notes; a missing one offers to create it.
  await page.goto(`/notes?openNote=${planNote.id}&focus=content`);
  const sheet = page.getByRole("dialog");
  const links = sheet.getByRole("region", { name: "Links" });
  await expect(links.getByRole("button", { name: budget, exact: true })).toBeVisible();
  await expect(links.getByRole("button", { name: `Create the note ${missing}` })).toBeVisible();

  // Turn a selected line into a task that points back here.
  const editor = sheet.getByLabel("Note", { exact: true });
  await selectInEditor(editor, action);
  await sheet.getByRole("button", { name: "Turn selection into task" }).click();
  await expect(page.getByText("Task created")).toBeVisible();
  await expect(sheet.getByRole("region", { name: "Tasks from this note" }).getByRole("link", { name: action })).toBeVisible();
  // The editor's new controls pass axe's WCAG A/AA rules.
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.nodes[0]?.target.join(" ")}`)).toEqual([]);

  // The linked note shows the backlink.
  await links.getByRole("button", { name: budget, exact: true }).click();
  await expect(sheet.getByLabel("Title", { exact: true })).toHaveValue(budget);
  const backlinks = sheet.getByRole("region", { name: "Linked from" });
  await backlinks.getByRole("button", { name: plan, exact: true }).click();
  await expect(sheet.getByLabel("Title", { exact: true })).toHaveValue(plan);
  await sheet.getByRole("button", { name: `Create the note ${missing}` }).click();
  await expect(sheet.getByLabel("Title", { exact: true })).toHaveValue(missing);

  // The task opens the note it came from.
  await page.goto("/tasks");
  await page.getByRole("button", { name: action, exact: true }).click();
  await page.getByRole("link", { name: "Open the note this task came from" }).click();
  await expect(page).toHaveURL(new RegExp(`openNote=${planNote.id}`));
  await expect(page.getByRole("dialog").getByLabel("Title", { exact: true })).toHaveValue(plan);

  // Meeting notes: start them from an event; the event lists them.
  const today = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  const meeting = uniqueName("Kickoff");
  const event = await post("/api/events", { title: meeting, startDate: today, startTime: "10:00", endDate: "", endTime: "", recurrence: "NONE" });
  await page.goto(`/events?event=${event.id}`);
  await page.getByRole("dialog", { name: "Edit event" }).getByRole("button", { name: "Write meeting notes" }).click();
  await expect(page).toHaveURL(/\/notes\?openNote=/);
  const notesSheet = page.getByRole("dialog");
  await expect(notesSheet.getByLabel("Title", { exact: true })).toHaveValue(`Notes: ${meeting}`);
  await expect(notesSheet.getByLabel("Notes for event")).toHaveValue(event.id);
  await page.goto(`/events?event=${event.id}`);
  await expect(
    page.getByRole("dialog", { name: "Edit event" }).getByRole("region", { name: "Meeting notes" }).getByRole("link", { name: `Notes: ${meeting}` }),
  ).toBeVisible();
});
