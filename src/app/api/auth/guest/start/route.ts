import { NextResponse } from "next/server";
import {
  createGuestUser,
  createSessionRecord,
  getSessionCookieOptions,
  getSessionUser,
  isGuestLoginEnabled,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";
import { seedGuestSample } from "@/lib/guest-sample";
import { isTimeZone } from "@/lib/guest-sample-core";
import { consumeRateLimit } from "@/lib/rate-limit";
import { clientIpFrom, RATE_LIMITS } from "@/lib/rate-limit-core";

/** Browsers say where a request comes from: Sec-Fetch-Site, or for older ones the Origin, which must be this host. */
function fromThisSite(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  try {
    return Boolean(origin) && new URL(origin!).host === request.headers.get("host");
  } catch {
    return false;
  }
}

/** Crawlers, link previews and page audits that run scripts still get no workspace. */
const AUTOMATED = /bot|crawl|spider|slurp|lighthouse|facebookexternalhit|embedly|preview/i;

/**
 * Starts a guest workspace, with sample content, for a new visitor on `/` (#460). The page asks for
 * it from the browser, so the uptime check and link previews, which don't run scripts, never make
 * one and never wake the database. It answers in JSON; the page then loads Home.
 */
export async function POST(request: Request) {
  if (!isGuestLoginEnabled()) return NextResponse.json({ error: "guest-disabled" }, { status: 403 });
  // Only this site's own page may start one: a guest session must never replace someone's from elsewhere.
  if (!fromThisSite(request)) return NextResponse.json({ error: "cross-site" }, { status: 403 });
  if (AUTOMATED.test(request.headers.get("user-agent") ?? "")) return NextResponse.json({ error: "automated" }, { status: 403 });
  if (await getSessionUser()) return NextResponse.json({ error: "signed-in" }, { status: 409 });

  const limit = await consumeRateLimit(RATE_LIMITS.guestIp, clientIpFrom(request.headers));
  if (!limit.allowed) return NextResponse.json({ error: "rate-limited", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { timeZone?: unknown } | null;
  const timeZone = isTimeZone(body?.timeZone) ? body.timeZone : "UTC";
  const user = await createGuestUser();
  await seedGuestSample(user.id, timeZone);
  const { token, cookieExpiresAt } = await createSessionRecord(user.id, { method: "GUEST", newAccount: true });
  const response = NextResponse.json({ started: true }, { status: 201 });
  response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions(cookieExpiresAt));
  return response;
}
