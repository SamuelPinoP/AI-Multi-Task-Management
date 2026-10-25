import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { signUpAndLogIn, uniqueName } from "./helpers";

/** Half a minute away (say, on the phone), then the window gets focus again. */
async function comeBack(page: Page) {
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

function dateInputValue(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function ok<T = { id: string }>(request: Promise<APIResponse>) {
  const response = await request;
  expect(response.ok(), `${response.url()} -> ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

function createEvent(api: APIRequestContext, title: string) {
  return ok(api.post("/api/events", { data: { title, startDate: dateInputValue(0), startTime: "09:00", endDate: "", endTime: "", recurrence: "NONE" } }));
}

// Each page, and a change made through the API, as another device would.
const pages: { name: string; path: string; change: (api: APIRequestContext, title: string) => Promise<unknown> }[] = [
  { name: "Tasks", path: "/tasks", change: (api, title) => ok(api.post("/api/tasks", { data: { title } })) },
  { name: "Events", path: "/events", change: createEvent },
  { name: "Calendar", path: "/events/calendar", change: createEvent },
  {
    name: "Goals",
    path: "/goals",
    change: async (api, title) => {
      const { week } = await ok<{ week: { key: string } }>(api.get("/api/goals"));
      return ok(api.post("/api/goals", { data: { title, targetWeek: week.key } }));
    },
  },
  { name: "Roadmap", path: "/roadmap", change: (api, title) => ok(api.post("/api/tasks", { data: { title, dueDate: dateInputValue(1) } })) },
  {
    name: "Trash",
    path: "/trash",
    change: async (api, title) => {
      const note = await ok(api.post("/api/notes", { data: { title, content: "" } }));
      return ok(api.delete(`/api/notes/${note.id}`));
    },
  },
];

for (const { name, path, change } of pages) {
  test(`${name} shows a change made on another device when you come back`, async ({ page }) => {
    await signUpAndLogIn(page, `E2E ${name}`);
    await page.clock.install();
    await page.goto(path);
    await page.waitForLoadState("networkidle");

    const title = uniqueName(`${name} from elsewhere`);
    await change(page.request, title);
    await expect(page.getByText(title)).toHaveCount(0);
    await comeBack(page);
    // Some pages also keep a hidden copy, such as the calendar's day previews.
    await expect(page.getByText(title).filter({ visible: true }).first()).toBeVisible();
  });
}

test("Notes shows a note added elsewhere and keeps what's typed in the open note", async ({ page }) => {
  await signUpAndLogIn(page, "E2E Notes");
  const open = uniqueName("Open note");
  await ok(page.request.post("/api/notes", { data: { title: open, content: "Saved earlier" } }));
  await page.clock.install();
  await page.goto("/notes");
  await page.getByRole("button", { name: open }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Note", { exact: true }).fill("Typed just now");

  const other = uniqueName("Note from elsewhere");
  await ok(page.request.post("/api/notes", { data: { title: other, content: "" } }));
  await comeBack(page);
  await expect(editor.getByLabel("Note", { exact: true })).toHaveValue("Typed just now");
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: other })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ has: page.getByRole("button", { name: open }) })).toContainText("Typed just now");
});

test("coming back while offline waits for the connection", async ({ page }) => {
  await signUpAndLogIn(page, "E2E offline");
  await page.clock.install();
  await page.goto("/tasks");
  await page.waitForLoadState("networkidle");
  const title = uniqueName("Task added while offline");
  await ok(page.request.post("/api/tasks", { data: { title } }));

  const taskRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/tasks") taskRequests.push(request.url());
  });
  await page.context().setOffline(true);
  await comeBack(page);
  // A refresh would start at once; give it a moment to show up if it did.
  await page.waitForTimeout(500);
  expect(taskRequests).toEqual([]);

  await page.context().setOffline(false);
  await expect(page.getByText(title)).toBeVisible();
});
