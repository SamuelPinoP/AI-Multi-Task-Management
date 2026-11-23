import { expect, test, type Page } from "@playwright/test";
import { AI_NOTICE_VERSION } from "../../src/lib/ai/notice";
import { queryDatabase, signUpAndLogIn, uniqueName } from "./helpers";

// The card that shows the changes an AI answer proposes (#310), on computers and phones: a checkbox
// per change, Apply for the ticked ones, and Cancel. The server's fake model
// (src/lib/ai/providers/fake.ts) calls every tool a message names, with the JSON after each name.

const messageBox = (page: Page) => page.getByRole("textbox", { name: "Message the AI" });

/** Types a question and sends it with the button: on a touch screen Enter starts a new line (#303). */
async function ask(page: Page, question: string) {
  await messageBox(page).fill(question);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

/** A message the fake model reads as these tool calls, in order. */
const calls = (...named: Array<[string, Record<string, unknown>]>) => named.map(([name, args]) => `${name} ${JSON.stringify(args)}`).join(" ");

async function newTask(page: Page, title: string) {
  const response = await page.request.post("/api/tasks", { data: { title } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function taskStatus(id: string) {
  const { rows } = await queryDatabase<{ status: string }>(`SELECT status FROM "Task" WHERE id = $1`, [id]);
  return rows[0]?.status;
}

async function signedInWithTheNotice(page: Page, label: string) {
  await signUpAndLogIn(page, label);
  expect((await page.request.post("/api/agent/notice", { data: { version: AI_NOTICE_VERSION } })).status()).toBe(200);
}

test("the person ticks what to apply: leaving out a new project leaves out what goes in it, and only the rest changes", async ({ page, isMobile }, testInfo) => {
  await signedInWithTheNotice(page, "E2E proposal card");
  const project = uniqueName("E2E Whitewall");
  const task = uniqueName("E2E Harden sign-in");
  const finished = uniqueName("E2E Call the dentist");
  const finishedId = await newTask(page, finished);

  await page.goto("/ai");
  await ask(
    page,
    calls(
      ["create_project", { name: project }],
      ["create_task", { title: task, project, dueDate: "2026-12-17", priority: "HIGH", description: "Limit sign-in attempts." }],
      ["complete_task", { task: finished }],
    ),
  );
  const card = page.getByRole("region", { name: "Changes to apply" });
  await expect(card).toContainText("3 of 3 selected");
  // The conversation follows the answer down to the card, so Apply is on screen without scrolling (#536).
  await expect(card.getByRole("button", { name: "Apply all 3" })).toBeInViewport();
  const projectBox = card.getByRole("checkbox", { name: `New project ${project}` });
  const taskBox = card.getByRole("checkbox", { name: `New task ${task}` });
  const finishedBox = card.getByRole("checkbox", { name: `Mark as done ${finished}` });
  for (const box of [projectBox, taskBox, finishedBox]) await expect(box).toBeChecked();
  await expect(taskBox).toHaveAccessibleName(new RegExp(`${project} · Due Thu, Dec 17 · High`));
  await expect(finishedBox).toHaveAccessibleName(/Personal$/);

  // The task's description shows on request.
  const details = card.getByRole("button", { name: `Show details of ${task}` });
  await details.click();
  await expect(card.getByRole("button", { name: `Hide details of ${task}` })).toHaveAttribute("aria-expanded", "true");
  await expect(card.getByText("Limit sign-in attempts.")).toBeVisible();

  // Leaving out the project leaves out the task that goes in it, and says why; ticking it again brings the task back.
  await projectBox.uncheck();
  await expect(taskBox).not.toBeChecked();
  await expect(taskBox).toBeDisabled();
  await expect(card.getByText(`Needs the ${project} project`)).toBeVisible();
  await expect(card).toContainText("1 of 3 selected");
  await projectBox.check();
  await expect(taskBox).toBeChecked();
  await expect(card.getByRole("button", { name: "Apply all 3" })).toBeEnabled();

  // With nothing ticked, there's nothing to apply.
  await projectBox.uncheck();
  await finishedBox.uncheck();
  await expect(card.getByRole("button", { name: "Apply 0 of 3" })).toBeDisabled();
  await finishedBox.check();
  await page.screenshot({ path: testInfo.outputPath(`proposal-card-${isMobile ? "phone" : "desktop"}.png`) });

  await card.getByRole("button", { name: "Apply 1 of 3" }).click();
  const applied = page.getByRole("region", { name: "Applied changes" });
  await expect(applied).toBeFocused();
  await expect(applied).toContainText("Applied 1 of 3 changes");
  await expect(applied).toContainText(`Left out: ${project}, ${task}`);
  await expect(applied.getByRole("link", { name: finished })).toHaveAttribute("href", `/tasks?task=${finishedId}`);
  await page.screenshot({ path: testInfo.outputPath(`proposal-applied-${isMobile ? "phone" : "desktop"}.png`) });

  // Only the ticked change was made.
  expect(await taskStatus(finishedId)).toBe("DONE");
  expect((await queryDatabase(`SELECT id FROM "Project" WHERE name = $1`, [project])).rows).toEqual([]);
  expect((await queryDatabase(`SELECT id FROM "Task" WHERE title = $1`, [task])).rows).toEqual([]);

  // The stored chat shows the same once it's opened again.
  await page.reload();
  if (isMobile) await page.getByRole("button", { name: "Your chats" }).click();
  await page.getByRole("region", { name: "Chats", exact: true }).getByRole("listitem").first().getByRole("button").first().click();
  await expect(page.getByRole("region", { name: "Applied changes" })).toContainText("Applied 1 of 3 changes");
  await expect(page.getByRole("region", { name: "Changes to apply" })).toHaveCount(0);
});

test("Cancel changes nothing and says so; a phone's buttons share the row", async ({ page, isMobile }) => {
  await signedInWithTheNotice(page, "E2E proposal cancel");
  const title = uniqueName("E2E Draft: launch email");
  const id = await newTask(page, title);

  await page.goto("/ai");
  await ask(page, calls(["trash_task", { task: title }]));
  const card = page.getByRole("region", { name: "Changes to apply" });
  await expect(card.getByRole("checkbox", { name: `Move to the Trash ${title}` })).toBeChecked();
  const apply = card.getByRole("button", { name: "Apply all 1" });
  const cancel = card.getByRole("button", { name: "Cancel" });
  // Phones get full-width, 44-pixel buttons; computers, compact ones.
  const [applyBox, cancelBox] = [(await apply.boundingBox())!, (await cancel.boundingBox())!];
  expect(applyBox.height).toBeCloseTo(isMobile ? 44 : 36, 0);
  if (isMobile) expect(Math.abs(applyBox.width - cancelBox.width)).toBeLessThan(2);

  await cancel.click();
  await expect(page.getByRole("region", { name: "Conversation" }).getByText("Cancelled. Nothing was changed.")).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(await taskStatus(id)).toBe("TODO");
  const { rows } = await queryDatabase<{ deletedAt: Date | null }>(`SELECT "deletedAt" FROM "Task" WHERE id = $1`, [id]);
  expect(rows).toEqual([{ deletedAt: null }]);
});
