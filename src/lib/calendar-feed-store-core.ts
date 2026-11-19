// Stored calendar feeds (CU-01, #497). Calendar apps fetch a subscription link
// on their own schedule, day and night, and every fetch that reaches the
// database keeps Neon awake for 5 minutes. So each feed is built when the data
// in it changes, while the database is awake anyway, and stored; the link
// serves the stored copy.
//
// Storage and the database are passed in, so tests can use stand-ins;
// src/lib/calendar-feed-store.ts wires in R2 and Prisma.

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { tokenFromFeedFile } from "@/lib/calendar-feed-core";

/**
 * Bump when what a feed contains or how it is written changes
 * (calendar-feed-core.ts, or the queries in calendar-feed.ts). Stored feeds
 * then miss once and are rebuilt on their next fetch, and the daily cleanup
 * deletes the old files.
 */
export const CALENDAR_FEED_VERSION = 1;

export const CALENDAR_FEED_PREFIX = "calendar-feeds/";

/** Merges rebuilds for one person that come this close together. */
export const REBUILD_DELAY_MS = 2000;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Where a link's feed is stored: a hash, so the bucket never holds a working link. */
export function calendarFeedKey(token: string) {
  return `${CALENDAR_FEED_PREFIX}${sha256(`${token}:v${CALENDAR_FEED_VERSION}`)}.ics`;
}

/**
 * An empty marker for a link that was turned off or replaced, so a calendar
 * app still subscribed to it gets 404 without a database lookup. Markers are
 * kept: deleting one would let that app wake the database on every fetch.
 */
export function retiredFeedKey(token: string) {
  return `${CALENDAR_FEED_PREFIX}${sha256(token)}.retired`;
}

/**
 * Stored feeds that no current link points to (replaced, turned off, or
 * written by an older CALENDAR_FEED_VERSION). Markers are left alone.
 */
export function staleFeedKeys(storedKeys: Iterable<string>, currentTokens: Iterable<string>) {
  const current = new Set(Array.from(currentTokens, (token) => calendarFeedKey(token)));
  return Array.from(storedKeys).filter((key) => key.startsWith(CALENDAR_FEED_PREFIX) && key.endsWith(".ics") && !current.has(key));
}

export type CalendarFeedStore = {
  /** The stored text, or null when there is none. */
  get(key: string): Promise<string | null>;
  put(key: string, body: string): Promise<void>;
  /** Removing a key that isn't there succeeds. */
  remove(key: string): Promise<void>;
  /** Every stored key under CALENDAR_FEED_PREFIX. */
  list(): Promise<string[]>;
};

type Log = (event: string, details: Record<string, unknown>) => void;

const logError: Log = (event, details) => console.error(event, details);
const errorName = (error: unknown) => (error instanceof Error ? error.name : "UnknownError");

/** What a change touched. Empty ids are skipped, so optional ids can be passed as they are. */
export type FeedScope = {
  /** People whose own events or tasks changed, or who joined or left a project. */
  userIds?: readonly (string | null | undefined)[];
  /** Projects whose events, tasks or name changed: their owner and members see them. */
  projectIds?: readonly (string | null | undefined)[];
};

function presentIds(values: FeedScope["userIds"]) {
  return [...new Set((values ?? []).filter((value): value is string => Boolean(value)))];
}

/**
 * The people with a feed link that a change can show up for, as a filter on
 * users; null when it can't reach anyone's feed. Matches who sees an item in
 * calendarFeedFor: its creator, and the owner and members of its project.
 */
export function feedOwnersWhere(scope: FeedScope): Prisma.UserWhereInput | null {
  const userIds = presentIds(scope.userIds);
  const projectIds = presentIds(scope.projectIds);
  const reached: Prisma.UserWhereInput[] = [];
  if (userIds.length) reached.push({ id: { in: userIds } });
  if (projectIds.length) {
    reached.push(
      { projects: { some: { id: { in: projectIds } } } },
      { projectMemberships: { some: { projectId: { in: projectIds } } } },
    );
  }
  return reached.length ? { calendarFeedToken: { not: null }, OR: reached } : null;
}

type Wait = (ms: number) => Promise<void>;
const sleep: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Merges rebuilds per person. A request joins one that hasn't started yet, so
 * changes a moment apart cost one rebuild. A request made while a rebuild runs
 * waits for it and then runs once more, so the stored feed ends up current.
 * `schedule` resolves when the rebuild that covers the request is done, and
 * never rejects: failures go to `onError`.
 */
