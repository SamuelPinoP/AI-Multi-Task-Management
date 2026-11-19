import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildCalendarFeed } from "./calendar-feed-core";
import {
  CALENDAR_FEED_VERSION,
  REBUILD_DELAY_MS,
  calendarFeedKey,
  calendarFeedResponse,
  createRebuildQueue,
  feedOwnersWhere,
  readCalendarFeed,
  rebuildCalendarFeed,
  removeStaleCalendarFeeds,
  retireCalendarFeed,
  retiredFeedKey,
  staleFeedKeys,
  type CalendarFeedSource,
  type CalendarFeedStore,
} from "./calendar-feed-store-core";

const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";
const OTHER_TOKEN = "ABCDEFGHIJKLMNOPQRSTUVWXYZ-_6789";
const quiet = () => {};
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** A stand-in for R2 that records every call. */
function memoryStore(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const calls: string[] = [];
  const store: CalendarFeedStore = {
    async get(key) {
      calls.push(`get ${key}`);
      return files.get(key) ?? null;
    },
    async put(key, body) {
      calls.push(`put ${key}`);
      files.set(key, body);
    },
    async remove(key) {
      calls.push(`remove ${key}`);
      files.delete(key);
    },
    async list() {
      calls.push("list");
      return [...files.keys()];
    },
  };
  return { store, files, calls };
}

