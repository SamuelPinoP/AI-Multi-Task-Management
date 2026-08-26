import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
  confirmProjectChatDirectUploadedAttachment,
  configuredUploadProviders,
  createProjectChatAttachmentUploadPlan,
  deleteProjectChatAttachments,
  projectChatStorageTestHooks,
  readProjectChatAttachment,
  saveProjectChatAttachments,
  selectUploadProvider,
  uploadAndPersistProjectChatAttachments,
} from "./project-chat-storage";

const originalEnv = { ...process.env };
const originalHooks = { ...projectChatStorageTestHooks };
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env = { ...originalEnv };
  Object.assign(projectChatStorageTestHooks, originalHooks);
  globalThis.fetch = originalFetch;
});

function configureHybrid() {
  process.env.PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER = "vercel-blob";
  process.env.PROJECT_CHAT_VIDEO_STORAGE_PROVIDER = "aws-s3";
  process.env.BLOB_READ_WRITE_TOKEN = "mock-token";
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_S3_BUCKET_NAME = "private-test-bucket";
  process.env.PROJECT_CHAT_BLOB_PREFIX = "project-chat";
  process.env.PROJECT_CHAT_S3_PREFIX = "project-chat";
  delete process.env.PROJECT_CHAT_STORAGE_PROVIDER;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
}

function mockS3(send: (command: unknown) => Promise<unknown>) {
  projectChatStorageTestHooks.createS3Client = () => ({ send } as unknown as S3Client);
}

function mockBlob() {
  projectChatStorageTestHooks.blobPut = async (key) => ({ pathname: key, url: `https://blob.example/${key}`, downloadUrl: `https://blob.example/${key}?download=1`, contentType: "text/plain", contentDisposition: "inline", etag: "mock-etag" });
  projectChatStorageTestHooks.blobHead = async (key) => ({ pathname: key, url: `https://blob.example/${key}`, downloadUrl: `https://blob.example/${key}?download=1`, size: 1, uploadedAt: new Date(), contentType: "text/plain", contentDisposition: "inline", cacheControl: "public", etag: "mock-etag" });
  projectChatStorageTestHooks.blobDelete = async () => undefined;
}

test("configuration precedence supports hybrid, local, and legacy routing", () => {
  assert.deepEqual(configuredUploadProviders({ PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER: "vercel-blob", PROJECT_CHAT_VIDEO_STORAGE_PROVIDER: "aws-s3" }), { defaultProvider: "vercel-blob", videoProvider: "aws-s3" });
  assert.deepEqual(configuredUploadProviders({ PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER: "local", PROJECT_CHAT_VIDEO_STORAGE_PROVIDER: "local" }), { defaultProvider: "local", videoProvider: "local" });
  assert.deepEqual(configuredUploadProviders({ PROJECT_CHAT_STORAGE_PROVIDER: "vercel-blob" }), { defaultProvider: "vercel-blob", videoProvider: "vercel-blob" });
  assert.deepEqual(configuredUploadProviders({ PROJECT_CHAT_STORAGE_PROVIDER: "vercel-blob", PROJECT_CHAT_VIDEO_STORAGE_PROVIDER: "aws-s3" }), { defaultProvider: "vercel-blob", videoProvider: "aws-s3" });
});

test("selectUploadProvider routes validated video MIME to video storage", () => {
  assert.equal(selectUploadProvider({ mimeType: "video/mp4", defaultProvider: "vercel-blob", videoProvider: "aws-s3" }), "aws-s3");
  assert.equal(selectUploadProvider({ mimeType: "image/png", defaultProvider: "vercel-blob", videoProvider: "aws-s3" }), "vercel-blob");
});

test("hybrid upload stores AWS provider identity and command inputs for video", async () => {
  configureHybrid();
  let sent: unknown;
  mockS3(async (command) => { sent = command; return {}; });
  const [stored] = await saveProjectChatAttachments([new File(["video"], "clip.mp4", { type: "text/plain" })]);
  assert.ok(sent instanceof PutObjectCommand);
  const putCommand = sent as PutObjectCommand;
  assert.equal(putCommand.input.Bucket, "private-test-bucket");
  assert.match(String(putCommand.input.Key), /^project-chat\/[0-9a-f-]+-clip\.mp4$/);
  assert.equal(putCommand.input.ContentType, "video/mp4");
  assert.equal(Buffer.from(putCommand.input.Body as Uint8Array).toString(), "video");
  assert.equal("ACL" in putCommand.input, false);
  assert.equal(stored.storageProvider, "AWS_S3");
  assert.equal(stored.storageKey, putCommand.input.Key);
});

