import { expect, test } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

type TaskResponse = { id: string; title: string; status: string; completedAt: string | null };

test("editing a finished task keeps its completion date (BUG-11)", async ({ page }) => {
  await continueAsGuest(page);
  const title = uniqueName("Finished task");
  const created = (await (await page.request.post("/api/tasks", { data: { title } })).json()) as TaskResponse;
  expect(created.completedAt).toBeNull();

  const patch = async (changes: Partial<{ title: string; status: string }>) => {
    const response = await page.request.patch(`/api/tasks/${created.id}`, {
      data: { title, status: "TODO", priority: "MEDIUM", recurrence: "NONE", ...changes },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()) as TaskResponse;
  };

  const done = await patch({ status: "DONE" });
  expect(done.completedAt).not.toBeNull();

  // Fixing a typo later must not move the completion date.
  await page.waitForTimeout(50);
  const edited = await patch({ status: "DONE", title: `${title} (fixed)` });
  expect(edited.title).toBe(`${title} (fixed)`);
  expect(edited.completedAt).toBe(done.completedAt);

  // Reopening clears it; finishing again stamps a new date.
  expect((await patch({ status: "TODO" })).completedAt).toBeNull();
  const again = await patch({ status: "DONE" });
  expect(again.completedAt).not.toBeNull();
  expect(new Date(again.completedAt!).getTime()).toBeGreaterThan(new Date(done.completedAt!).getTime());
});
