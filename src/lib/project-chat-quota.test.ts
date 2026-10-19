import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProjectChatGuestUploadsAllowed,
  assertProjectChatS3Quota,
  cleanupExpiredProjectChatUploads,
  DEFAULT_PROJECT_CHAT_S3_QUOTA_BYTES,
  DEFAULT_PROJECT_CHAT_USER_QUOTA_BYTES,
  EXPIRED_UPLOAD_CLEANUP_GRACE_MS,
  lockProjectChatQuota,
  PROJECT_CHAT_GUEST_UPLOADS_MESSAGE,
  PROJECT_CHAT_STORAGE_FULL_MESSAGE,
  PROJECT_CHAT_USER_QUOTA_MESSAGE,
  ProjectChatQuotaConfigError,
  ProjectChatQuotaError,
  projectChatQuotaConfig,
  projectChatQuotaRejection,
  projectChatS3Usage,
} from "./project-chat-quota";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

const config = { totalBytes: 1000, userBytes: 300, guestUploadsEnabled: false };

type AggregateArgs = { where: Record<string, unknown> };

/** Fake Prisma client: each aggregate answers from `sums` keyed by model and whether it filters by user. */
function fakeUsageDb(sums: Record<string, number | null>) {
  const calls: { model: string; where: Record<string, unknown> }[] = [];
  const model = (name: string) => ({
    aggregate: async ({ where }: AggregateArgs) => {
      calls.push({ model: name, where });
      return { _sum: { fileSize: sums[`${name}${"userId" in where ? ":user" : ""}`] ?? null } };
    },
  });
  const db = {
    projectCommentAttachment: model("attachment"),
    projectChatAttachmentUpload: model("upload"),
  } as unknown as Parameters<typeof projectChatS3Usage>[0];
  return { db, calls };
}

test("defaults to an 8 GB workspace limit, 500 MB per user, and no guest uploads", () => {
  assert.deepEqual(projectChatQuotaConfig({}), {
    totalBytes: 8 * GIB,
    userBytes: 500 * MIB,
    guestUploadsEnabled: false,
  });
  assert.equal(DEFAULT_PROJECT_CHAT_S3_QUOTA_BYTES, 8_589_934_592);
  assert.equal(DEFAULT_PROJECT_CHAT_USER_QUOTA_BYTES, 524_288_000);
  // Empty values fall back to the defaults, like an unset variable.
  assert.deepEqual(projectChatQuotaConfig({ PROJECT_CHAT_S3_QUOTA_BYTES: " ", PROJECT_CHAT_USER_QUOTA_BYTES: "" }), {
    totalBytes: 8 * GIB,
    userBytes: 500 * MIB,
    guestUploadsEnabled: false,
  });
});

test("reads byte limits and the guest switch from the environment", () => {
  assert.deepEqual(
    projectChatQuotaConfig({
      PROJECT_CHAT_S3_QUOTA_BYTES: " 5368709120 ",
      PROJECT_CHAT_USER_QUOTA_BYTES: "104857600",
      PROJECT_CHAT_GUEST_UPLOADS_ENABLED: "true",
    }),
    { totalBytes: 5 * GIB, userBytes: 100 * MIB, guestUploadsEnabled: true },
  );
  assert.equal(projectChatQuotaConfig({ PROJECT_CHAT_GUEST_UPLOADS_ENABLED: " TRUE " }).guestUploadsEnabled, true);
  for (const value of ["false", "1", "yes", "on", ""]) {
    assert.equal(projectChatQuotaConfig({ PROJECT_CHAT_GUEST_UPLOADS_ENABLED: value }).guestUploadsEnabled, false, value);
  }
  // Zero is allowed and turns every upload off.
  assert.equal(projectChatQuotaConfig({ PROJECT_CHAT_S3_QUOTA_BYTES: "0" }).totalBytes, 0);
});

test("refuses byte limits that are not whole numbers", () => {
  for (const value of ["8GB", "-1", "1.5", "1e9", "0x10", "9007199254740993"]) {
    assert.throws(() => projectChatQuotaConfig({ PROJECT_CHAT_S3_QUOTA_BYTES: value }), ProjectChatQuotaConfigError, value);
    assert.throws(() => projectChatQuotaConfig({ PROJECT_CHAT_USER_QUOTA_BYTES: value }), ProjectChatQuotaConfigError, value);
  }
});