test("prepares browser-direct S3 upload plans for S3-routed videos", async () => {
  configureHybrid();
  let command: unknown;
  projectChatStorageTestHooks.presign = async (_client, value) => {
    command = value;
    return "https://signed.example/upload";
  };

  const plan = await createProjectChatAttachmentUploadPlan(new File(["video"], "clip.mp4", { type: "text/plain" }));
  assert.equal(plan.strategy, "direct-s3");
  if (plan.strategy !== "direct-s3") throw new Error("expected direct S3 plan");
  assert.ok(command instanceof PutObjectCommand);
  const putCommand = command as PutObjectCommand;
  assert.equal(putCommand.input.Bucket, "private-test-bucket");
  assert.match(String(putCommand.input.Key), /^project-chat\/[0-9a-f-]+-clip\.mp4$/);
  assert.equal(putCommand.input.ContentType, "video/mp4");
  assert.equal(plan.uploadUrl, "https://signed.example/upload");
  assert.deepEqual(plan.uploadHeaders, { "Content-Type": "video/mp4" });
  assert.equal(plan.storedAttachment.storageProvider, "AWS_S3");
});

test("hybrid upload stores Vercel provider identity for ordinary files", async () => {
  configureHybrid();
  mockBlob();
  const [stored] = await saveProjectChatAttachments([new File(["text"], "notes.txt", { type: "video/mp4" })]);
  assert.equal(stored.storageProvider, "VERCEL_BLOB");
  assert.match(stored.storageKey, /^project-chat\/[0-9a-f-]+\.txt$/);
  assert.equal(stored.fileType, "text/plain");
});

test("local/local stores all types locally and local/S3 routes only videos to S3", async () => {
  process.env.PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER = "local";
  process.env.PROJECT_CHAT_VIDEO_STORAGE_PROVIDER = "local";
  const stored = await saveProjectChatAttachments([new File(["x"], "note.txt"), new File(["v"], "clip.mp4")]);
  assert.deepEqual(stored.map((item) => item.storageProvider), ["LOCAL", "LOCAL"]);
  await deleteProjectChatAttachments(stored);

  configureHybrid();
  process.env.PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER = "local";
  let commands = 0;
  mockS3(async () => { commands += 1; return {}; });
  const mixed = await saveProjectChatAttachments([new File(["x"], "note.txt"), new File(["v"], "clip.mp4")]);
  assert.deepEqual(mixed.map((item) => item.storageProvider), ["LOCAL", "AWS_S3"]);
  assert.equal(commands, 1);
  await deleteProjectChatAttachments([mixed[0]]);
});

test("confirms direct S3 uploads before attachment metadata is persisted", async (t) => {
  configureHybrid();
  let command: unknown;
  mockS3(async (value) => {
    command = value;
    return { ContentLength: 5, ContentType: "video/mp4" };
  });

  const attachment = {
    fileName: "project-chat/video.mp4",
    originalName: "video.mp4",
    fileType: "video/mp4",
    fileSize: 5,
    url: "s3://project-chat/video.mp4",
    storageProvider: "AWS_S3" as const,
    storageKey: "project-chat/video.mp4",
  };
  await confirmProjectChatDirectUploadedAttachment(attachment);
  assert.ok(command instanceof HeadObjectCommand);

  t.mock.method(console, "error", () => undefined);
  mockS3(async () => ({ ContentLength: 4, ContentType: "video/mp4" }));
  await assert.rejects(() => confirmProjectChatDirectUploadedAttachment(attachment), /uploaded attachment could not be verified/i);
});

