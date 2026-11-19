import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { headers } from "next/headers";
import { after } from "next/server";
import { calendarFeedFor } from "@/lib/calendar-feed";
import {
  CALENDAR_FEED_PREFIX,
  calendarFeedResponse,
  createRebuildQueue,
  feedOwnersWhere,
  rebuildCalendarFeed,
  removeStaleCalendarFeeds,
  retireCalendarFeed,
  type CalendarFeedStore,
  type FeedScope,
} from "@/lib/calendar-feed-store-core";
import { prisma } from "@/lib/prisma";
import { projectChatS3Target } from "@/lib/project-chat-storage";

// Wires the stored calendar feeds (CU-01, #497) to R2 and Prisma; the logic
// and its reasons are in calendar-feed-store-core.ts.

function r2Store(bucket: string, client: S3Client): CalendarFeedStore {
  return {
    async get(key) {
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return (await object.Body?.transformToString("utf-8")) ?? "";
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if ((error instanceof Error && error.name === "NoSuchKey") || status === 404) return null;
        throw error;
      }
    },
    async put(key, body) {
      const contentType = key.endsWith(".ics") ? "text/calendar; charset=utf-8" : "text/plain; charset=utf-8";
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async list() {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: CALENDAR_FEED_PREFIX, ContinuationToken: continuationToken }),
        );
        for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);
      return keys;
    },
  };
}

/** Keys are "calendar-feeds/<name>"; each is a file named <name> in `dir`. */
function folderStore(dir: string): CalendarFeedStore {
  const fileFor = (key: string) => path.join(dir, path.basename(key));
  return {
    async get(key) {
      try {
        return await readFile(fileFor(key), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async put(key, body) {
      await mkdir(dir, { recursive: true });
      // Write, then rename, so a fetch never reads half a file.
      const partial = `${fileFor(key)}.${randomUUID()}.partial`;
      await writeFile(partial, body);
      await rename(partial, fileFor(key));
    },
    async remove(key) {
      await rm(fileFor(key), { force: true });
    },
    async list() {
      const names = await readdir(dir).catch(() => [] as string[]);
      return names.filter((name) => !name.endsWith(".partial")).map((name) => `${CALENDAR_FEED_PREFIX}${name}`);
    },
  };
}

let cachedStore: CalendarFeedStore | null | undefined;

/**
 * Where feeds are stored, following the database they're built from:
 * - R2, when the bucket is configured (production);
 * - nowhere on a Vercel preview with its own database (PREVIEW_DATABASE_URL),
 *   so it never writes into production's bucket; a preview that shares
 *   production's database keeps production's stored feeds current instead;
 * - nowhere on Vercel without a bucket, where instances don't share a disk;
 * - nowhere in `next dev`, where code changes would leave stale feeds behind;
 * - otherwise a temporary folder, so `next start` and the e2e tests in CI
 *   take the stored path.
 * Without a store, every fetch builds the feed from the database, as before.
 */
export function calendarFeedStore(): CalendarFeedStore | null {
  if (cachedStore !== undefined) return cachedStore;
  const previewDatabase = process.env.VERCEL_ENV === "preview" && Boolean(process.env.PREVIEW_DATABASE_URL?.trim());
  if (process.env.NODE_ENV === "development" || previewDatabase) {
    cachedStore = null;
    return cachedStore;
  }
  try {
    const target = projectChatS3Target();
    if (target) cachedStore = r2Store(target.bucket, target.client);
    else cachedStore = process.env.VERCEL ? null : folderStore(path.join(os.tmpdir(), "ai-multi-calendar-feeds"));
  } catch (error) {
    // A broken bucket setting shouldn't take feeds down: build them on each fetch instead.
    console.error("calendar_feed_store_config_failed", { error: error instanceof Error ? error.name : "UnknownError" });
    cachedStore = null;
  }
  return cachedStore;
}

async function findOwner(token: string) {
  const user = await prisma.user.findUnique({ where: { calendarFeedToken: token }, select: { id: true } });
  return user?.id ?? null;
}

async function tokenOf(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { calendarFeedToken: true } });
  return user?.calendarFeedToken ?? null;
}

/** The response for /api/calendar/<file>: the stored feed when there is one. */
export function serveCalendarFeed(file: string, appUrl: string) {
  return calendarFeedResponse(file, {
    store: calendarFeedStore(),
    findOwner,
    build: (userId) => calendarFeedFor(userId, appUrl),
  });
}

// One queue per server process, even if bundling loads this module twice.
const globalForFeeds = globalThis as unknown as {
  calendarFeedQueue?: ReturnType<typeof createRebuildQueue<string>>;
};
const queue = (globalForFeeds.calendarFeedQueue ??= createRebuildQueue<string>(async (userId, appUrl) => {
  const store = calendarFeedStore();
  if (store) await rebuildCalendarFeed(userId, { store, tokenOf, build: (id) => calendarFeedFor(id, appUrl) });
}));

/** The address links inside feeds point to: APP_BASE_URL, or the one this request came in on. */
async function requestAppUrl() {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) return null;
  return `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${host}`;
}

async function refreshNow(scope: FeedScope) {
  try {
    const where = feedOwnersWhere(scope);
    if (!where || !calendarFeedStore()) return;
    const people = await prisma.user.findMany({ where, select: { id: true } });
    if (!people.length) return;
    const appUrl = await requestAppUrl();
    if (!appUrl) return;
    await Promise.all(people.map(({ id }) => queue.schedule(id, appUrl)));
  } catch (error) {
    console.error("calendar_feed_refresh_failed", { error: error instanceof Error ? error.name : "UnknownError" });
  }
}

/**
 * Call after saving a change that can show up in calendar feeds: once the
 * response is sent, it rebuilds the stored feeds of the people in
 * `scope.userIds` and of the owners and members of `scope.projectIds`, if
 * they have a feed link. For route handlers and server actions.
 */
export function refreshCalendarFeeds(scope: FeedScope) {
  after(() => refreshNow(scope));
}

/** The people with a feed link who see `scope`, for changes that remove that link first (deleting a project). */
export async function calendarFeedUserIds(scope: FeedScope) {
  const where = feedOwnersWhere(scope);
  if (!where || !calendarFeedStore()) return [];
  const people = await prisma.user.findMany({ where, select: { id: true } });
  return people.map(({ id }) => id);
}

/**
 * Saves a new feed link token, or null to turn the feed off, and retires the
 * old link's stored feed at once. Throws, changing nothing, when the old feed
 * can't be deleted.
 */
export async function saveCalendarFeedToken(userId: string, token: string | null) {
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { calendarFeedToken: true } });
  await retireCalendarFeed(current?.calendarFeedToken ?? null, calendarFeedStore(), async () => {
    await prisma.user.update({ where: { id: userId }, data: { calendarFeedToken: token } });
  });
  // Build the new link's feed now, while the database is awake.
  if (token) refreshCalendarFeeds({ userIds: [userId] });
}

/** For the daily cleanup: deletes stored feeds no current link points to. */
export async function cleanUpCalendarFeeds() {
  const store = calendarFeedStore();
  if (!store) return 0;
  return removeStaleCalendarFeeds(store, async () => {
    const users = await prisma.user.findMany({ where: { calendarFeedToken: { not: null } }, select: { calendarFeedToken: true } });
    return users.flatMap(({ calendarFeedToken }) => (calendarFeedToken ? [calendarFeedToken] : []));
  });
}
