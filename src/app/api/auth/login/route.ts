import { NextResponse } from "next/server";
import {
  createSessionRecord,
  getSafeRedirectPath,
  getSessionCookieOptions,
  mustConfirmEmail,
  signedInBeforeCookie,
  SESSION_COOKIE_NAME,
  verifyPassword,
} from "@/lib/auth";
import { LOGIN_IDENTIFIER_COOKIE, LOGIN_IDENTIFIER_MAX_LENGTH } from "@/lib/auth-constants";
import { confirmEmailHref } from "@/lib/auth-links";
import type { LoginFailure } from "@/lib/login-core";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, consumeRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { clientIpFrom, RATE_LIMITS } from "@/lib/rate-limit-core";
import { fromThisSite } from "@/lib/same-site";
import { parseLoginIdentifier } from "@/lib/username";

// A plain form post that answers with a redirect, the way browsers' password
// managers expect: after a successful login they offer to save it, and a
// failed one shows the same form again, which they don't save (#351).
//
// The log-in pop-up (#543) sends the same form from inside the guest workspace
// and asks for JSON, so a failed attempt shows its message in the pop-up and
// the page behind stays as it was. A successful one sets the same cookies and
// says where to go; the pop-up goes there, and browsers offer to save then.

function redirectTo(request: Request, path: string, status = 303) {
  return NextResponse.redirect(new URL(path, request.url), status);
}

/**
 * Back to the form after a failed attempt, which keeps what was typed in the
 * "Email or username" field for a few minutes so it needn't be typed again.
 * A cookie rather than the URL, so the address stays out of server logs and
 * the browser's history.
 */
function loginErrorRedirect(request: Request, query: string, nextPath: string, typed: string) {
  const response = redirectTo(request, `/login?${query}&next=${encodeURIComponent(nextPath)}`);
  if (typed) {
    response.cookies.set(LOGIN_IDENTIFIER_COOKIE, typed.slice(0, LOGIN_IDENTIFIER_MAX_LENGTH), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/login",
      maxAge: 5 * 60,
    });
  }
  return response;
}

const FAILURE_STATUS: Record<LoginFailure, number> = { missing: 400, invalid: 401, unconfirmed: 403, "rate-limited": 429 };

export async function POST(request: Request) {
  // Only the pop-up's fetch asks for JSON; a plain form post sends the browser's usual Accept.
  const fromPopup = (request.headers.get("accept") ?? "").includes("application/json");
  // A session must never replace a visitor's from another site's script.
  if (fromPopup && !fromThisSite(request)) return NextResponse.json({ error: "cross-site" }, { status: 403 });

  const formData = await request.formData();
  // "email" is what the form was called before usernames, kept for pages still open from then.
  const typed = String(formData.get("login") ?? formData.get("email") ?? "").trim();
  const identifier = parseLoginIdentifier(typed);
  const password = String(formData.get("password") || "");
  const nextPath = getSafeRedirectPath(String(formData.get("next") || ""));

  const fail = (error: Exclude<LoginFailure, "unconfirmed">, retryAfterSeconds?: number) =>
    fromPopup
      ? NextResponse.json({ error, retryAfterSeconds }, { status: FAILURE_STATUS[error] })
      : loginErrorRedirect(request, retryAfterSeconds ? `error=${error}&retry=${retryAfterSeconds}` : `error=${error}`, nextPath, typed);

  if (!identifier || !password) return fail("missing");

  const ipLimit = await consumeRateLimit(RATE_LIMITS.loginIp, clientIpFrom(request.headers));
  if (!ipLimit.allowed) return fail("rate-limited", ipLimit.retryAfterSeconds);

  const user = await prisma.user.findUnique({
    where: "email" in identifier ? { email: identifier.email } : { username: identifier.username },
    select: { id: true, email: true, passwordHash: true, isGuest: true, emailVerifiedAt: true },
  });

  // Failed attempts count against the account, whichever of its email or username was typed.
  const accountKey = user?.email ?? ("email" in identifier ? identifier.email : identifier.username);
  const accountLimit = await checkRateLimit(RATE_LIMITS.loginAccount, accountKey);
  if (!accountLimit.allowed) return fail("rate-limited", accountLimit.retryAfterSeconds);

  if (!user || user.isGuest || !verifyPassword(password, user.passwordHash)) {
    await consumeRateLimit(RATE_LIMITS.loginAccount, accountKey);
    return fail("invalid");
  }

  await resetRateLimit(RATE_LIMITS.loginAccount, accountKey);

  // The right password, but the email isn't confirmed yet (#350): the session only reaches
  // "Check your email", which carries on to the page asked for once it is. Only someone
  // with the password gets this far, so the page gives nothing away. The pop-up says so
  // instead, and the guest workspace keeps its session until they go on to that page.
  if (fromPopup && mustConfirmEmail(user)) {
    return NextResponse.json({ error: "unconfirmed" }, { status: FAILURE_STATUS.unconfirmed });
  }

  const { token, cookieExpiresAt } = await createSessionRecord(user.id, { method: "PASSWORD" });
  const response = fromPopup
    ? NextResponse.json({ next: nextPath })
    : redirectTo(request, mustConfirmEmail(user) ? confirmEmailHref({ next: nextPath }) : nextPath);
  response.cookies.set(
    SESSION_COOKIE_NAME,
    token,
    getSessionCookieOptions(cookieExpiresAt),
  );
  response.cookies.set(LOGIN_IDENTIFIER_COOKIE, "", { path: "/login", maxAge: 0 });
  response.cookies.set(...signedInBeforeCookie());

  return response;
}
