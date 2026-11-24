import { expect, test, type Locator, type Page } from "@playwright/test";
import { AI_NOTICE_VERSION } from "../../src/lib/ai/notice";
import { queryDatabase, signUpAndLogIn, uniqueName } from "./helpers";

// Tickets the AI writes (#433), on computers and phones. The card sums a ticket up and opens it as
// a draft with every section, where the person changes, renames, removes and adds sections before
// they apply it; Apply creates the task with the description as it is then. A task's page shows the
// sections formatted: each folds, edits with its own title, ticks its checklist, and goes with the
// bin, with Undo. Every ticket ends with the AI's estimate, which becomes the person's once they
// change it, and work over 2 days comes with subtasks that split it, unticked (#434). The server's
// fake model (src/lib/ai/providers/fake.ts) calls every tool a message names, with the JSON after
// each name.

const messageBox = (page: Page) => page.getByRole("textbox", { name: "Message the AI" });

/** Types a question and sends it with the button: on a touch screen Enter starts a new line (#303). */
async function ask(page: Page, question: string) {
  await messageBox(page).fill(question);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

/** A message the fake model reads as these tool calls, in order. */
const calls = (...named: Array<[string, Record<string, unknown>]>) => named.map(([name, args]) => `${name} ${JSON.stringify(args)}`).join(" ");

async function signedInWithTheNotice(page: Page, label: string) {
  await signUpAndLogIn(page, label);
  expect((await page.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).status()).toBe(200);
}

/** Clicks the button and waits for the save it starts: `PATCH` to a URL ending in `path`. */
async function saving(page: Page, path: RegExp, click: () => Promise<void>) {
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && path.test(new URL(response.url()).pathname));
  await click();
  const response = await saved;
  expect(response.status(), await response.text()).toBe(200);
}

/** The section's title, as the button that folds it. */
const fold = (scope: Locator, title: string) => scope.getByRole("button", { name: new RegExp(`^${title}( \\d+ of \\d+)?$`) });

/** The sections' titles, in order. */
const headings = (scope: Locator, level: 2 | 3) => scope.locator("section").getByRole("heading", { level });

const ticket = {
  summary: "Let people download their tasks as a CSV file from the Tasks page.",
  background: ["The person asked for a CSV export."],
  acceptanceCriteria: ["The Tasks page has an Export button", "The file has a column for each field", "A test downloads the file"],
  outOfScope: ["Importing tasks from a CSV file"],
  openQuestions: ["Should done tasks be in the file?", "Should the export follow the filters?"],
  estimate: { size: "1 day", reason: "A button, the file's columns and a test." },
};