/** A stand-in for Prisma: links map tokens to people, and every query is recorded. */
function database(links: Record<string, string>, store: CalendarFeedStore | null) {
  const queries: string[] = [];
  const source: CalendarFeedSource = {
    store,
    log: quiet,
    async findOwner(token) {
      queries.push("find owner");
      return links[token] ?? null;
    },
    async build(userId) {
      queries.push("build");
      return `BEGIN:VCALENDAR\r\nX-FOR:${userId}\r\nEND:VCALENDAR\r\n`;
    },
  };
  return { source, queries };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

test("a feed's key is a hash of its token, so the bucket never holds a working link", () => {
  const key = calendarFeedKey(TOKEN);
  assert.match(key, /^calendar-feeds\/[0-9a-f]{64}\.ics$/);
  assert.ok(!key.includes(TOKEN));
  assert.equal(calendarFeedKey(TOKEN), key);
  assert.notEqual(calendarFeedKey(OTHER_TOKEN), key);
  assert.equal(key, `calendar-feeds/${sha256(`${TOKEN}:v${CALENDAR_FEED_VERSION}`)}.ics`);
});

test("a retired link's marker is a hash too, and isn't a feed", () => {
  const marker = retiredFeedKey(TOKEN);
  assert.match(marker, /^calendar-feeds\/[0-9a-f]{64}\.retired$/);
  assert.ok(!marker.includes(TOKEN));
  assert.notEqual(marker, calendarFeedKey(TOKEN));
});

// Stored feeds outlive deploys, so a feed that comes out differently must
// come with a new version, which makes every stored feed rebuild once.
const PINNED_FEED = { version: 1, digest: "c4fe34e34d4a07efcb73398a841857a8516b0bace78000bdc9415eb25535b6f0" };

test("a change to the feed's output comes with a new CALENDAR_FEED_VERSION", () => {
  const updatedAt = new Date("2026-10-20T15:30:00.000Z");
  const output = buildCalendarFeed({
    appUrl: "https://ai-multi.example",
    events: [
      {
        id: "evt1",
        title: "Planning, review; and \\ notes",
        description: "Line one\nLine two",
        location: "Room 4",
        startTime: new Date("2026-11-02T09:00:00.000Z"),
        endTime: new Date("2026-11-02T10:30:00.000Z"),
        hasStartTime: true,
        hasEndTime: true,
        recurrence: "NONE",
        repeatUntil: null,
        skippedDates: [],
        updatedAt,
        projectName: "Launch",
      },
      {
        id: "evt2",
        title: "Offsite",
        description: null,
        location: null,
        startTime: new Date("2026-11-05T00:00:00.000Z"),
        endTime: new Date("2026-11-06T00:00:00.000Z"),
        hasStartTime: false,
        hasEndTime: false,
        recurrence: "NONE",
        repeatUntil: null,
        skippedDates: [],
        updatedAt,
        projectName: null,
      },
      {
        id: "evt3",
        title: "Rent",
        description: null,
        location: null,
        startTime: new Date("2026-10-31T08:00:00.000Z"),
        endTime: null,
        hasStartTime: true,
        hasEndTime: false,
        recurrence: "MONTHLY",
        repeatUntil: new Date("2027-06-30T00:00:00.000Z"),
        skippedDates: [new Date("2026-12-31T00:00:00.000Z")],
        updatedAt,
        projectName: null,
      },
    ],
    tasks: [
      {
        id: "task1",
        title: "Write the release notes for the launch, with every change since the beta and the known issues",
        description: "Check the changelog",
        dueDate: new Date("2026-11-03T00:00:00.000Z"),
        updatedAt,
        projectName: "Launch",
      },
    ],
  });
  assert.deepEqual(
    { version: CALENDAR_FEED_VERSION, digest: sha256(output) },
    PINNED_FEED,
    "The feed's output changed. Bump CALENDAR_FEED_VERSION in calendar-feed-store-core.ts so stored feeds are rebuilt, then pin the new version and digest here.",
  );
});

test("stale feeds are the ones no current link points to; markers stay", () => {
  const current = calendarFeedKey(TOKEN);
  const replaced = calendarFeedKey(OTHER_TOKEN);
  const olderVersion = `calendar-feeds/${sha256(`${TOKEN}:v0`)}.ics`;
  const marker = retiredFeedKey(OTHER_TOKEN);
  assert.deepEqual(staleFeedKeys([current, replaced, olderVersion, marker, "backups/database/x.json.gz"], [TOKEN]), [replaced, olderVersion]);
  assert.deepEqual(staleFeedKeys([current], []), [current]);
});

test("a change reaches nobody's feed when it names no person or project", () => {
  assert.equal(feedOwnersWhere({}), null);
  assert.equal(feedOwnersWhere({ userIds: [], projectIds: [null, undefined] }), null);
});

test("a change to someone's own items reaches their feed, if they have a link", () => {
  assert.deepEqual(feedOwnersWhere({ userIds: ["u1", "u1", null, "u2"] }), {
    calendarFeedToken: { not: null },
    OR: [{ id: { in: ["u1", "u2"] } }],
  });
});

test("a change in a project reaches its owner's and members' feeds", () => {
  assert.deepEqual(feedOwnersWhere({ userIds: ["u1"], projectIds: ["p1", null, "p2", "p1"] }), {
    calendarFeedToken: { not: null },
    OR: [
      { id: { in: ["u1"] } },
      { projects: { some: { id: { in: ["p1", "p2"] } } } },
      { projectMemberships: { some: { projectId: { in: ["p1", "p2"] } } } },
    ],
  });
});

// Every API route that writes what a feed shows refreshes the feeds, unless
// it is listed here with the reason its writes can't change a feed.
const NO_FEED_CHANGES: Record<string, string> = {
  "goals/[id]/tasks/route.ts": "creates tasks without a due date, and links tasks to a goal",
  "goals/[id]/tasks/[taskId]/route.ts": "only unlinks a task from a goal",
  "projects/[id]/github/route.ts": "only links a GitHub repository",
};
const FEED_WRITES = /\b(?:prisma|tx)\.(?:task|event|project|projectMember)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;

test("every API route that changes events, tasks, projects or members refreshes calendar feeds", () => {
  const root = path.join(process.cwd(), "src/app/api");
  const missing: string[] = [];
  for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    const route = file.replaceAll("\\", "/");
    if (!route.endsWith("route.ts") || route in NO_FEED_CHANGES) continue;
    const source = readFileSync(path.join(root, file), "utf8");
    if (FEED_WRITES.test(source) && !source.includes("refreshCalendarFeeds(")) missing.push(route);
  }
  assert.deepEqual(missing, [], "Call refreshCalendarFeeds after the change, or list the route in NO_FEED_CHANGES with the reason.");
  for (const route of Object.keys(NO_FEED_CHANGES)) assert.ok(existsSync(path.join(root, route)), `${route} no longer exists`);
});

test("rebuilds wait REBUILD_DELAY_MS, and requests meanwhile share the rebuild", async () => {
  const waits: number[] = [];
  const gate = deferred();
  let runs = 0;
  const queue = createRebuildQueue<string>(
    async () => {
      runs += 1;
    },
    {
      wait: (ms) => {
        waits.push(ms);
        return gate.promise;
      },
    },
  );
  const first = queue.schedule("u1", "https://app.example");
  const second = queue.schedule("u1", "https://app.example");
  assert.equal(second, first);
  gate.resolve();
  await first;
  assert.equal(runs, 1);
  assert.deepEqual(waits, [REBUILD_DELAY_MS]);
  assert.ok(REBUILD_DELAY_MS >= 1000 && REBUILD_DELAY_MS <= 5000, "a few seconds");
});

test("each person's rebuilds merge on their own", async () => {
  const rebuilt: string[] = [];
  const queue = createRebuildQueue<string>(async (userId) => {
    rebuilt.push(userId);
  }, { delayMs: 0 });
  await Promise.all(["u1", "u1", "u2", "u1", "u2"].map((userId) => queue.schedule(userId, "https://app.example")));
  assert.deepEqual(rebuilt.sort(), ["u1", "u2"]);
});