test("downloads and deletes use each recorded provider, not upload defaults", async () => {
  configureHybrid();
  let command: unknown;
  mockS3(async (value) => { command = value; return {}; });
  projectChatStorageTestHooks.presign = async (_client: Parameters<typeof originalHooks.presign>[0], value: Parameters<typeof originalHooks.presign>[1]) => {
    command = value;
    return "https://signed.example/object";
  };
  const aws = { storageProvider: "AWS_S3" as const, storageKey: "project-chat/video.mp4", fileType: "video/mp4", url: "s3://project-chat/video.mp4" };
  assert.deepEqual(await readProjectChatAttachment(aws, { disposition: "attachment", fileName: "video.mp4" }), { kind: "redirect", url: "https://signed.example/object" });
  assert.ok(command instanceof GetObjectCommand);
  const getCommand = command as GetObjectCommand;
  assert.equal(getCommand.input.ResponseContentDisposition, `attachment; filename="video.mp4"; filename*=UTF-8''video.mp4`);
  assert.equal(getCommand.input.ResponseContentType, "video/mp4");
  await deleteProjectChatAttachments([aws]);
  assert.ok(command instanceof DeleteObjectCommand);

  mockBlob();
  globalThis.fetch = async () => new Response("blob", { headers: { "content-type": "text/plain" } });
  const blob = { storageProvider: "VERCEL_BLOB" as const, storageKey: "project-chat/note.txt", fileType: "text/plain", url: "https://stale.example/ignored" };
  const result = await readProjectChatAttachment(blob);
  assert.equal(result.kind, "body");
  await deleteProjectChatAttachments([blob]);
});

test("rejects invalid stored providers and provider/key combinations", async () => {
  configureHybrid();
  await assert.rejects(() => readProjectChatAttachment({ storageProvider: "INVALID" as never, storageKey: "project-chat/a.txt", fileType: "text/plain", url: "" }), /Invalid stored attachment provider/);
  await assert.rejects(() => deleteProjectChatAttachments([{ storageProvider: "AWS_S3", storageKey: "other/a.txt", fileType: "text/plain", url: "" }]), /Invalid aws-s3 attachment key/);
  await assert.rejects(() => deleteProjectChatAttachments([{ storageProvider: "LOCAL", storageKey: "../a.txt", fileType: "text/plain", url: "" }]), /Invalid local attachment key/);
});

test("cloud configuration is required only for selected upload providers", async () => {
  process.env.PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER = "local";
  process.env.PROJECT_CHAT_VIDEO_STORAGE_PROVIDER = "local";
  delete process.env.AWS_REGION;
  delete process.env.AWS_S3_BUCKET_NAME;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const [local] = await saveProjectChatAttachments([new File(["x"], "note.txt")]);
  await deleteProjectChatAttachments([local]);

  process.env.PROJECT_CHAT_VIDEO_STORAGE_PROVIDER = "aws-s3";
  await assert.rejects(() => saveProjectChatAttachments([new File(["v"], "clip.mp4")]), /AWS_REGION/);
  process.env.PROJECT_CHAT_VIDEO_STORAGE_PROVIDER = "local";
  process.env.PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER = "vercel-blob";
  await assert.rejects(() => saveProjectChatAttachments([new File(["x"], "note.txt")]), /BLOB_READ_WRITE_TOKEN/);
});

test("persistence failure triggers provider-aware compensating cleanup", async () => {
  configureHybrid();
  let deleted = false;
  mockBlob();
  projectChatStorageTestHooks.blobDelete = async () => { deleted = true; };
  const databaseError = new Error("database failed");
  await assert.rejects(() => uploadAndPersistProjectChatAttachments([new File(["x"], "note.txt")], async () => { throw databaseError; }), (error) => error === databaseError);
  assert.equal(deleted, true);
});

test("cleanup failure is safely logged without hiding persistence failure", async (t) => {
  configureHybrid();
  mockBlob();
  projectChatStorageTestHooks.blobDelete = async () => { throw new Error("private cloud detail"); };
  const databaseError = new Error("database failed");
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { logged.push(args); });
  await assert.rejects(() => uploadAndPersistProjectChatAttachments([new File(["x"], "note.txt")], async () => { throw databaseError; }), (error) => error === databaseError);
  const compensationLog = logged.find((entry) => entry[0] === "project_chat_storage_compensating_delete_failed");
  assert.ok(compensationLog);
  assert.deepEqual(compensationLog[1], { operation: "uploadRollback", errorName: "Error" });
});