test("a ticket: the card sums it up, the draft changes it, and Apply creates the task with every section", async ({ page, isMobile }, testInfo) => {
  test.setTimeout(90_000);
  await signedInWithTheNotice(page, "E2E tickets");
  const title = uniqueName("E2E Export tasks as CSV");
  const request = `Write a ticket for a CSV export. ${calls(["create_ticket", { title, ...ticket }])}`;

  await page.goto("/ai");
  await ask(page, request);
  await expect(page.getByRole("region", { name: "Conversation" })).toContainText(`Proposed: New task written as a ticket "${title}"`);

  // The card: the ticket's summary and what it holds, and the draft to open, never the Markdown.
  const card = page.getByRole("region", { name: "Changes to apply" });
  const box = card.getByRole("checkbox", { name: `New task ${title}` });
  await expect(box).toBeChecked();
  await expect(box).toHaveAccessibleName(new RegExp(`${ticket.summary} 3 acceptance criteria · 2 open questions`));
  await expect(card).not.toContainText("##");
  await expect(card.getByRole("button", { name: `Show details of ${title}` })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath(`ticket-card-${isMobile ? "phone" : "desktop"}.png`) });

  // The draft: every section in order, the person's own words folded at the end.
  await card.getByRole("button", { name: `Open draft of ${title}` }).click();
  const draft = page.getByRole("dialog", { name: title });
  await expect(draft).toBeVisible();
  await expect(draft).toContainText("Draft ticket · not created until you apply");
  await expect(headings(draft, 3)).toHaveText(["Summary", "Background", "Acceptance criteria 0 of 3", "Out of scope", "Open questions", "Estimate", "Original request"]);
  // The estimate is the AI's, with its reason (#434).
  await expect(draft.locator("p", { hasText: "AI estimate" })).toHaveText("1 day · AI estimate A button, the file's columns and a test.");
  await expect(fold(draft, "Original request")).toHaveAttribute("aria-expanded", "false");
  await expect(draft.getByText("Write a ticket for a CSV export.")).toHaveCount(0);
  await fold(draft, "Original request").click();
  await expect(draft.getByText(/^Write a ticket for a CSV export\./)).toBeVisible();
  // A phone's draft fills the screen.
  if (isMobile) expect((await draft.boundingBox())!.width).toBeCloseTo(page.viewportSize()!.width, 0);
  await page.screenshot({ path: testInfo.outputPath(`ticket-draft-${isMobile ? "phone" : "desktop"}.png`) });

  // Change the summary's text.
  const editor = draft.getByRole("group", { name: /^(Editing |New section)/ });
  const summary = "Let people download every task they can see as a CSV file.";
  await draft.getByRole("button", { name: "Edit Summary" }).click();
  await expect(editor.getByRole("textbox", { name: "Section text" })).toBeFocused();
  await editor.getByRole("textbox", { name: "Section text" }).fill(summary);
  await saving(page, /\/draft$/, () => editor.getByRole("button", { name: "Save" }).click());
  await expect(editor).toHaveCount(0);
  await expect(draft.getByText(summary)).toBeVisible();

  // Rename a section.
  await draft.getByRole("button", { name: "Edit Out of scope" }).click();
  await expect(draft.getByRole("group", { name: "Editing Out of scope" })).toBeVisible();
  await editor.getByRole("textbox", { name: "Section title" }).fill("Not in this ticket");
  await saving(page, /\/draft$/, () => editor.getByRole("button", { name: "Save" }).click());
  await expect(fold(draft, "Not in this ticket")).toBeVisible();
  await expect(fold(draft, "Out of scope")).toHaveCount(0);

  // Remove one, with the bin at the editor's top right.
  await draft.getByRole("button", { name: "Edit Background" }).click();
  const bin = editor.getByRole("button", { name: "Remove Background" });
  const [binBox, editorBox] = [(await bin.boundingBox())!, (await editor.boundingBox())!];
  expect(editorBox.x + editorBox.width - (binBox.x + binBox.width)).toBeLessThan(16);
  expect(binBox.y - editorBox.y).toBeLessThan(16);
  await saving(page, /\/draft$/, () => bin.click());
  await expect(page.getByText("Section removed")).toBeVisible();
  await expect(fold(draft, "Background")).toHaveCount(0);

  // Add a Cost section, with a list.
  await draft.getByRole("button", { name: "Add a section" }).click();
  await expect(editor.getByRole("textbox", { name: "Section title" })).toBeFocused();
  await editor.getByRole("textbox", { name: "Section title" }).fill("Cost");
  await editor.getByRole("textbox", { name: "Section text" }).fill("- Down payment: $2,000\n- Monthly cost: $40");
  await saving(page, /\/draft$/, () => editor.getByRole("button", { name: "Save" }).click());
  await expect(headings(draft, 3)).toHaveText(["Summary", "Acceptance criteria 0 of 3", "Not in this ticket", "Open questions", "Estimate", "Original request", "Cost"]);
  await expect(draft.getByRole("listitem").filter({ hasText: "Monthly cost: $40" })).toBeVisible();

  // Changing the estimate makes it the person's: the AI's mark goes (#434).
  await draft.getByRole("button", { name: "Edit Estimate" }).click();
  const estimateText = editor.getByRole("textbox", { name: "Section text" });
  await expect(estimateText).toHaveValue("**1 day** · AI estimate\nA button, the file's columns and a test.");
  await estimateText.fill("**2 days** · AI estimate\nA button, the file's columns and a test.");
  await saving(page, /\/draft$/, () => editor.getByRole("button", { name: "Save" }).click());
  await expect(draft.locator("p", { hasText: "2 days" })).toHaveText("2 days A button, the file's columns and a test.");
  await expect(draft.getByText("AI estimate")).toHaveCount(0);

  // The changes are kept with the proposal; nothing is created yet.
  const { rows } = await queryDatabase<{ description: string }>(`SELECT steps -> 0 ->> 'description' AS description FROM "AgentProposal" WHERE steps -> 0 ->> 'title' = $1`, [title]);
  expect(rows).toHaveLength(1);
  const description = rows[0].description;
  expect(description).toContain(`## Summary\n\n${summary}\n\n## Acceptance criteria\n\n- [ ] The Tasks page has an Export button`);
  expect(description).toContain("## Not in this ticket\n\n- Importing tasks from a CSV file");
  expect(description).toContain("## Estimate\n\n**2 days**\nA button, the file's columns and a test.\n\n## Original request");
  expect(description).toMatch(/## Cost\n\n- Down payment: \$2,000\n- Monthly cost: \$40$/);
  expect(description).not.toContain("## Background");
  expect((await queryDatabase(`SELECT id FROM "Task" WHERE title = $1`, [title])).rows).toEqual([]);

  // Back to the card, which sums up the changed ticket.
  await draft.getByRole("button", { name: isMobile ? "Back to the chat" : "Back to the card" }).last().click();
  await expect(draft).toBeHidden();
  await expect(box).toHaveAccessibleName(new RegExp(`${summary} 3 acceptance criteria · 2 open questions`));

  // Apply creates the task with the description as the draft left it.
  await card.getByRole("button", { name: "Apply all 1" }).click();
  const applied = page.getByRole("region", { name: "Applied changes" });
  await expect(applied).toContainText("Applied 1 change");
  const created = await queryDatabase<{ id: string; description: string }>(`SELECT id, description FROM "Task" WHERE title = $1`, [title]);
  expect(created.rows).toEqual([{ id: expect.any(String), description }]);

  // The task's page shows every section.
  await applied.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${created.rows[0].id}$`));
  const main = page.locator("#main-content");
  await expect(main.getByText(summary)).toBeVisible();
  const sections = ["Summary", "Acceptance criteria 0 of 3", "Not in this ticket", "Open questions", "Estimate", "Original request", "Cost"];
  for (const section of sections) await expect(main.getByRole("heading", { level: 2, name: section, exact: true })).toBeVisible();
  // In that order, before the page's own sections such as Sub-tasks.
  const pageHeadings = await headings(main, 2).allTextContents();
  expect(pageHeadings.slice(0, sections.length)).toEqual(sections);
  await expect(fold(main, "Original request")).toHaveAttribute("aria-expanded", "false");
  await page.screenshot({ path: testInfo.outputPath(`ticket-task-page-${isMobile ? "phone" : "desktop"}.png`), fullPage: true });
});

test("work over 2 days: the subtasks that split it start unticked, and only the ones the person ticks are created (#434)", async ({ page, isMobile }, testInfo) => {
  test.setTimeout(60_000);
  await signedInWithTheNotice(page, "E2E ticket split");
  const title = uniqueName("E2E Add two-step sign-in");
  const split = ["Set up an authenticator app", "Ask for the code at sign-in", "Recovery codes"];
  const big = {
    title,
    summary: "Ask for a code from an authenticator app at sign-in.",
    acceptanceCriteria: ["A person can turn on two-step sign-in", "Sign-in asks for the code"],
    estimate: { size: "1 week", reason: "An app to set up, a code at sign-in, recovery codes, and tests for each." },
    split,
  };
  await page.goto("/ai");
  await ask(page, `Write a ticket for two-step sign-in. ${calls(["create_ticket", big])}`);
  await expect(page.getByRole("region", { name: "Conversation" })).toContainText(`Proposed: New task written as a ticket "${title}", and 3 subtasks that split it`);

  // The ticket is ticked; the subtasks it suggests aren't, under it.
  const card = page.getByRole("region", { name: "Changes to apply" });
  await expect(card.getByRole("checkbox", { name: `New task ${title}` })).toBeChecked();
  for (const subtask of split) await expect(card.getByRole("checkbox", { name: `Suggested subtask ${subtask} Personal · Under ${title}` })).not.toBeChecked();
  await expect(card).toContainText("1 of 4 selected");
  await page.screenshot({ path: testInfo.outputPath(`ticket-split-${isMobile ? "phone" : "desktop"}.png`) });

  // The draft says why.
  await card.getByRole("button", { name: `Open draft of ${title}` }).click();
  const draft = page.getByRole("dialog", { name: title });
  await expect(draft.locator("p", { hasText: "AI estimate" })).toHaveText("1 week · AI estimate An app to set up, a code at sign-in, recovery codes, and tests for each.");
  await expect(draft.getByText("More than 2 days of work: worth splitting into subtasks.")).toBeVisible();
  await draft.getByRole("button", { name: isMobile ? "Back to the chat" : "Back to the card" }).last().click();
  await expect(draft).toBeHidden();

  // Tick one, and only it is created, under the ticket's task.
  await card.getByRole("checkbox", { name: `Suggested subtask ${split[2]}` }).check();
  await card.getByRole("button", { name: "Apply 2 of 4" }).click();
  const applied = page.getByRole("region", { name: "Applied changes" });
  await expect(applied).toContainText("Applied 2 of 4 changes");
  await expect(applied).toContainText(`Left out: ${split[0]}, ${split[1]}`);
  const created = await queryDatabase<{ title: string; parent: string | null }>(
    // Both are created in one transaction, so the parent comes first by having none, not by time.
    `SELECT t.title, p.title AS parent FROM "Task" t LEFT JOIN "Task" p ON p.id = t."parentId" WHERE t.title = $1 OR p.title = $1 ORDER BY t."parentId" NULLS FIRST`,
    [title],
  );
  expect(created.rows).toEqual([
    { title, parent: null },
    { title: split[2], parent: title },
  ]);
});

test("a task's page: sections fold, edit with their titles, tick, go with the bin and come back with Undo", async ({ page, isMobile }, testInfo) => {
  await signUpAndLogIn(page, "E2E task sections");
  const title = uniqueName("E2E Move house");
  const response = await page.request.post("/api/tasks", {
    data: {
      title,
      description: "## Summary\n\nPlan the move.\n\n## Checklist\n\n- [ ] Book the van\n- [ ] Pack the kitchen\n\n## Cost\n\n- Down payment: $500\n- Monthly cost: $40",
    },
  });
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const stored = async () => (await queryDatabase<{ description: string }>(`SELECT description FROM "Task" WHERE id = $1`, [id])).rows[0].description;
  const taskPath = new RegExp(`^/api/tasks/${id}$`);

  // In the list, the summary, not the Markdown.
  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: title, exact: true })).toHaveAccessibleDescription("Plan the move.");

  await page.goto(`/tasks/${id}`);
  const main = page.locator("#main-content");
  await expect(fold(main, "Checklist")).toHaveText("Checklist 0 of 2");

  // The arrow folds a section and opens it again.
  await fold(main, "Summary").click();
  await expect(fold(main, "Summary")).toHaveAttribute("aria-expanded", "false");
  await expect(main.getByText("Plan the move.")).toHaveCount(0);
  await fold(main, "Summary").click();
  await expect(fold(main, "Summary")).toHaveAttribute("aria-expanded", "true");
  await expect(main.getByText("Plan the move.")).toBeVisible();

  // A checklist box ticks, and stays ticked.
  await saving(page, taskPath, () => main.getByRole("checkbox", { name: "Book the van" }).check());
  await expect(fold(main, "Checklist")).toHaveText("Checklist 1 of 2");
  await page.reload();
  await expect(main.getByRole("checkbox", { name: "Book the van" })).toBeChecked();
  await expect(main.getByRole("checkbox", { name: "Pack the kitchen" })).not.toBeChecked();

  // The pencil edits the section's title and text; Escape leaves it as it was.
  const editor = main.getByRole("group", { name: /^(Editing |New section)/ });
  await main.getByRole("button", { name: "Edit Summary" }).click();
  await editor.getByRole("textbox", { name: "Section text" }).fill("Something else");
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(main.getByText("Plan the move.")).toBeVisible();
  // The keyboard is back on the pencil, and the page stayed (Escape elsewhere goes back to the list).
  await expect(main.getByRole("button", { name: "Edit Summary" })).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/tasks/${id}$`));

  await main.getByRole("button", { name: "Edit Cost" }).click();
  await editor.getByRole("textbox", { name: "Section title" }).fill("Costs");
  await page.screenshot({ path: testInfo.outputPath(`task-section-editor-${isMobile ? "phone" : "desktop"}.png`) });
  await saving(page, taskPath, () => editor.getByRole("button", { name: "Save" }).click());
  await expect(fold(main, "Costs")).toBeVisible();

  // The bin removes it; Undo brings it back.
  await main.getByRole("button", { name: "Edit Costs" }).click();
  await saving(page, taskPath, () => editor.getByRole("button", { name: "Remove Costs" }).click());
  await expect(fold(main, "Costs")).toHaveCount(0);
  await saving(page, taskPath, () => page.getByRole("button", { name: "Undo" }).click());
  await expect(fold(main, "Costs")).toBeVisible();

  // A new section needs a title; then it's added at the end, formatted.
  await main.getByRole("button", { name: "Add a section" }).click();
  await editor.getByRole("textbox", { name: "Section text" }).fill("Call the landlord **first**.");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor.getByText("Give the section a title.")).toBeVisible();
  await expect(editor.getByRole("textbox", { name: "Section title" })).toHaveAttribute("aria-invalid", "true");
  await editor.getByRole("textbox", { name: "Section title" }).fill("Notes");
  await saving(page, taskPath, () => editor.getByRole("button", { name: "Save" }).click());
  await expect(main.locator("strong", { hasText: "first" })).toBeVisible();

  expect(await stored()).toBe(
    "## Summary\n\nPlan the move.\n\n## Checklist\n\n- [x] Book the van\n- [ ] Pack the kitchen\n\n## Costs\n\n- Down payment: $500\n- Monthly cost: $40\n\n## Notes\n\nCall the landlord **first**.",
  );
});