test("a change during a rebuild gets one more rebuild after it, never two at once", async () => {
  const firstStarted = deferred();
  const releaseFirst = deferred();
  let runs = 0;
  let running = 0;
  let mostAtOnce = 0;
  const queue = createRebuildQueue<string>(async () => {
    runs += 1;
    running += 1;
    mostAtOnce = Math.max(mostAtOnce, running);
    if (runs === 1) {
      firstStarted.resolve();
      await releaseFirst.promise;
    }
    running -= 1;
  }, { delayMs: 0 });

  const first = queue.schedule("u1", "https://app.example");
  await firstStarted.promise;
  // The first rebuild may have read the data before these changes.
  const second = queue.schedule("u1", "https://app.example");
  const third = queue.schedule("u1", "https://app.example");
  assert.equal(third, second);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(runs, 1);

  releaseFirst.resolve();
  await Promise.all([first, second]);
  assert.equal(runs, 2);
  assert.equal(mostAtOnce, 1);
});

test("a failed rebuild is reported, and the next one still runs", async () => {
  const errors: unknown[] = [];
  let runs = 0;
  const queue = createRebuildQueue<string>(
    async () => {
      runs += 1;
      if (runs === 1) throw new Error("storage is down");
    },
    { delayMs: 0, onError: (_userId, error) => errors.push(error) },
  );
  await queue.schedule("u1", "https://app.example");
  await queue.schedule("u1", "https://app.example");
  assert.equal(runs, 2);
  assert.equal(errors.length, 1);
});

test("the feed route serves a stored feed without querying the database", async () => {
  const stored = "BEGIN:VCALENDAR\r\nX-STORED:yes\r\nEND:VCALENDAR\r\n";
  const { store } = memoryStore({ [calendarFeedKey(TOKEN)]: stored });
  const { source, queries } = database({ [TOKEN]: "u1" }, store);

  const response = await calendarFeedResponse(`${TOKEN}.ics`, source);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), stored);
  assert.deepEqual(queries, []);
  assert.equal(response.headers.get("content-type"), "text/calendar; charset=utf-8");
  assert.equal(response.headers.get("content-disposition"), 'inline; filename="ai-multi.ics"');
  assert.equal(response.headers.get("cache-control"), "private, max-age=300");
  assert.equal(response.headers.get("x-robots-tag"), "noindex");
});

test("with no stored feed, the route builds it, stores it and serves it; the next fetch skips the database", async () => {
  const { store, files } = memoryStore();
  const { source, queries } = database({ [TOKEN]: "u1" }, store);

  const first = await calendarFeedResponse(`${TOKEN}.ics`, source);
  const built = await first.text();
  assert.equal(first.status, 200);
  assert.match(built, /X-FOR:u1/);
  assert.equal(files.get(calendarFeedKey(TOKEN)), built);

  queries.length = 0;
  const second = await calendarFeedResponse(`${TOKEN}.ics`, source);
  assert.equal(await second.text(), built);
  assert.deepEqual(queries, []);
});

test("an unknown link is 404, and nothing is stored for it", async () => {
  const { store, files } = memoryStore();
  const { source } = database({}, store);
  const response = await calendarFeedResponse(`${TOKEN}.ics`, source);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Calendar not found" });
  assert.equal(files.size, 0);
});

test("a retired link is 404 without a database lookup", async () => {
  const { store } = memoryStore({ [retiredFeedKey(TOKEN)]: "" });
  const { source, queries } = database({}, store);
  const response = await calendarFeedResponse(`${TOKEN}.ics`, source);
  assert.equal(response.status, 404);
  assert.deepEqual(queries, []);
});

test("a malformed link is 404 without touching storage or the database", async () => {
  const { store, calls } = memoryStore();
  const { source, queries } = database({ [TOKEN]: "u1" }, store);
  for (const file of [`${TOKEN}.txt`, "short.ics", `${TOKEN}x.ics`, `../${TOKEN}.ics`]) {
    assert.equal((await calendarFeedResponse(file, source)).status, 404);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(queries, []);
});

test("when storage can't be read, the feed comes from the database", async () => {
  const { store } = memoryStore();
  const { source } = database({ [TOKEN]: "u1" }, {
    ...store,
    get: async () => {
      throw new Error("storage is down");
    },
  });
  const response = await calendarFeedResponse(`${TOKEN}.ics`, source);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /X-FOR:u1/);
});

test("without storage, every fetch builds the feed, as before", async () => {
  const { source, queries } = database({ [TOKEN]: "u1" }, null);
  assert.match((await readCalendarFeed(TOKEN, source)) ?? "", /X-FOR:u1/);
  assert.match((await readCalendarFeed(TOKEN, source)) ?? "", /X-FOR:u1/);
  assert.deepEqual(queries, ["find owner", "build", "find owner", "build"]);
});

