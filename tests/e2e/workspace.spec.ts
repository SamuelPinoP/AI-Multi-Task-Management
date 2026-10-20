import { expect, test } from "@playwright/test";
import path from "node:path";
import { continueAsGuest, openSection, signUpAndLogIn, uniqueName } from "./helpers";

const videoFixturePath = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "tiny-video.mp4",
);

test("guest can create and search a note", async ({ page }) => {
  const noteTitle = uniqueName("E2E note");
  const noteBody = "Created by Playwright to prove the notes flow works.";

  await continueAsGuest(page);
  await openSection(page, "Notes");

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

  // Guests can't upload chat attachments, so this test uses a fresh account.
  await signUpAndLogIn(page);
  await openSection(page, "Projects");

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
    messageCard.getByRole("button", { name: "Play tiny-video.mp4" }),
  ).toBeVisible();
});

test("chat shows several attachments and opens them in the viewer", async ({
  page,
}) => {
  const fixture = (name: string) =>
    path.join(process.cwd(), "tests", "fixtures", name);
  const chatMessage = uniqueName("Gallery proof");

  await signUpAndLogIn(page);
  const createProjectResponse = await page.request.post("/api/projects", {
    data: { name: uniqueName("E2E gallery project") },
  });
  expect(createProjectResponse.ok()).toBe(true);
  const project = (await createProjectResponse.json()) as { id: string };

  await page.goto(`/projects/${project.id}/chat`);
  await page.waitForLoadState("networkidle");

  await page
    .locator('input[type="file"]')
    .setInputFiles([
      fixture("sample-photo.png"),
      fixture("sample-clip.webm"),
      fixture("sample-brief.pdf"),
      fixture("sample-notes.docx"),
      fixture("sample-tasks.csv"),
    ]);
  const tray = page.getByRole("list", { name: "Files to send" });
  await expect(tray.getByRole("listitem")).toHaveCount(5);
  await page.getByPlaceholder(/share an update/i).fill(chatMessage);

  const createCommentResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/projects/${project.id}/comments`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /send message/i }).click();
  const createCommentResponse = await createCommentResponsePromise;
  expect(createCommentResponse.ok()).toBe(true);
  const created = (await createCommentResponse.json()) as {
    attachments: { id: string; originalName: string; fileSize: number }[];
  };
  expect(created.attachments).toHaveLength(5);

  const messageCard = page.locator("article").filter({ hasText: chatMessage });
  await expect(messageCard.getByText("Sending")).toBeHidden();
  await expect(
    messageCard.getByRole("button", { name: "Open sample-photo.png" }),
  ).toBeVisible();
  await expect(
    messageCard.getByRole("button", { name: "Open sample-notes.docx" }),
  ).toBeVisible();
  await expect(
    messageCard.getByRole("button", { name: "Open sample-tasks.csv" }),
  ).toBeVisible();
  // The page count comes from pdf.js reading the stored PDF, which starts when
  // the card nears the visible part of the chat.
  // The first run compiles pdf.js, which can take a while in dev mode.
  await messageCard
    .getByRole("button", { name: "Open sample-brief.pdf" })
    .scrollIntoViewIfNeeded();
  await expect(messageCard.getByText(/PDF document .* 2 pages/)).toBeVisible({
    timeout: 30_000,
  });

  // Play opens the video in the in-chat viewer and starts it.
  await messageCard
    .getByRole("button", { name: "Play sample-clip.webm" })
    .click();
  const viewer = page.getByRole("dialog");
  await expect(viewer).toHaveAccessibleName("sample-clip.webm, 2 of 5");
  const video = viewer.locator("video[controls]");
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0.2);
  expect(
    await video.evaluate((element: HTMLVideoElement) => element.videoWidth),
  ).toBe(960);

  // Arrow keys step through the rest of the message.
  await page.keyboard.press("ArrowRight");
  await expect(viewer).toHaveAccessibleName("sample-brief.pdf, 3 of 5");
  const firstPage = viewer.getByLabel("Page 1");
  await expect(firstPage).toBeVisible();
  await expect
    .poll(() => firstPage.evaluate((canvas: HTMLCanvasElement) => canvas.width))
    .toBeGreaterThan(500);

  await page.keyboard.press("ArrowRight");
  await expect(viewer).toHaveAccessibleName("sample-notes.docx, 4 of 5");
  await expect(viewer.getByTitle("Preview of sample-notes.docx")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();

  // Local storage answers range requests, so videos can seek.
  const clip = created.attachments.find(
    (attachment) => attachment.originalName === "sample-clip.webm",
  )!;
  const rangeResponse = await page.request.get(
    `/api/projects/${project.id}/attachments/${clip.id}/download`,
    { headers: { Range: "bytes=0-99" } },
  );
  expect(rangeResponse.status()).toBe(206);
  expect(rangeResponse.headers()["content-range"]).toBe(
    `bytes 0-99/${clip.fileSize}`,
  );
  expect((await rangeResponse.body()).length).toBe(100);
});
