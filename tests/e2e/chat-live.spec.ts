import { expect, test } from "@playwright/test";
import { signUpAndLogIn, uniqueName } from "./helpers";

test("a teammate's message appears in an open chat without reloading", async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);

  await signUpAndLogIn(page, "E2E chat owner");
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("E2E live chat") } })).json()) as {
    id: string;
  };

  const teammateContext = await browser.newContext({ baseURL });
  const teammate = await teammateContext.newPage();
  const { email: teammateEmail } = await signUpAndLogIn(teammate, "E2E chat teammate");
  expect(
    (await page.request.post(`/api/projects/${project.id}/invitations`, { data: { email: teammateEmail, role: "EDITOR" } })).status(),
  ).toBe(201);
  const invitations = (await (await teammate.request.get("/api/project-invitations")).json()) as {
    id: string;
    project: { id: string };
  }[];
  const invitation = invitations.find((item) => item.project.id === project.id)!;
  expect((await teammate.request.patch(`/api/project-invitations/${invitation.id}`, { data: { action: "ACCEPT" } })).ok()).toBe(true);

  await page.goto(`/projects/${project.id}/chat`);
  await expect(page.getByPlaceholder(/share an update/i)).toBeVisible();

  const message = uniqueName("Live update from a teammate");
  expect((await teammate.request.post(`/api/projects/${project.id}/comments`, { data: { message } })).status()).toBe(201);

  // The open chat checks every few seconds while visible; no reload.
  await expect(page.getByText(message)).toBeVisible({ timeout: 20_000 });

  // A caller who already has the latest version gets a short "no change" answer.
  const latest = (await (await page.request.get(`/api/projects/${project.id}/comments`)).json()) as { version: string };
  const again = (await (await page.request.get(`/api/projects/${project.id}/comments?version=${encodeURIComponent(latest.version)}`)).json()) as {
    changed: boolean;
    comments?: unknown[];
  };
  expect(again.changed).toBe(false);
  expect(again.comments).toBeUndefined();

  await teammateContext.close();
});