test("a plain description stays the text field it was, and can get sections too", async ({ page }) => {
  await signUpAndLogIn(page, "E2E plain description");
  const title = uniqueName("E2E Renew the passport");
  const response = await page.request.post("/api/tasks", { data: { title, description: "Bring the old one." } });
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const taskPath = new RegExp(`^/api/tasks/${id}$`);

  await page.goto(`/tasks/${id}`);
  const main = page.locator("#main-content");
  const field = main.getByRole("textbox", { name: "Description" });
  await expect(field).toHaveValue("Bring the old one.");
  await expect(main.getByTitle("Edit the section")).toHaveCount(0);
  await field.fill("Bring the old one and two photos.");
  await saving(page, taskPath, () => field.blur());

  await main.getByRole("button", { name: "Add a section" }).click();
  const editor = main.getByRole("group", { name: "New section" });
  await editor.getByRole("textbox", { name: "Section title" }).fill("Cost");
  await editor.getByRole("textbox", { name: "Section text" }).fill("Fee: to be decided");
  await saving(page, taskPath, () => editor.getByRole("button", { name: "Save" }).click());
  await expect(field).toHaveValue("Bring the old one and two photos.");
  await expect(fold(main, "Cost")).toBeVisible();
  const { rows } = await queryDatabase<{ description: string }>(`SELECT description FROM "Task" WHERE id = $1`, [id]);
  expect(rows[0].description).toBe("Bring the old one and two photos.\n\n## Cost\n\nFee: to be decided");
});
