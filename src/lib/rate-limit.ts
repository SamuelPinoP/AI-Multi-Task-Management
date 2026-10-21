import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  type RateLimitRule,
  retryAfterSeconds,
  slidingWindowCount,
  tooManyAttemptsMessage,
  windowStartFor,
} from "@/lib/rate-limit-core";

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

const ALLOWED: RateLimitResult = { allowed: true, retryAfterSeconds: 0 };

/** The caller is fingerprinted, so the table never holds IPs or emails in readable form. */
function rowKey(rule: RateLimitRule, identifier: string) {
  return `${rule.name}:${createHash("sha256").update(identifier.toLowerCase()).digest("hex")}`;
}

type Row = { window: number; count: number; previousCount: number };

/**
 * `blockAt` "over" blocks once the estimate exceeds the limit (the current
 * request is already counted); "at" blocks once it reaches it (checking
 * before a request that hasn't been counted).
 */
function evaluate(rule: RateLimitRule, row: Row | undefined, nowMs: number, blockAt: "over" | "at"): RateLimitResult {
  if (!row) return ALLOWED;
  const currentWindow = Math.floor(nowMs / rule.windowMs);
  // Roll the stored row forward if it belongs to an older window.
  const count = row.window === currentWindow ? row.count : 0;
  const previousCount =
    row.window === currentWindow ? row.previousCount : row.window === currentWindow - 1 ? row.count : 0;
  const windowStartMs = windowStartFor(nowMs, rule.windowMs);
  const estimate = slidingWindowCount({ count, previousCount, windowStartMs, nowMs, windowMs: rule.windowMs });
  const blocked = blockAt === "over" ? estimate > rule.limit : estimate >= rule.limit;
  return blocked ? { allowed: false, retryAfterSeconds: retryAfterSeconds(windowStartMs, nowMs, rule.windowMs) } : ALLOWED;
}

/**
 * Counts one request and says whether it's within the limit. A missing
 * identifier (no client IP in local development) is always allowed.
 */
export async function consumeRateLimit(rule: RateLimitRule, identifier: string | null, now = new Date()): Promise<RateLimitResult> {
  if (!identifier) return ALLOWED;
  const nowMs = now.getTime();
  const currentWindow = Math.floor(nowMs / rule.windowMs);
  // The previous window still counts during the current one, so keep the row two windows.
  const keepSeconds = Math.ceil((2 * rule.windowMs) / 1000);

  // One atomic statement, so simultaneous requests can't both slip under the limit.
  const [row] = await prisma.$queryRaw<Row[]>`
    INSERT INTO "RateLimit" ("key", "window", "count", "previousCount", "expiresAt")
    VALUES (${rowKey(rule, identifier)}, ${currentWindow}, 1, 0, now() + make_interval(secs => ${keepSeconds}))
    ON CONFLICT ("key") DO UPDATE SET
      "previousCount" = CASE
        WHEN "RateLimit"."window" = EXCLUDED."window" THEN "RateLimit"."previousCount"
        WHEN "RateLimit"."window" = EXCLUDED."window" - 1 THEN "RateLimit"."count"
        ELSE 0 END,
      "count" = CASE WHEN "RateLimit"."window" = EXCLUDED."window" THEN "RateLimit"."count" + 1 ELSE 1 END,
      "window" = EXCLUDED."window",
      "expiresAt" = EXCLUDED."expiresAt"
    RETURNING "window", "count", "previousCount"`;

  // Now and then, clear counters that no longer matter.
  if (Math.random() < 0.01) {
    await prisma.$executeRaw`DELETE FROM "RateLimit" WHERE "expiresAt" < now()`;
  }

  return evaluate(rule, row, nowMs, "over");
}

/** Whether the caller has already used up the limit, without counting this request. */
export async function checkRateLimit(rule: RateLimitRule, identifier: string | null, now = new Date()): Promise<RateLimitResult> {
  if (!identifier) return ALLOWED;
  const [row] = await prisma.$queryRaw<Row[]>`
    SELECT "window", "count", "previousCount" FROM "RateLimit" WHERE "key" = ${rowKey(rule, identifier)}`;
  return evaluate(rule, row, now.getTime(), "at");
}

/** 429 for JSON routes, with a Retry-After header and a readable message. */
export function rateLimitedResponse(what: string, result: RateLimitResult) {
  return NextResponse.json(
    { error: tooManyAttemptsMessage(what, result.retryAfterSeconds) },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}

export async function resetRateLimit(rule: RateLimitRule, identifier: string | null) {
  if (!identifier) return;
  await prisma.$executeRaw`DELETE FROM "RateLimit" WHERE "key" = ${rowKey(rule, identifier)}`;
}