export function createRebuildQueue<Input>(
  rebuild: (userId: string, input: Input) => Promise<void>,
  {
    delayMs = REBUILD_DELAY_MS,
    wait = sleep,
    onError = (userId: string, error: unknown) => logError("calendar_feed_rebuild_failed", { userId, error: errorName(error) }),
  }: { delayMs?: number; wait?: Wait; onError?: (userId: string, error: unknown) => void } = {},
) {
  const waiting = new Map<string, Promise<void>>();
  const running = new Map<string, Promise<void>>();

  function schedule(userId: string, input: Input): Promise<void> {
    const queued = waiting.get(userId);
    if (queued) return queued;
    const previous = running.get(userId);
    const task = (async () => {
      await wait(delayMs);
      if (previous) await previous;
      // From here on, new requests start a rebuild of their own.
      waiting.delete(userId);
      const run = Promise.resolve()
        .then(() => rebuild(userId, input))
        .catch((error: unknown) => onError(userId, error));
      running.set(userId, run);
      await run;
      if (running.get(userId) === run) running.delete(userId);
    })();
    waiting.set(userId, task);
    return task;
  }

  return { schedule };
}

export type CalendarFeedSource = {
  /** Stored feeds, or null where every fetch builds the feed. */
  store: CalendarFeedStore | null;
  /** The id of the person a link belongs to, or null. Reads the database. */
  findOwner(token: string): Promise<string | null>;
  /** The person's feed as calendarFeedFor builds it. Reads the database. */
  build(userId: string): Promise<string>;
  log?: Log;
};

/**
 * The feed behind a link, or null when the link doesn't exist. A stored feed
 * is served as it is, without the database. Otherwise the feed is built,
 * stored for the next fetch, and served.
 */
export async function readCalendarFeed(token: string, source: CalendarFeedSource) {
  const { store, log = logError } = source;
  const key = calendarFeedKey(token);
  if (store) {
    try {
      const stored = await store.get(key);
      if (stored !== null) return stored;
      if ((await store.get(retiredFeedKey(token))) !== null) return null;
    } catch (error) {
      // Storage trouble shouldn't take the feed down: fall back to the database.
      log("calendar_feed_store_read_failed", { error: errorName(error) });
    }
  }

  const userId = await source.findOwner(token);
  if (!userId) return null;
  const body = await source.build(userId);
  if (store) {
    try {
      await store.put(key, body);
      // The link may have been turned off while the feed was being built.
      if ((await source.findOwner(token)) !== userId) await store.remove(key);
    } catch (error) {
      log("calendar_feed_store_write_failed", { error: errorName(error) });
    }
  }
  return body;
}

const FEED_HEADERS = {
  "Content-Type": "text/calendar; charset=utf-8",
  "Content-Disposition": 'inline; filename="ai-multi.ics"',
  // Private data behind a secret link: no shared caches, and keep it out of search results.
  "Cache-Control": "private, max-age=300",
  "X-Robots-Tag": "noindex",
};

/** The response for /api/calendar/<file>. */
export async function calendarFeedResponse(file: string, source: CalendarFeedSource) {
  try {
    const token = tokenFromFeedFile(file);
    // Malformed links never reach storage or the database.
    const body = token ? await readCalendarFeed(token, source) : null;
    if (body === null) return Response.json({ error: "Calendar not found" }, { status: 404 });
    return new Response(body, { headers: FEED_HEADERS });
  } catch (error) {
    console.error("GET /api/calendar/[file] error:", error);
    return Response.json({ error: "Failed to build the calendar" }, { status: 500 });
  }
}

export type CalendarFeedBuilder = {
  store: CalendarFeedStore;
  /** The person's current link token, or null. Reads the database. */
  tokenOf(userId: string): Promise<string | null>;
  build(userId: string): Promise<string>;
};

/** Builds and stores one person's feed under their current link. False when they have none. */
export async function rebuildCalendarFeed(userId: string, deps: CalendarFeedBuilder) {
  const token = await deps.tokenOf(userId);
  if (!token) return false;
  const key = calendarFeedKey(token);
  await deps.store.put(key, await deps.build(userId));
  // The link may have been replaced or turned off meanwhile; a new link gets its own rebuild.
  if ((await deps.tokenOf(userId)) !== token) await deps.store.remove(key);
  return true;
}

/**
 * Retires a link when it is replaced or turned off; `save` writes the change
 * to the database. The old feed is deleted first, so if storage fails nothing
 * changes and the error reaches the person, and again afterwards, in case a
 * rebuild stored it in between. Then a marker answers the old link.
 */
export async function retireCalendarFeed(
  oldToken: string | null,
  store: CalendarFeedStore | null,
  save: () => Promise<void>,
  log: Log = logError,
) {
  if (!store || !oldToken) return save();
  const key = calendarFeedKey(oldToken);
  await store.remove(key);
  await save();
  const results = await Promise.allSettled([store.remove(key), store.put(retiredFeedKey(oldToken), "")]);
  for (const result of results) {
    if (result.status === "rejected") log("calendar_feed_retire_failed", { error: errorName(result.reason) });
  }
}

/**
 * Deletes stored feeds that no current link points to, and returns how many.
 * It lists the files before reading the links, so a link made in between
 * keeps its feed.
 */
export async function removeStaleCalendarFeeds(store: CalendarFeedStore, currentTokens: () => Promise<string[]>) {
  const stored = await store.list();
  const stale = staleFeedKeys(stored, await currentTokens());
  for (const key of stale) await store.remove(key);
  return stale.length;
}