test("a feed built while its link was turned off isn't left in storage", async () => {
  const { store, files } = memoryStore();
  const links: Record<string, string> = { [TOKEN]: "u1" };
  const { source } = database(links, store);
  const build = source.build;
  source.build = async (userId) => {
    delete links[TOKEN];
    return build(userId);
  };
  // Served this once (the link was valid when the fetch began), but not kept.
  assert.match((await readCalendarFeed(TOKEN, source)) ?? "", /X-FOR:u1/);
  assert.equal(files.size, 0);
});

test("a failed feed build is a 500", async (t) => {
  t.mock.method(console, "error", quiet);
  const { store } = memoryStore();
  const { source } = database({ [TOKEN]: "u1" }, store);
  source.build = async () => {
    throw new Error("database is down");
  };
  assert.equal((await calendarFeedResponse(`${TOKEN}.ics`, source)).status, 500);
});

test("a rebuild stores the feed under the person's current link", async () => {
  const { store, files } = memoryStore();
  const rebuilt = await rebuildCalendarFeed("u1", { store, tokenOf: async () => TOKEN, build: async () => "FEED" });
  assert.equal(rebuilt, true);
  assert.deepEqual([...files], [[calendarFeedKey(TOKEN), "FEED"]]);
});

test("a rebuild for someone without a link stores nothing", async () => {
  const { store, files } = memoryStore();
  assert.equal(await rebuildCalendarFeed("u1", { store, tokenOf: async () => null, build: async () => "FEED" }), false);
  assert.equal(files.size, 0);
});

test("a rebuild that finishes after the link changed removes what it stored", async () => {
  const { store, files } = memoryStore();
  const tokens = [TOKEN, OTHER_TOKEN];
  await rebuildCalendarFeed("u1", { store, tokenOf: async () => tokens.shift() ?? null, build: async () => "FEED" });
  assert.equal(files.size, 0);
});

test("retiring a link deletes its feed before and after saving, then leaves a marker", async () => {
  const { store, files, calls } = memoryStore({ [calendarFeedKey(TOKEN)]: "FEED" });
  const order: string[] = [];
  await retireCalendarFeed(TOKEN, store, async () => {
    order.push(...calls, "save");
  });
  assert.deepEqual(order, [`remove ${calendarFeedKey(TOKEN)}`, "save"]);
  assert.ok(calls.includes(`remove ${calendarFeedKey(TOKEN)}`, 1), "deleted again after saving");
  assert.deepEqual([...files], [[retiredFeedKey(TOKEN), ""]]);
});

test("when the old feed can't be deleted, the link isn't changed", async () => {
  const { store } = memoryStore();
  let saved = false;
  const failing = {
    ...store,
    remove: async () => {
      throw new Error("storage is down");
    },
  };
  await assert.rejects(
    retireCalendarFeed(TOKEN, failing, async () => {
      saved = true;
    }),
  );
  assert.equal(saved, false);
});

test("a marker that can't be written doesn't undo the change", async () => {
  const { store } = memoryStore();
  const logged: string[] = [];
  let saved = false;
  const failing = {
    ...store,
    put: async () => {
      throw new Error("storage is down");
    },
  };
  await retireCalendarFeed(TOKEN, failing, async () => {
    saved = true;
  }, (event) => logged.push(event));
  assert.equal(saved, true);
  assert.deepEqual(logged, ["calendar_feed_retire_failed"]);
});

test("without storage or an old link, retiring just saves", async () => {
  let saves = 0;
  await retireCalendarFeed(TOKEN, null, async () => {
    saves += 1;
  });
  const { store, calls } = memoryStore();
  await retireCalendarFeed(null, store, async () => {
    saves += 1;
  });
  assert.equal(saves, 2);
  assert.deepEqual(calls, []);
});

test("the daily cleanup removes stale feeds, listing them before reading the links", async () => {
  const { store, files, calls } = memoryStore({
    [calendarFeedKey(TOKEN)]: "current",
    [calendarFeedKey(OTHER_TOKEN)]: "replaced",
    [retiredFeedKey(OTHER_TOKEN)]: "",
  });
  const removed = await removeStaleCalendarFeeds(store, async () => {
    calls.push("read links");
    return [TOKEN];
  });
  assert.equal(removed, 1);
  assert.deepEqual(calls.slice(0, 2), ["list", "read links"]);
  assert.deepEqual([...files.keys()].sort(), [calendarFeedKey(TOKEN), retiredFeedKey(OTHER_TOKEN)].sort());
});
