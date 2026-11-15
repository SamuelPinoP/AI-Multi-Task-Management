import assert from "node:assert/strict";
import test from "node:test";
import { countEmail, EMAIL_COUNT_SUMMARY_DAYS, recentEmailCounts } from "./email-counts";

type Db = Parameters<typeof countEmail>[0];

function fakeDb({ upsertError, sums = [] }: { upsertError?: Error; sums?: Array<{ sent: number | null; failed?: number | null }> } = {}) {
  const upserts: unknown[] = [];
  const aggregates: unknown[] = [];
  const db = {
    emailHourlyCount: {
      upsert: async (args: unknown) => {
        upserts.push(args);
        if (upsertError) throw upsertError;
        return {};
      },
      aggregate: async (args: unknown) => {
        aggregates.push(args);
        return { _sum: sums[aggregates.length - 1] ?? { sent: null, failed: null } };
      },
    },
  } as unknown as Db;
  return { db, upserts, aggregates };
}

const now = new Date("2026-11-15T13:47:12Z");
const hour = new Date("2026-11-15T13:00:00Z");

test("a sent email adds one to its hour, creating the hour's row if needed", async () => {
  const { db, upserts } = fakeDb();
  await countEmail(db, "sent", now);
  assert.deepEqual(upserts, [{ where: { hour }, create: { hour, sent: 1 }, update: { sent: { increment: 1 } } }]);
});

test("an email that couldn't be sent counts as failed", async () => {
  const { db, upserts } = fakeDb();
  await countEmail(db, "failed", now);
  assert.deepEqual(upserts, [{ where: { hour }, create: { hour, failed: 1 }, update: { failed: { increment: 1 } } }]);
});

test("a count that can't be saved never stops the email", async (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const { db } = fakeDb({ upsertError: new Error("database asleep") });
  await assert.doesNotReject(countEmail(db, "sent", now));
  assert.equal(warn.mock.callCount(), 1);
  assert.deepEqual(warn.mock.calls[0].arguments, ["email_count_failed", { outcome: "sent", error: "Error" }]);
});

test("reads the last 24 hours (sent and failed) and the last 30 days (sent)", async () => {
  const { db, aggregates } = fakeDb({ sums: [{ sent: 42, failed: 3 }, { sent: 900 }] });
  assert.deepEqual(await recentEmailCounts(db, now), {
    last24Hours: { sent: 42, failed: 3 },
    lastDays: { days: EMAIL_COUNT_SUMMARY_DAYS, sent: 900 },
  });
  assert.equal(EMAIL_COUNT_SUMMARY_DAYS, 30);
  assert.deepEqual(aggregates, [
    { where: { hour: { gte: new Date("2026-11-14T13:00:00Z") } }, _sum: { sent: true, failed: true } },
    { where: { hour: { gte: new Date("2026-10-16T13:00:00Z") } }, _sum: { sent: true } },
  ]);
});

test("no emails yet reads as zero", async () => {
  const { db } = fakeDb();
  assert.deepEqual(await recentEmailCounts(db, now), { last24Hours: { sent: 0, failed: 0 }, lastDays: { days: 30, sent: 0 } });
});
