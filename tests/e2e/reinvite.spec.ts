import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { openSection, signUpAndLogIn, uniqueName } from "./helpers";

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.url()} -> ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

async function invite(owner: APIRequestContext, projectId: string, email: string) {
  await json(await owner.post(`/api/projects/${projectId}/invitations`, { data: { email, role: "EDITOR" } }));
}

test("a removed member can be invited and accept again (#128)", async ({ browser }) => {
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext();
  const inviteeContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const page = await inviteeContext.newPage();

  try {
    await signUpAndLogIn(ownerPage, "E2E owner");
    const invitee = await signUpAndLogIn(page, "E2E invitee");
    const owner = ownerContext.request;

    const projectName = uniqueName("Re-invite project");
    const project = await json<{ id: string }>(await owner.post("/api/projects", { data: { name: projectName } }));

    for (const round of ["first", "second"]) {
      await invite(owner, project.id, invitee.email);

      if (round === "first") await openSection(page, "Projects");
      else await page.reload();
      const invitations = page.getByRole("region", { name: "You're invited to a project" });
      await invitations.getByRole("button", { name: "Accept" }).click();
      await expect(page.getByText(`You joined ${projectName}`), `accept, ${round} time`).toBeVisible();
      await expect(invitations).toHaveCount(0);

      const details = await json<{ members: { id: string; user: { email: string } | null }[] }>(
        await owner.get(`/api/projects/${project.id}`),
      );
      const member = details.members.find((item) => item.user?.email === invitee.email);
      expect(member, `member after the ${round} accept`).toBeTruthy();
      await json(await owner.delete(`/api/projects/${project.id}/members/${member!.id}`));
    }

    // Declining twice used to fail the same way.
    for (const round of ["first", "second"]) {
      await invite(owner, project.id, invitee.email);
      const pending = await json<{ id: string; project: { id: string } }[]>(
        await inviteeContext.request.get("/api/project-invitations"),
      );
      const invitation = pending.find((item) => item.project.id === project.id);
      expect(invitation, `pending invitation, ${round} decline`).toBeTruthy();
      await json(
        await inviteeContext.request.patch(`/api/project-invitations/${invitation!.id}`, { data: { action: "DECLINE" } }),
      );
    }

    // Still only one pending invitation per email at a time.
    await invite(owner, project.id, invitee.email);
    const duplicate = await owner.post(`/api/projects/${project.id}/invitations`, {
      data: { email: invitee.email, role: "EDITOR" },
    });
    expect(duplicate.status()).toBe(409);
  } finally {
    await Promise.all([ownerContext.close(), inviteeContext.close()]);
  }
});
