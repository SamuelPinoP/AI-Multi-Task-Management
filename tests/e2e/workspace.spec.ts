import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";

const videoFixturePath = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "tiny-video.mp4",
);

function uniqueName(prefix: string) {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

async function continueAsGuest(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /continue as guest/i }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

// Guests can't upload chat attachments, so upload tests use a fresh account.
async function signUpAndLogIn(page: Page) {
  const id = randomUUID().slice(0, 8);
  const email = `e2e-${id}@example.test`;
  const password = `e2e-${randomUUID()}`;

  await page.goto("/signup");
  await page.getByLabel("Name").fill(`E2E user ${id}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/login\?error=created/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test("guest can create and search a note", async ({ page }) => {
  const noteTitle = uniqueName("E2E note");
  const noteBody = "Created by Playwright to prove the notes flow works.";

  await continueAsGuest(page);
  await page.getByRole("link", { name: "Notes" }).click();

  await expect(
    page.getByRole("heading", { name: "Create a Note" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "No notes yet." })).toBeVisible();
  await page.getByPlaceholder("Title (optional)").fill(noteTitle);
  await page.getByPlaceholder("Write your note here...").fill(noteBody);
  await page.getByRole("button", { name: "Create Note" }).click();

  await expect(page.getByRole("heading", { name: noteTitle })).toBeVisible();
  await page.getByPlaceholder(/search notes by title or content/i).fill(noteTitle);
  await expect(page.getByRole("heading", { name: noteTitle })).toBeVisible();
});

test("member can create a project and upload a local video attachment", async ({
  page,
}) => {
  const projectName = uniqueName("E2E upload project");
  const chatMessage = uniqueName("Local video upload proof");

  await signUpAndLogIn(page);
  await page.getByRole("link", { name: "Projects" }).click();

  await expect(
    page.getByRole("heading", { name: "Create a project" }),
  ).toBeVisible();
  await expect(
    page.getByText(/no pending project invitations/i),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No projects match this view yet." }),
  ).toBeVisible();

  await page.getByPlaceholder(/capstone demo/i).fill(projectName);
  await page
    .getByPlaceholder("What is this project trying to accomplish?")
    .fill("Exercise the browser project flow without touching cloud storage.");

  const createProjectResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/projects") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create project" }).click();
  const createProjectResponse = await createProjectResponsePromise;
  expect(createProjectResponse.ok()).toBe(true);
  const createdProject = (await createProjectResponse.json()) as {
    id: string;
    name: string;
  };
  expect(createdProject.name).toBe(projectName);

  await page.goto(`/projects/${createdProject.id}`);
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();

  const planResponse = await page.request.post(
    `/api/projects/${createdProject.id}/attachments/uploads`,
    {
      data: {
        files: [
          {
            clientId: "tiny-video-fixture",
            name: "tiny-video.mp4",
            size: 32,
            type: "video/mp4",
          },
        ],
      },
    },
  );
  expect(planResponse.ok()).toBe(true);
  await expect(planResponse.json()).resolves.toMatchObject({
    files: [
      {
        clientId: "tiny-video-fixture",
        provider: "local",
        strategy: "multipart",
      },
    ],
  });

  await page.getByRole("link", { name: /^Chat$/ }).click();
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles(videoFixturePath);
  await expect(page.getByText("tiny-video.mp4")).toBeVisible();
  await page.getByPlaceholder(/share an update/i).fill(chatMessage);

  const createCommentResponsePromise = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(`/api/projects/${createdProject.id}/comments`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /send message/i }).click();
  const createCommentResponse = await createCommentResponsePromise;
  expect(createCommentResponse.ok()).toBe(true);
  const createdComment = (await createCommentResponse.json()) as {
    attachments: { fileType: string; originalName: string }[];
  };
  expect(createdComment.attachments).toMatchObject([
    { fileType: "video/mp4", originalName: "tiny-video.mp4" },
  ]);

  const messageCard = page.locator("article").filter({ hasText: chatMessage });
  await expect(messageCard).toBeVisible();
  await expect(messageCard.getByText("Sending")).toBeHidden();
  await expect(
    messageCard.getByRole("link", { name: "tiny-video.mp4" }),
  ).toBeVisible();
  await expect(messageCard.getByText("VID", { exact: true })).toBeVisible();
});
