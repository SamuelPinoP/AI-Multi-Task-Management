import { deflateSync } from "node:zlib";
import { expect, test, type APIResponse, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { signUpAndLogIn, uniqueName } from "./helpers";

// Project photos (#403): an owner adds one when creating the project, changes and removes it from the
// chat header; a teammate sees it but can't change it; nobody outside the project can load it.
test.describe.configure({ mode: "serial" });

const contexts: BrowserContext[] = [];
let owner: Page;
let teammate: Page;
let outsider: Page;
let teammateEmail = "";
let projectId = "";
let projectName = "";

/** A solid-color PNG, made here so the test needs no image file. */
function png(width: number, height: number, [red, green, blue]: [number, number, number]) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  const row = Buffer.from([0, ...Array.from({ length: width }, () => [red, green, blue]).flat()]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function ok<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.url()} -> ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

/** Picks a file in the chooser that `open` brings up, as a person would. */
async function pickFile(page: Page, open: () => Promise<void>, name: string, buffer: Buffer) {
  const chooser = page.waitForEvent("filechooser");
  await open();
  await (await chooser).setFiles({ name, mimeType: "image/png", buffer });
}

/** Waits until an image has loaded and returns its natural width. */
async function loadedWidth(image: Locator) {
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  return image.evaluate((element: HTMLImageElement) => element.naturalWidth);
}

function conversation(page: Page) {
  return page.getByRole("region", { name: "Conversation" });
}

function chatRow(page: Page) {
  return page.getByRole("list", { name: "Project chats" }).getByRole("link", { name: new RegExp(`^${projectName}`) });
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(120_000);
  const pages: Page[] = [];
  for (const label of ["E2E photo owner", "E2E photo teammate", "E2E photo outsider"]) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    const { email } = await signUpAndLogIn(page, label);
    if (label === "E2E photo teammate") teammateEmail = email;
    pages.push(page);
  }
  [owner, teammate, outsider] = pages;
});

test.afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
});

