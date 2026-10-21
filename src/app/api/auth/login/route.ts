import { NextResponse } from "next/server";
import {
  createSessionRecord,
  getSafeRedirectPath,
  getSessionCookieOptions,
  normalizeAuthEmail,
  SESSION_COOKIE_NAME,
  verifyPassword,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, consumeRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { clientIpFrom, RATE_LIMITS } from "@/lib/rate-limit-core";

function redirectTo(request: Request, path: string, status = 303) {
  return NextResponse.redirect(new URL(path, request.url), status);
}

function loginErrorRedirect(request: Request, error: string, nextPath: string) {
  return redirectTo(
    request,
    `/login?error=${error}&next=${encodeURIComponent(nextPath)}`,
  );
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = normalizeAuthEmail(String(formData.get("email") || ""));
  const password = String(formData.get("password") || "");
  const nextPath = getSafeRedirectPath(String(formData.get("next") || ""));

  if (!email || !password) {
    return loginErrorRedirect(request, "missing", nextPath);
  }

  const ipLimit = await consumeRateLimit(RATE_LIMITS.loginIp, clientIpFrom(request.headers));
  const accountLimit = ipLimit.allowed ? await checkRateLimit(RATE_LIMITS.loginAccount, email) : ipLimit;
  if (!accountLimit.allowed) {
    return redirectTo(
      request,
      `/login?error=rate-limited&retry=${accountLimit.retryAfterSeconds}&next=${encodeURIComponent(nextPath)}`,
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, isGuest: true },
  });

  if (!user || user.isGuest || !verifyPassword(password, user.passwordHash)) {
    await consumeRateLimit(RATE_LIMITS.loginAccount, email);
    return loginErrorRedirect(request, "invalid", nextPath);
  }

  await resetRateLimit(RATE_LIMITS.loginAccount, email);

  const { token, expiresAt } = await createSessionRecord(user.id);
  const response = redirectTo(request, nextPath);
  response.cookies.set(
    SESSION_COOKIE_NAME,
    token,
    getSessionCookieOptions(expiresAt),
  );

  return response;
}