test("allows uploads up to the workspace limit and refuses one byte more", () => {
  const usage = { totalBytes: 900, userBytes: 0 };
  assert.equal(projectChatQuotaRejection({ config, usage, incomingBytes: 99 }), null);
  assert.equal(projectChatQuotaRejection({ config, usage, incomingBytes: 100 }), null);
  assert.equal(projectChatQuotaRejection({ config, usage, incomingBytes: 101 }), PROJECT_CHAT_STORAGE_FULL_MESSAGE);
});

test("allows uploads up to the per-user limit and refuses one byte more", () => {
  const usage = { totalBytes: 500, userBytes: 250 };
  assert.equal(projectChatQuotaRejection({ config, usage, incomingBytes: 50 }), null);
  assert.equal(projectChatQuotaRejection({ config, usage, incomingBytes: 51 }), PROJECT_CHAT_USER_QUOTA_MESSAGE);
});

test("reports a full workspace before a full user allowance", () => {
  const usage = { totalBytes: 1000, userBytes: 300 };
  assert.equal(projectChatQuotaRejection({ config, usage, incomingBytes: 1 }), PROJECT_CHAT_STORAGE_FULL_MESSAGE);
});

test("lets requests that add nothing to S3 through, even when storage is full", () => {
  const usage = { totalBytes: 5000, userBytes: 5000 };
  assert.equal(projectChatQuotaRejection({ config, usage, incomingBytes: 0 }), null);
});

test("a zero workspace limit refuses every S3 upload", () => {
  const off = { ...config, totalBytes: 0 };
  assert.equal(projectChatQuotaRejection({ config: off, usage: { totalBytes: 0, userBytes: 0 }, incomingBytes: 1 }), PROJECT_CHAT_STORAGE_FULL_MESSAGE);
});

test("blocks guest uploads unless the switch is on", () => {
  assert.throws(
    () => assertProjectChatGuestUploadsAllowed({ isGuest: true }, config),
    (error) => error instanceof ProjectChatQuotaError && error.status === 413 && error.message === PROJECT_CHAT_GUEST_UPLOADS_MESSAGE,
  );
  assert.doesNotThrow(() => assertProjectChatGuestUploadsAllowed({ isGuest: true }, { ...config, guestUploadsEnabled: true }));
  assert.doesNotThrow(() => assertProjectChatGuestUploadsAllowed({ isGuest: false }, config));
});

test("sums saved attachments and pending uploads stored in S3", async () => {
  const { db, calls } = fakeUsageDb({
    attachment: 4000,
    "attachment:user": 1000,
    upload: 600,
    "upload:user": 200,
  });

  assert.deepEqual(await projectChatS3Usage(db, "user-1"), { totalBytes: 4600, userBytes: 1200 });
  assert.deepEqual(calls, [
    { model: "attachment", where: { storageProvider: "AWS_S3" } },
    { model: "attachment", where: { storageProvider: "AWS_S3", userId: "user-1" } },
    // Pending uploads count whether or not they have expired: the object may
    // already be in the bucket until cleanup deletes it.
    { model: "upload", where: { storageProvider: "AWS_S3" } },
    { model: "upload", where: { storageProvider: "AWS_S3", userId: "user-1" } },
  ]);
});

test("treats an empty bucket as zero bytes", async () => {
  const { db } = fakeUsageDb({});
  assert.deepEqual(await projectChatS3Usage(db, "user-1"), { totalBytes: 0, userBytes: 0 });
});

test("handles sums past the 32-bit integer range", async () => {
  const { db } = fakeUsageDb({ attachment: 7 * GIB, upload: GIB });
  const usage = await projectChatS3Usage(db, "user-1");
  assert.equal(usage.totalBytes, 8 * GIB);
  assert.equal(
    projectChatQuotaRejection({ config: projectChatQuotaConfig({}), usage, incomingBytes: 1 }),
    PROJECT_CHAT_STORAGE_FULL_MESSAGE,
  );
});

test("assertProjectChatS3Quota throws a 413 error when the upload doesn't fit", async () => {
  const { db } = fakeUsageDb({ attachment: 950, "attachment:user": 10 });
  await assert.rejects(
    assertProjectChatS3Quota(db, { userId: "user-1", incomingBytes: 100, config }),
    (error) => error instanceof ProjectChatQuotaError && error.status === 413 && error.message === PROJECT_CHAT_STORAGE_FULL_MESSAGE,
  );
  await assert.doesNotReject(assertProjectChatS3Quota(db, { userId: "user-1", incomingBytes: 50, config }));
});