test("a new project can start with a photo, and Chats shows it instead of the color", async () => {
  projectName = uniqueName("Photo project");
  await owner.goto("/");
  await owner.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "Create a project" }).click();
  const sheet = owner.getByRole("dialog", { name: "New project" });
  await expect(sheet.getByRole("group", { name: "Photo (optional)" })).toBeVisible();

  // A wide image: the browser keeps its centered square and shrinks it to 256 px before upload.
  await pickFile(owner, () => sheet.getByRole("button", { name: "Add photo" }).click(), "wide.png", png(400, 300, [200, 120, 60]));
  await expect(sheet.getByRole("button", { name: "Change" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Remove" })).toBeVisible();
  expect(await loadedWidth(sheet.locator("img"))).toBe(256);

  await sheet.getByLabel("Name").fill(projectName);
  await sheet.getByRole("button", { name: "Create project" }).click();
  await expect(owner.getByText("Project created")).toBeVisible();
  await expect(owner).toHaveURL(/\/projects\/[^/]+$/);
  projectId = new URL(owner.url()).pathname.split("/").pop()!;

  await owner.goto(`/chats?project=${projectId}`);
  const header = conversation(owner);
  await expect(header.getByRole("heading", { name: projectName })).toBeVisible();
  const photoButton = header.getByRole("button", { name: `Change ${projectName}'s photo` });
  const photo = photoButton.locator("img");
  await expect(photo).toHaveAttribute("src", new RegExp(`^/api/projects/${projectId}/photo\\?v=\\d+$`));
  expect(await loadedWidth(photo)).toBe(256);

  // The list row beside the chat (#416) shows the same photo.
  await expect(chatRow(owner).locator("img")).toHaveAttribute("src", (await photo.getAttribute("src"))!);

  // Each version is cached for good; its address changes with the next photo.
  const response = await owner.request.get((await photo.getAttribute("src"))!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\/(webp|jpeg)$/);
  expect(response.headers()["cache-control"]).toContain("immutable");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});

test("the owner changes and removes the photo from the chat header", async () => {
  await owner.goto(`/chats?project=${projectId}`);
  const photoButton = conversation(owner).getByRole("button", { name: `Change ${projectName}'s photo` });
  const before = await photoButton.locator("img").getAttribute("src");

  await photoButton.click();
  await pickFile(owner, () => owner.getByRole("menuitem", { name: "Upload a new photo" }).click(), "square.png", png(120, 120, [40, 90, 200]));
  await expect(owner.getByText("Photo updated")).toBeVisible();
  await expect(photoButton.locator("img")).not.toHaveAttribute("src", before!);
  // A 120 px image isn't enlarged.
  expect(await loadedWidth(photoButton.locator("img"))).toBe(120);

  await photoButton.click();
  await owner.getByRole("menuitem", { name: "Remove photo" }).click();
  await expect(owner.getByText("Photo removed")).toBeVisible();
  // Without a photo, the letter tile Chats used before shows again.
  await expect(photoButton.locator("img")).toHaveCount(0);
  await expect(photoButton).toContainText(projectName.charAt(0).toUpperCase());
  expect((await owner.request.get(`/api/projects/${projectId}/photo`)).status()).toBe(404);
});

test("teammates see the photo but can't change it, and nobody outside the project can load it", async () => {
  await ok(await owner.request.post(`/api/projects/${projectId}/invitations`, { data: { email: teammateEmail, role: "EDITOR" } }));
  const invitations = await ok<Array<{ id: string; project: { id: string } }>>(await teammate.request.get("/api/project-invitations"));
  const invitation = invitations.find((item) => item.project.id === projectId);
  expect(invitation, "the teammate sees the invitation").toBeTruthy();
  await ok(await teammate.request.patch(`/api/project-invitations/${invitation!.id}`, { data: { action: "ACCEPT" } }));

  const { photoUpdatedAt } = await ok<{ photoUpdatedAt: string }>(
    await owner.request.put(`/api/projects/${projectId}/photo`, { data: png(64, 64, [20, 160, 120]), headers: { "Content-Type": "image/png" } }),
  );

  await teammate.goto(`/chats?project=${projectId}`);
  const header = conversation(teammate);
  await expect(header.getByRole("heading", { name: projectName })).toBeVisible();
  await expect(header.locator("img").first()).toHaveAttribute("src", `/api/projects/${projectId}/photo?v=${new Date(photoUpdatedAt).getTime()}`);
  await expect(header.getByRole("button", { name: `Change ${projectName}'s photo` })).toHaveCount(0);

  // Only the owner may change it, like the name and color; the server checks.
  const put = await teammate.request.put(`/api/projects/${projectId}/photo`, { data: png(8, 8, [0, 0, 0]), headers: { "Content-Type": "image/png" } });
  expect(put.status()).toBe(403);
  expect((await teammate.request.delete(`/api/projects/${projectId}/photo`)).status()).toBe(403);

  // Outside the project it doesn't exist.
  expect((await outsider.request.get(`/api/projects/${projectId}/photo`)).status()).toBe(404);
  expect((await outsider.request.put(`/api/projects/${projectId}/photo`, { data: png(8, 8, [0, 0, 0]), headers: { "Content-Type": "image/png" } })).status()).toBe(404);
});

test("the server stores only real PNG, JPEG or WebP images of a sensible size", async () => {
  const svg = await owner.request.put(`/api/projects/${projectId}/photo`, {
    data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    headers: { "Content-Type": "image/png" },
  });
  expect(svg.status()).toBe(400);
  expect(((await svg.json()) as { error: string }).error).toBe("Use a PNG, JPEG or WebP image.");

  const huge = await owner.request.put(`/api/projects/${projectId}/photo`, { data: Buffer.alloc(300 * 1024, 1), headers: { "Content-Type": "image/png" } });
  expect(huge.status()).toBe(413);

  // The photo from before is untouched.
  expect((await owner.request.get(`/api/projects/${projectId}/photo`)).status()).toBe(200);
});

test("deleting the project deletes its photo", async () => {
  await ok(await owner.request.delete(`/api/projects/${projectId}`));
  expect((await owner.request.get(`/api/projects/${projectId}/photo`)).status()).toBe(404);
});
