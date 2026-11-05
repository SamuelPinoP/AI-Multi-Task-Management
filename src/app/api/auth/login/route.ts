import { NextResponse } from "next/server";
import {
  createSessionRecord,
  getSafeRedirectPath,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
  verifyPassword,
} from "@/lib/auth";
import { LOGIN_IDENTIFIER_COOKIE, LOGIN_IDENTIFIER_MAX_LENGTH } from "@/lib/auth-constants";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, consumeRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { clientIpFrom, RATE_LIMITS } from "@/lib/rate-limit-core";
import { parseLoginIdentifier } from "@/lib/username";

// A plain form post that answers with a redirect, the way browsers' password
// managers expect: after a successful login they offer to save it, and a
// failed one shows the same form again, which they don't save (#351).

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

export async function POST(request: Request) {
  const formData = await request.formData();
  // "email" is what the form was called before usernames, kept for pages still open from then.
  const typed = String(formData.get("login") ?? formData.get("email") ?? "").trim();
  const identifier = parseLoginIdentifier(typed);
  const password = String(formData.get("password") || "");
  const nextPath = getSafeRedirectPath(String(formData.get("next") || ""));

  if (!identifier || !password) {
    return loginErrorRedirect(request, "error=missing", nextPath, typed);
  }

  const ipLimit = await consumeRateLimit(RATE_LIMITS.loginIp, clientIpFrom(request.headers));
  if (!ipLimit.allowed) {
    return loginErrorRedirect(request, `error=rate-limited&retry=${ipLimit.retryAfterSeconds}`, nextPath, typed);
  }

  const user = await prisma.user.findUnique({
    where: "email" in identifier ? { email: identifier.email } : { username: identifier.username },
    select: { id: true, email: true, passwordHash: true, isGuest: true },
  });

  // Failed attempts count against the account, whichever of its email or username was typed.
  const accountKey = user?.email ?? ("email" in identifier ? identifier.email : identifier.username);
  const accountLimit = await checkRateLimit(RATE_LIMITS.loginAccount, accountKey);
  if (!accountLimit.allowed) {
    return loginErrorRedirect(request, `error=rate-limited&retry=${accountLimit.retryAfterSeconds}`, nextPath, typed);
  }

  if (!user || user.isGuest || !verifyPassword(password, user.passwordHash)) {
    await consumeRateLimit(RATE_LIMITS.loginAccount, accountKey);
    return loginErrorRedirect(request, "error=invalid", nextPath, typed);
  }

  await resetRateLimit(RATE_LIMITS.loginAccount, accountKey);

  const { token, expiresAt } = await createSessionRecord(user.id);
  const response = redirectTo(request, nextPath);
  response.cookies.set(
    SESSION_COOKIE_NAME,
    token,
    getSessionCookieOptions(expiresAt),
  );
  response.cookies.set(LOGIN_IDENTIFIER_COOKIE, "", { path: "/login", maxAge: 0 });

  return response;
}