test("assertProjectChatS3Quota skips the database when nothing goes to S3", async () => {
  const { db, calls } = fakeUsageDb({ attachment: 5000 });
  await assertProjectChatS3Quota(db, { userId: "user-1", incomingBytes: 0, config });
  assert.equal(calls.length, 0);
});

test("lockProjectChatQuota takes a transaction-scoped advisory lock", async () => {
  let sql = "";
  let values: unknown[] = [];
  const tx = {
    $executeRaw: async (strings: TemplateStringsArray, ...args: unknown[]) => {
      sql = strings.join("?");
      values = args;
      return 1;
    },
  } as unknown as Parameters<typeof lockProjectChatQuota>[0];

  await lockProjectChatQuota(tx);
  assert.equal(sql, "SELECT pg_advisory_xact_lock(?::bigint)");
  assert.equal(values.length, 1);
  assert.equal(typeof values[0], "number");
});

type FakeUpload = { id: string; storageProvider: "AWS_S3"; storageKey: string; fileType: string; url: string; expiresAt: Date };

function fakeCleanupDb(uploads: FakeUpload[]) {
  const state = { findArgs: undefined as unknown, deletedIds: [] as string[], deleteManyCalls: 0 };
  const db = {
    projectChatAttachmentUpload: {
      findMany: async (args: { where: { expiresAt: { lt: Date } }; take: number }) => {
        state.findArgs = args;
        return uploads
          .filter((upload) => upload.expiresAt < args.where.expiresAt.lt)
          .slice(0, args.take)
          .map(({ id, storageProvider, storageKey, fileType, url }) => ({ id, storageProvider, storageKey, fileType, url }));
      },
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        state.deleteManyCalls += 1;
        state.deletedIds.push(...where.id.in);
        return { count: where.id.in.length };
      },
    },
  } as unknown as Parameters<typeof cleanupExpiredProjectChatUploads>[0]["db"];
  return { db, state };
}

function upload(id: string, expiresAt: Date): FakeUpload {
  return { id, storageProvider: "AWS_S3", storageKey: `project-chat/${id}.mp4`, fileType: "video/mp4", url: `s3://project-chat/${id}.mp4`, expiresAt };
}

test("cleanup deletes objects and rows of uploads expired past the grace period", async () => {
  const now = new Date("2026-10-19T12:00:00.000Z");
  const longExpired = upload("old", new Date(now.getTime() - EXPIRED_UPLOAD_CLEANUP_GRACE_MS - 1));
  const recentlyExpired = upload("recent", new Date(now.getTime() - 60_000));
  const active = upload("active", new Date(now.getTime() + 60_000));
  const { db, state } = fakeCleanupDb([longExpired, recentlyExpired, active]);
  const deletedKeys: string[] = [];

  const removed = await cleanupExpiredProjectChatUploads({
    db,
    now,
    deleteStoredObjects: async (attachments) => {
      deletedKeys.push(...attachments.map((attachment) => attachment.storageKey));
    },
  });

  assert.equal(removed, 1);
  assert.deepEqual(deletedKeys, ["project-chat/old.mp4"]);
  assert.deepEqual(state.deletedIds, ["old"]);
  assert.equal(
    (state.findArgs as { where: { expiresAt: { lt: Date } } }).where.expiresAt.lt.toISOString(),
    new Date(now.getTime() - EXPIRED_UPLOAD_CLEANUP_GRACE_MS).toISOString(),
  );
});

test("cleanup keeps rows whose objects could not be deleted", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const now = new Date("2026-10-19T12:00:00.000Z");
  const expiredAt = new Date(now.getTime() - 2 * EXPIRED_UPLOAD_CLEANUP_GRACE_MS);
  const { db, state } = fakeCleanupDb([upload("gone", expiredAt), upload("stuck", expiredAt)]);

  const removed = await cleanupExpiredProjectChatUploads({
    db,
    now,
    deleteStoredObjects: async ([attachment]) => {
      if (attachment.storageKey.includes("stuck")) throw new Error("R2 unavailable");
    },
  });

  assert.equal(removed, 1);
  assert.deepEqual(state.deletedIds, ["gone"]);
});

test("cleanup does nothing when no upload has expired", async () => {
  const now = new Date("2026-10-19T12:00:00.000Z");
  const { db, state } = fakeCleanupDb([upload("active", new Date(now.getTime() + 60_000))]);
  const removed = await cleanupExpiredProjectChatUploads({
    db,
    now,
    deleteStoredObjects: async () => assert.fail("nothing should be deleted"),
  });
  assert.equal(removed, 0);
  assert.equal(state.deleteManyCalls, 0);
});
